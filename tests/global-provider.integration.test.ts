import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { createServer, type Server } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

/**
 * Codex resolves one default provider for the whole built-in model catalog.
 * Users routinely alias it (`model_provider = "chatgpt-http"`), so the WebUI
 * must treat that alias as the built-in channel instead of as a foreign
 * provider. Turns may then move between the default and managed channels.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const authorization = `Basic ${Buffer.from("codex:integration-access-token").toString("base64")}`;

let mockServer: Server;
let mockPort = 0;
let webuiPort = 0;
let proc: Subprocess;
let ws: WebSocket;
let seq = 1;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const providerRequests: { model: string }[] = [];

const testHome = mkdtempSync(join(tmpdir(), "codex-global-provider-"));
const testCodexHome = join(testHome, ".codex");
mkdirSync(testCodexHome, { recursive: true });
const modelsJsonPath = join(testHome, "models.json");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a test port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitFor<T>(check: () => T | undefined | Promise<T | undefined>, timeout = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const result = await check();
        if (result !== undefined) return resolve(result);
        if (Date.now() - started > timeout) return reject(new Error("Timed out waiting for condition"));
        setTimeout(tick, 30);
      } catch (error) {
        if (Date.now() - started > timeout) reject(error);
        setTimeout(tick, 30);
      }
    };
    tick();
  });
}

function rpc(method: string, params: any = {}) {
  const id = seq++;
  ws.send(JSON.stringify({ type: "rpc", id, method, params }));
  return new Promise<any>((resolve, reject) => pending.set(id, { resolve, reject }));
}

/** Minimal but faithful OpenAI Responses API streaming reply. */
async function handleResponsesApi(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  providerRequests.push({ model: String(body?.model || "") });
  const message = { id: "msg_mock", type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello from mock provider" }] };
  const events = [
    { event: "response.created", data: { type: "response.created", response: { id: "resp_mock", object: "response", created_at: 1, model: body?.model || "mock-model", status: "in_progress", output: [] } } },
    { event: "response.output_item.added", data: { type: "response.output_item.added", output_index: 0, item: { ...message, content: [] } } },
    { event: "response.output_text.delta", data: { type: "response.output_text.delta", item_id: "msg_mock", content_index: 0, delta: "Hello from mock provider" } },
    { event: "response.output_text.done", data: { type: "response.output_text.done", item_id: "msg_mock", content_index: 0, text: "Hello from mock provider" } },
    { event: "response.content_part.done", data: { type: "response.content_part.done", item_id: "msg_mock", output_index: 0, part: { ...message, content: [] } } },
    { event: "response.output_item.done", data: { type: "response.output_item.done", output_index: 0, item: message } },
    { event: "response.completed", data: { type: "response.completed", response: { id: "resp_mock", object: "response", created_at: 1, model: body?.model || "mock-model", status: "completed", output: [message], usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 } } } },
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let sequence = 0;
      for (const payload of events) {
        controller.enqueue(encoder.encode(`event: ${payload.event}\ndata: ${JSON.stringify({ sequence_number: sequence++, ...payload.data })}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

async function nativeModels(): Promise<string[]> {
  const catalog = await rpc("model/list", { limit: 1000, includeHidden: true });
  return (catalog?.data || []).filter((model: any) => !model.modelProvider).map((model: any) => model.model);
}

beforeAll(async () => {
  mockPort = await freePort();
  mockServer = Bun.serve({
    port: mockPort,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (new URL(request.url).pathname === "/v1/models") return Response.json({ data: [{ id: "mock-model" }] });
      return handleResponsesApi(request);
    },
  }) as unknown as Server;

  // Codex resolves "alias-global" as its default provider, exactly like a
  // hand-written `model_provider = "chatgpt-http"` entry.
  writeFileSync(join(testCodexHome, "config.toml"), [
    'model_provider = "alias-global"',
    "",
    "[model_providers.alias-global]",
    'name = "Alias Global"',
    `base_url = "http://127.0.0.1:${mockPort}/v1"`,
    'env_key = "ALIAS_API_KEY"',
    'wire_api = "responses"',
    "",
    "[model_providers.other-alias]",
    'name = "Other Alias"',
    `base_url = "http://127.0.0.1:${mockPort}/v1"`,
    'env_key = "ALIAS_API_KEY"',
    'wire_api = "responses"',
    "",
  ].join("\n"));
  writeFileSync(modelsJsonPath, JSON.stringify({
    version: 1,
    providers: [{
      id: "managed",
      name: "Managed Provider",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: "test-key-123",
      models: [{ id: "managed-model", displayName: "Managed Model" }],
    }],
  }, null, 2), { mode: 0o600 });

  webuiPort = await freePort();
  proc = spawn({
    cmd: ["bun", "run", "server.ts"],
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: testHome,
      CODEX_HOME: testCodexHome,
      CODEX_WEBUI_CWD: ROOT,
      CODEX_WEBUI_REVIEW_ROOT: ROOT,
      PORT: String(webuiPort),
      HOST: "127.0.0.1",
      CODEX_WEBUI_PASSWORD: "",
      CODEX_WEBUI_ACCESS_TOKEN: "integration-access-token",
      CODEX_WEBUI_MODELS_JSON: modelsJsonPath,
      ALIAS_API_KEY: "alias-key-123",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { headers: { authorization } });
      const body = await response.json();
      return body.codex ? true : undefined;
    } catch { return undefined; }
  });
  ws = new WebSocket(`ws://127.0.0.1:${webuiPort}/ws`, { headers: { authorization } });
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === "rpc/result" || msg.type === "rpc/error") {
      const item = pending.get(msg.id);
      if (!item) return;
      pending.delete(msg.id);
      msg.type === "rpc/result" ? item.resolve(msg.result) : item.reject(new Error(msg.error));
    }
  });
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
}, 60_000);

afterAll(async () => {
  ws?.terminate();
  mockServer?.stop?.(true);
  if (proc) {
    proc.kill("SIGTERM");
    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 7000)),
    ]);
    if (!exited) {
      proc.kill("SIGKILL");
      await proc.exited;
    }
  }
  rmSync(testHome, { recursive: true, force: true });
});

describe("aliased default provider", () => {
  test("switches between built-in models inside a chat of the default provider", async () => {
    const models = await nativeModels();
    expect(models.length).toBeGreaterThan(1);
    const started = await rpc("thread/start", {
      cwd: ROOT,
      model: models[0],
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    });
    const threadId = started?.thread?.id;
    expect(typeof threadId).toBe("string");
    expect(started.modelProvider || started.thread.modelProvider).toBe("alias-global");

    const turn = await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: "Say hi" }],
      model: models[1],
    });
    expect(turn?.turn?.id || turn?.turnId).toBeTruthy();
    await waitFor(() => providerRequests.some((request) => request.model === models[1]) ? true : undefined, 30_000);
  }, 60_000);

  test("switches from the default provider to a managed provider", async () => {
    const models = await nativeModels();
    const started = await rpc("thread/start", {
      cwd: ROOT,
      model: models[0],
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    });
    const threadId = started?.thread?.id;
    const before = providerRequests.length;
    const turn = await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: "hi" }],
      model: "managed-model",
    });
    expect(turn?.turn?.id || turn?.turnId).toBeTruthy();
    await waitFor(() => providerRequests.slice(before).some((request) => request.model === "managed-model") ? true : undefined, 30_000);
  }, 30_000);

  test("switches from a managed provider to the default provider", async () => {
    const models = await nativeModels();
    const started = await rpc("thread/start", {
      cwd: ROOT,
      model: "managed-model",
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    });
    const threadId = started?.thread?.id;
    expect(typeof threadId).toBe("string");
    const before = providerRequests.length;
    const turn = await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: "hi" }],
      model: models[1],
    });
    expect(turn?.turn?.id || turn?.turnId).toBeTruthy();
    await waitFor(() => providerRequests.slice(before).some((request) => request.model === models[1]) ? true : undefined, 30_000);
  }, 30_000);
});
