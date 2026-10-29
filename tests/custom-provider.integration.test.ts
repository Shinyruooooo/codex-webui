import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { createServer, type Server } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

/**
 * End-to-end verification of custom model providers:
 *
 *   browser WS -> webui server -> codex app-server (-c model_providers.mock=...)
 *     -> local mock OpenAI Responses SSE endpoint
 *
 * The mock provider proves that provider config injection, model catalog
 * merging, thread/start modelProvider binding and Bearer authentication all
 * survive the real Codex binary without any OpenAI credentials.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const MOCK_REPLY = "Hello from mock provider";

let mockServer: Server;
let mockPort = 0;
let webuiPort = 0;
let proc: Subprocess;
let ws: WebSocket;
let seq = 1;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const notifications: any[] = [];
const providerRequests: { url: string; authorization: string | undefined; body: any }[] = [];
const catalogRequests: { path: string; authorization: string | null }[] = [];
let catalogMode: "success" | "unauthorized" | "slow" = "success";
let releaseCatalog: (() => void) | null = null;
let disconnects = 0;
let conflictingNativeId: string | null = null;
const authorization = `Basic ${Buffer.from("codex:integration-access-token").toString("base64")}`;
const testHome = mkdtempSync(join(tmpdir(), "codex-provider-integration-"));
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
  providerRequests.push({ url: new URL(request.url).pathname + new URL(request.url).search, authorization: request.headers.get("authorization") || undefined, body });
  const message = { id: "msg_mock", type: "message", role: "assistant", content: [{ type: "output_text", text: MOCK_REPLY }] };
  const events = [
    { event: "response.created", data: { type: "response.created", response: { id: "resp_mock", object: "response", created_at: 1, model: body?.model || "mock-model", status: "in_progress", output: [] } } },
    { event: "response.output_item.added", data: { type: "response.output_item.added", output_index: 0, item: { ...message, content: [] } } },
    { event: "response.output_text.delta", data: { type: "response.output_text.delta", item_id: "msg_mock", output_index: 0, content_index: 0, delta: MOCK_REPLY } },
    { event: "response.output_text.done", data: { type: "response.output_text.done", item_id: "msg_mock", output_index: 0, content_index: 0, text: MOCK_REPLY } },
    { event: "response.content_part.done", data: { type: "response.content_part.done", item_id: "msg_mock", output_index: 0, content_index: 0, part: { type: "output_text", text: MOCK_REPLY } } },
    { event: "response.output_item.done", data: { type: "response.output_item.done", output_index: 0, item: message } },
    { event: "response.completed", data: { type: "response.completed", response: { id: "resp_mock", object: "response", created_at: 1, model: body?.model || "mock-model", status: "completed", output: [message], usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 6, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 18 } } } },
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
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}

beforeAll(async () => {
  mockPort = await freePort();
  mockServer = Bun.serve({
    port: mockPort,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (new URL(request.url).pathname === "/v1/models") {
        catalogRequests.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") });
        if (catalogMode === "unauthorized") return new Response("sensitive provider error body", { status: 401 });
        if (catalogMode === "slow") await new Promise<void>(resolve => { releaseCatalog = resolve; });
        return Response.json({ data: [{ id: "mock-model" }, { id: "mock-model-2" }, { id: "mock-discovered" }, ...(conflictingNativeId ? [{ id: conflictingNativeId }] : [])] });
      }
      return handleResponsesApi(request);
    },
  }) as unknown as Server;

  writeFileSync(modelsJsonPath, JSON.stringify({
    version: 1,
    providers: [{
      id: "mock",
      name: "Mock Provider",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: "test-key-123",
      models: [{ id: "mock-model", displayName: "Mock Model", efforts: ["low", "medium", "high"] }],
    }],
  }, null, 2), { mode: 0o600 });

  await launchBridge();
}, 60_000);

async function launchBridge() {
  webuiPort = await freePort();
  proc = spawn({
    cmd: ["bun", "run", "server.ts"],
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: testHome,
      CODEX_HOME: testCodexHome,
      CODEX_AUTH_PATH: join(testCodexHome, "auth.json"),
      CODEX_WEBUI_CWD: ROOT,
      CODEX_WEBUI_REVIEW_ROOT: ROOT,
      PORT: String(webuiPort),
      HOST: "127.0.0.1",
      CODEX_WEBUI_PASSWORD: "",
      CODEX_WEBUI_ACCESS_TOKEN: "integration-access-token",
      CODEX_WEBUI_MODELS_JSON: modelsJsonPath,
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
    } else if (msg.type === "codex/notification") notifications.push(msg.payload);
    else if (msg.type === "bridge/status" && msg.status === "disconnected") disconnects++;
  });
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
}

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

describe("custom model providers", () => {
  test("exposes configured providers without leaking API keys", async () => {
    const response = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { headers: { authorization } });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.providers).toHaveLength(1);
    expect(payload.providers[0].id).toBe("mock");
    expect(payload.providers[0].baseUrl).toBe(`http://127.0.0.1:${mockPort}/v1`);
    expect(payload.providers[0].hasApiKey).toBe(true);
    expect(payload.presets.map((preset: any) => preset.id)).toEqual(["zai-cn", "zai", "deepseek", "minimax"]);
    expect(payload.presets.every((preset: any) => preset.provider.apiKey === undefined)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("test-key-123");
  }, 15_000);

  test("merges custom models into model/list", async () => {
    const models = await rpc("model/list", { limit: 50 });
    const custom = models.data.find((entry: any) => entry.model === "mock-model");
    expect(custom).toBeDefined();
    expect(custom.modelProvider).toBe("mock");
    expect(custom.displayName).toBe("Mock Model");
    expect(custom.supportedReasoningEfforts.map((item: any) => item.reasoningEffort)).toEqual(["low", "medium", "high"]);
    expect(models.data.some((entry: any) => String(entry.model || "").startsWith("gpt"))).toBe(true);
  }, 15_000);

  test("streams a real turn through the mock Responses provider", async () => {
    const started = await rpc("thread/start", {
      cwd: ROOT,
      model: "mock-model",
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    });
    const threadId = started?.thread?.id;
    expect(typeof threadId).toBe("string");

    const turn = await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: "Say hi" }],
      model: "mock-model",
    });
    expect(turn?.turn?.id || turn?.turnId).toBeTruthy();

    await waitFor(() => {
      const completed = notifications.find((note) => note.method === "turn/completed" && note.params?.threadId === threadId);
      return completed ? true : undefined;
    }, 30_000);

    expect(providerRequests.length).toBeGreaterThan(0);
    const request = providerRequests[providerRequests.length - 1];
    expect(request.url).toBe("/v1/responses");
    expect(request.authorization).toBe("Bearer test-key-123");
    expect(request.body?.model).toBe("mock-model");
    expect(request.body?.stream).toBe(true);

    const assistantText = notifications
      .filter((note) => note.method === "item/completed")
      .map((note) => note.params?.item)
      .filter((item: any) => item?.type === "agentMessage" || item?.type === "assistantMessage" || item?.type === "message")
      .map((item: any) => JSON.stringify(item))
      .join("\n");
    expect(assistantText).toContain(MOCK_REPLY);
  }, 45_000);

  test("allows a turn to switch from a custom provider to a built-in model", async () => {
    const started = await rpc("thread/start", {
      cwd: ROOT,
      model: "mock-model",
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    });
    const threadId = started?.thread?.id;
    expect(typeof threadId).toBe("string");
    const turn = await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: "hi" }],
      model: "gpt-6.1-sol",
    });
    expect(turn?.turn?.id || turn?.turnId).toBeTruthy();
  }, 15_000);

  test("saves, restarts the bridge and serves the updated catalog", async () => {
    const rename = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ action: "save", provider: { id: "mock", name: "Renamed Mock", baseUrl: `http://127.0.0.1:${mockPort}/v1`, models: [{ id: "mock-model", displayName: "Mock Model" }, { id: "mock-model-2", displayName: "Mock Model 2" }] } }),
    });
    expect(rename.status).toBe(200);
    const payload = await rename.json();
    expect(payload.restarted).toBe(true);
    expect(payload.providers[0].name).toBe("Renamed Mock");
    // The API key was kept because the save request omitted it.
    expect(payload.providers[0].hasApiKey).toBe(true);

    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { headers: { authorization } });
        const body = await response.json();
        return body.codex === false ? true : undefined;
      } catch { return undefined; }
    }, 15_000).catch(() => {/* already restarted before we could observe the gap */});
    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { headers: { authorization } });
        const body = await response.json();
        return body.codex ? true : undefined;
      } catch { return undefined; }
    }, 30_000);

    const models = await rpc("model/list", { limit: 50 });
    expect(models.data.some((entry: any) => entry.model === "mock-model-2")).toBe(true);
  }, 45_000);

  test("preset saves reject missing keys, unknown presets and cross-endpoint key reuse", async () => {
    for (const payload of [
      { action: "save", presetId: "deepseek", provider: {} },
      { action: "save", presetId: "unknown", provider: { apiKey: "fixture" } },
      { action: "save", provider: { id: "mock", name: "Changed endpoint", baseUrl: "https://changed.example/v1", models: [{ id: "mock-model" }] } },
    ]) {
      const response = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, {
        method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      expect(response.status).toBe(400);
    }
    const unchanged = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { headers: { authorization } });
    const view = await unchanged.json();
    expect(view.providers).toHaveLength(1);
    expect(view.providers[0].baseUrl).toBe(`http://127.0.0.1:${mockPort}/v1`);
  }, 15_000);

  test("preset model defaults and a key reach the real Codex Responses client", async () => {
    // Only override the URL to keep the test offline; id/models/effort/vision
    // must come from the same defaults used by the key-only UI.
    const response = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ action: "save", presetId: "deepseek", provider: { apiKey: "preset-fixture-key", baseUrl: `http://127.0.0.1:${mockPort}/v1` } }),
    });
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.providers).toHaveLength(2); // Existing custom provider survives.
    expect(saved.providers.find((provider: any) => provider.id === "deepseek").models[0]).toMatchObject({
      id: "deepseek-flash", vision: true, defaultReasoningEffort: "high",
    });
    expect(JSON.stringify(saved)).not.toContain("preset-fixture-key");
    await waitFor(async () => {
      const health = await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { headers: { authorization } });
      return (await health.json()).codex === false ? true : undefined;
    });
    await waitFor(async () => {
      const health = await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { headers: { authorization } });
      return (await health.json()).codex === true ? true : undefined;
    });
    const models = await rpc("model/list", { limit: 50 });
    expect(models.data.find((model: any) => model.model === "deepseek-flash").defaultReasoningEffort).toBe("high");
    const started = await rpc("thread/start", { cwd: ROOT, model: "deepseek-flash", approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    const threadId = started.thread.id;
    await rpc("turn/start", { threadId, model: "deepseek-flash", effort: "high", input: [{ type: "text", text: "Preset smoke" }] });
    const completed = await waitFor(() => notifications.find(note => note.method === "turn/completed" && note.params?.threadId === threadId));
    expect(completed.params.turn.status).toBe("completed");
    const request = providerRequests.at(-1)!;
    expect(request.authorization).toBe("Bearer preset-fixture-key");
    expect(request.body.model).toBe("deepseek-flash");
    expect(request.body.reasoning.effort).toBe("high");
  }, 45_000);

  test("visibility toggles persist without restarting or losing keys and block new RPC inference", async () => {
    const mutation = async (payload: any) => {
      const response = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(payload) });
      expect(response.status).toBe(200);return response.json();
    };
    const before = disconnects;
    const started = await rpc("thread/start", { cwd: ROOT, model: "mock-model", approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    const id = started.thread.id;
    const unlisted = await rpc("thread/start", { cwd: ROOT, model: "mock-unlisted", modelProvider: "mock", approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    expect(unlisted.modelProvider || unlisted.thread.modelProvider).toBe("mock");
    await rpc("turn/start", { threadId: unlisted.thread.id, model: "mock-unlisted", input: [{ type: "text", text: "Explicit same model is valid while enabled" }] });
    const initialTurn = await waitFor(() => notifications.find(note => note.method === "turn/completed" && note.params?.threadId === unlisted.thread.id));
    expect(initialTurn.params.turn.status).toBe("completed");
    const off = await mutation({ action: "model-toggle", id: "mock", modelId: "mock-model", enabled: false });
    expect(off.restarted).toBe(false);
    expect(off.providers.find((p: any) => p.id === "mock").models.find((m: any) => m.id === "mock-model").enabled).toBe(false);
    expect((await rpc("model/list", {})).data.some((m: any) => m.model === "mock-model")).toBe(false);
    await expect(rpc("thread/start", { cwd: ROOT, model: "mock-model", ephemeral: true })).rejects.toThrow(/model is disabled/);
    await expect(rpc("thread/start", { cwd: ROOT, model: "mock-model", modelProvider: "openai", ephemeral: true })).rejects.toThrow(/model is disabled/);
    await expect(rpc("thread/start", { cwd: ROOT, config: { model: "mock-model", model_provider: "mock" }, ephemeral: true })).rejects.toThrow(/model is disabled/);
    await expect(rpc("thread/start", { cwd: ROOT, ephemeral: true })).rejects.toThrow(/Select a model/);
    await expect(rpc("thread/compact/start", { threadId: id })).rejects.toThrow(/model is disabled/);
    await expect(rpc("turn/start", { threadId: id, input: [{ type: "text", text: "omission bypass" }] })).rejects.toThrow(/model is disabled/);
    const stored = JSON.parse(readFileSync(modelsJsonPath, "utf8"));
    expect(stored.providers.find((p: any) => p.id === "mock").apiKey).toBe("test-key-123");
    expect(stored.providers.find((p: any) => p.id === "mock").models[0].enabled).toBe(false);
    const disabled = await mutation({ action: "toggle", id: "mock", enabled: false });
    expect(disabled.restarted).toBe(false);
    await expect(rpc("turn/start", { threadId: unlisted.thread.id, input: [{ type: "text", text: "identity bypass" }] })).rejects.toThrow(/provider is disabled/);
    await expect(rpc("thread/compact/start", { threadId: unlisted.thread.id })).rejects.toThrow(/provider is disabled/);
    await expect(rpc("thread/start", { cwd: ROOT, model: "mock-model-2", ephemeral: true })).rejects.toThrow(/provider is disabled/);
    const enabled = await mutation({ action: "toggle", id: "mock", enabled: true });
    expect(enabled.restarted).toBe(false);
    expect(enabled.providers.find((p: any) => p.id === "mock").models.every((m: any) => m.enabled)).toBe(true);
    expect((await rpc("model/list", {})).data.some((m: any) => m.model === "mock-model")).toBe(true);
    expect(disconnects).toBe(before);
  }, 15_000);

  test("refresh discovers real HTTP model ids, preserves choices and defaults new models off", async () => {
    const before = disconnects;
    const snapshot = await (await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { headers: { authorization } })).json();
    await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "model-toggle", id: "mock", modelId: "mock-model-2", enabled: false }) });
    const response = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "refresh", id: "mock" }) });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.restarted).toBe(false);
    expect(result.refresh).toMatchObject({ source: "remote", added: 1, discovered: 3 });
    const provider = result.providers.find((p: any) => p.id === "mock");
    expect(provider.models.find((m: any) => m.id === "mock-model-2").enabled).toBe(false);
    expect(provider.models.find((m: any) => m.id === "mock-discovered").enabled).toBe(false);
    expect(catalogRequests.at(-1)).toEqual({ path: "/v1/models", authorization: "Bearer test-key-123" });
    expect(JSON.stringify(result)).not.toContain("test-key-123");
    const staleSave = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "save", expectedRevision: snapshot.revision, provider: snapshot.providers.find((p: any) => p.id === "mock") }) });
    expect(staleSave.status).toBe(409);
    const afterStale = await (await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { headers: { authorization } })).json();
    expect(afterStale.providers.find((p: any) => p.id === "mock").models).toEqual(provider.models);
    const catalog = await rpc("model/list", {});
    expect(catalog.data.some((m: any) => m.model === "mock-discovered")).toBe(false);
    await expect(rpc("thread/start", { cwd: ROOT, model: "mock-discovered", ephemeral: true })).rejects.toThrow(/disabled/);
    const enable = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "model-toggle", id: "mock", modelId: "mock-discovered", enabled: true }) });
    expect(enable.status).toBe(200);
    const started = await rpc("thread/start", { cwd: ROOT, model: "mock-discovered", approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    await rpc("turn/start", { threadId: started.thread.id, model: "mock-discovered", input: [{ type: "text", text: "Newly enabled model" }] });
    const completed = await waitFor(() => notifications.find(note => note.method === "turn/completed" && note.params?.threadId === started.thread.id));
    expect(completed.params.turn.status).toBe("completed");
    expect(providerRequests.at(-1)?.body.model).toBe("mock-discovered");
    expect(disconnects).toBe(before);
  }, 15_000);

  test("failed discovery leaves settings intact and concurrent mutations return 409", async () => {
    const get = async () => (await (await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { headers: { authorization } })).json()).providers;
    const before = await get();
    catalogMode = "unauthorized";
    try {
      const failed = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "refresh", id: "mock" }) });
      expect(failed.status).toBe(400);
      expect(await failed.text()).not.toContain("sensitive provider error body");
      expect(await get()).toEqual(before);
    } finally { catalogMode = "success"; }
    catalogMode = "slow";
    try {
      const count = catalogRequests.length;
      const refreshing = fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "refresh", id: "mock" }) });
      await waitFor(() => catalogRequests.length > count && releaseCatalog ? true : undefined);
      const conflict = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "toggle", id: "mock", enabled: false }) });
      expect(conflict.status).toBe(409);
      releaseCatalog!();
      expect((await refreshing).status).toBe(200);
    } finally { catalogMode = "success";releaseCatalog?.();releaseCatalog = null; }
  }, 15_000);

  test("discovered and manual model ids cannot hijack built-in Codex routing", async () => {
    const nativeCatalog = await rpc("model/list", { limit: 1000, includeHidden: true });
    const nativeId = nativeCatalog.data.find((model: any) => !model.modelProvider).model;
    conflictingNativeId = nativeId;
    try {
      const refreshed = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "refresh", id: "mock" }) });
      expect(refreshed.status).toBe(200);
      const result = await refreshed.json();
      expect(result.refresh.warning).toContain("built-in Codex IDs");
      expect(result.providers.find((p: any) => p.id === "mock").models.some((model: any) => model.id === nativeId)).toBe(false);
      const nativeThread = await rpc("thread/start", { cwd: ROOT, model: nativeId, approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
      expect(nativeThread.modelProvider || nativeThread.thread.modelProvider).toBe("openai");
      const rejected = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ action: "save", provider: { id: "collision", name: "Collision", baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: "unused-fixture", models: [{ id: ` ${nativeId} ` }] } }) });
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).toContain("must not conflict");
    } finally { conflictingNativeId = null; }
  }, 15_000);

  test("validates provider mutations", async () => {
    const reserved = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ action: "save", provider: { id: "openai", name: "x", baseUrl: "https://x.example", models: [{ id: "x" }] } }),
    });
    expect(reserved.status).toBe(400);
    expect(await reserved.json()).toMatchObject({ error: expect.stringMatching(/reserved/i) });
  }, 15_000);

  test("lists persistent cross-provider sessions created after startup, including disabled or removed providers", async () => {
    const mutate = async (payload: any) => {
      const response = await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, {
        method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      expect(response.status).toBe(200);return response.json();
    };
    const waitForRestart = async () => {
      await waitFor(async () => !(await (await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { headers: { authorization } })).json()).codex ? true : undefined);
      await waitFor(async () => (await (await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { headers: { authorization } })).json()).codex ? true : undefined);
    };
    const added = await mutate({ action: "save", provider: {
      id: "history-other", name: "History Other", baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: "history-fixture-key", models: [{ id: "history-other-model" }],
    } });
    expect(added.restarted).toBe(true);
    await waitForRestart();
    const expected = new Map<string, string>();
    for (const [provider, model] of [["mock", "mock-model"], ["history-other", "history-other-model"]]) {
      // Unlike inference smoke tests, these sessions must persist to exercise
      // the real Codex session index. No paid/native OpenAI inference is used.
      const started = await rpc("thread/start", { cwd: ROOT, model, approvalPolicy: "never", sandbox: "read-only", ephemeral: false });
      const threadId = started.thread.id;
      await rpc("turn/start", { threadId, model, input: [{ type: "text", text: "thread-list regression fixture" }] });
      const complete = await waitFor(() => notifications.find(note => note.method === "turn/completed" && note.params?.threadId === threadId));
      expect(complete.params.turn.status).toBe("completed");
      expected.set(threadId, provider);
    }
    const params = { limit: 100, sortKey: "recency_at", sortDirection: "desc" };
    for (const extra of [{}, { modelProviders: null }, { modelProviders: [] }]) {
      const result = await rpc("thread/list", { ...params, ...extra });
      for (const [id, provider] of expected) expect(result.data.find((thread: any) => thread.id === id)?.modelProvider).toBe(provider);
    }
    for (const provider of ["mock", "history-other"]) {
      const result = await rpc("thread/list", { ...params, modelProviders: [provider] });
      expect(result.data.every((thread: any) => thread.modelProvider === provider)).toBe(true);
      expect(result.data.some((thread: any) => expected.get(thread.id) === provider)).toBe(true);
    }
    expect((await rpc("thread/list", { ...params, modelProviders: ["openai"] })).data).toEqual([]);
    expect((await rpc("thread/list", { ...params, archived: true })).data).toEqual([]);
    const paged: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await rpc("thread/list", { ...params, limit: 1, ...(cursor ? { cursor } : {}) });
      expect(result.data.length).toBeLessThanOrEqual(1);
      paged.push(...result.data.map((thread: any) => thread.id));
      cursor = result.nextCursor || undefined;
      if (!cursor) break;
    }
    expect(cursor).toBeUndefined();
    expect(new Set(paged).size).toBe(paged.length);
    for (const id of expected.keys()) expect(paged).toContain(id);

    expect((await mutate({ action: "toggle", id: "mock", enabled: false })).restarted).toBe(false);
    const disabled = await rpc("thread/list", params);
    for (const id of expected.keys()) expect(disabled.data.some((thread: any) => thread.id === id)).toBe(true);
    expect((await mutate({ action: "delete", id: "mock" })).restarted).toBe(true);
    await waitForRestart();
    const removed = await rpc("thread/list", params);
    for (const [id, provider] of expected) {
      expect(removed.data.find((thread: any) => thread.id === id)?.modelProvider).toBe(provider);
      expect((await rpc("thread/read", { threadId: id, includeTurns: false })).thread.id).toBe(id);
    }
    // Both HTTP fallback and WebSocket use the same bridge default.
    const http = await fetch(`http://127.0.0.1:${webuiPort}/api/rpc`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ id: "history-http", method: "thread/list", params }),
    });
    const reply = await http.json();
    expect(reply.type).toBe("rpc/result");
    for (const id of expected.keys()) expect(reply.result.data.some((thread: any) => thread.id === id)).toBe(true);
  }, 30_000);

  test("hand-edited provider files cannot hijack or disable a native model", async () => {
    const catalog = await rpc("model/list", { limit: 1000, includeHidden: true });
    const nativeId = catalog.data.find((model: any) => !model.modelProvider).model;
    for (const enabled of [false, true]) {
      const store = JSON.parse(readFileSync(modelsJsonPath, "utf8"));
      store.providers = store.providers.filter((provider: any) => provider.id !== "file-collision");
      store.providers.push({ id: "file-collision", name: "File Collision", baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: "must-never-route-native-fixture", enabled, models: [{ id: nativeId, enabled }] });
      const raw = JSON.stringify(store, null, 2);
      writeFileSync(modelsJsonPath, raw, { mode: 0o600 });
      ws.terminate();proc.kill("SIGTERM");await proc.exited;
      await launchBridge();
      expect(readFileSync(modelsJsonPath, "utf8")).toBe(raw); // No file migration.
      const view = await (await fetch(`http://127.0.0.1:${webuiPort}/api/providers`, { headers: { authorization } })).json();
      expect(view.warnings.some((warning: string) => warning.includes("ignored for automatic routing"))).toBe(true);
      const listed = await rpc("model/list", { limit: 1000, includeHidden: true });
      expect(listed.data.find((model: any) => model.model === nativeId).modelProvider).toBeUndefined();
      const started = await rpc("thread/start", { cwd: ROOT, model: nativeId, approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
      expect(started.modelProvider || started.thread.modelProvider).toBe("openai");
      await expect(rpc("thread/start", { cwd: ROOT, model: nativeId, modelProvider: "file-collision", ephemeral: true })).rejects.toThrow(/must not conflict/);
      expect(providerRequests.some(request => request.body?.model === nativeId)).toBe(false);
    }
  }, 30_000);
});
