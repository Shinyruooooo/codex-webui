import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

/**
 * ChatGPT sign-in through the bridge.
 *
 * The WebUI can start a ChatGPT device-code sign-in, so no CLI login is
 * needed first. These tests drive it against a mock app-server: they check the
 * code and verification page reach the browser, that the pending sign-in is
 * cleared once Codex reports completion, that the browser RPC surface stays
 * narrow, and that no credential ever leaves the server.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const authorization = `Basic ${Buffer.from("codex:integration-access-token").toString("base64")}`;

let proc: Subprocess;
let ws: WebSocket;
let seq = 1;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

const testHome = mkdtempSync(join(tmpdir(), "codex-signin-test-"));
const testCodexHome = join(testHome, ".codex");
const mockBin = join(testHome, "bin");
const mockCodex = join(mockBin, "codex");
let webuiPort = 0;

function rpc(method: string, params: any = {}) {
  const id = seq++;
  ws.send(JSON.stringify({ type: "rpc", id, method, params }));
  return new Promise<any>((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function loginStatus() {
  const response = await fetch(`http://127.0.0.1:${webuiPort}/api/login/status`, { headers: { authorization } });
  return response.json();
}

beforeAll(async () => {
  mkdirSync(testCodexHome, { recursive: true });
  mkdirSync(mockBin, { recursive: true });
  // The WebUI spawns `codex` from PATH; the mock takes its place.
  copyFileSync(join(ROOT, "tests/fixtures/mock-app-server.mjs"), mockCodex);
  const script = readFileSync(mockCodex, "utf8");
  writeFileSync(mockCodex, `#!/usr/bin/env bun\n${script}`);
  chmodSync(mockCodex, 0o755);
  writeFileSync(join(testCodexHome, "config.toml"), 'model = "gpt-5-codex"\n');

  webuiPort = 0;
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
  webuiPort = probe.port;
  probe.stop(true);

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
      PATH: `${mockBin}:${process.env.PATH}`,
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { headers: { authorization } });
      const body = await response.json();
      if (body.codex) break;
    } catch { /* not up yet */ }
    if (Date.now() - started > 30_000) throw new Error("Timed out waiting for the WebUI bridge");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  ws = new WebSocket(`ws://127.0.0.1:${webuiPort}/ws`, { headers: { authorization } });
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "rpc/result" || message.type === "rpc/error") {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      message.type === "rpc/result" ? item.resolve(message.result) : item.reject(new Error(typeof message.error === "string" ? message.error : message.error?.message || "rpc error"));
    }
  });
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
}, 60_000);

afterAll(async () => {
  ws?.terminate();
  if (proc) {
    proc.kill("SIGTERM");
    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 7000)),
    ]);
    if (!exited) {
      proc.kill("SIGKILL");
      await proc.exited;
    }
  }
  rmSync(testHome, { recursive: true, force: true });
});

describe("ChatGPT device-code sign-in", () => {
  test("reports that no account is signed in before the flow starts", async () => {
    const status = await loginStatus();
    expect(status.signedIn).toBe(false);
    expect(status.accountType).toBe("unknown");
    expect(status.pending).toBe(null);
  });

  test("returns the device code and the verification page to the browser", async () => {
    const result = await rpc("account/login/start", { type: "chatgptDeviceCode" });
    expect(result.userCode).toBe("TEST-CODE");
    expect(result.verificationUrl).toBe("https://auth.openai.com/codex/device");
    expect(result.loginId).toBeString();
    // No credential material may reach the browser.
    expect(JSON.stringify(result)).not.toMatch(/token|password|secret/i);
  });

  test("keeps the pending sign-in visible and clears it once Codex reports completion", async () => {
    const status = await loginStatus();
    expect(status.pending?.userCode).toBe("TEST-CODE");
    expect(status.pending?.verificationUrl).toBe("https://auth.openai.com/codex/device");
    expect(JSON.stringify(status)).not.toMatch(/access_token|refresh_token/i);

    const started = Date.now();
    for (;;) {
      const next = await loginStatus();
      if (!next.pending) break;
      if (Date.now() - started > 20_000) throw new Error("The pending sign-in was never cleared");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const settled = await loginStatus();
    expect(settled.pending).toBe(null);
    expect(settled.signedIn).toBe(true);
  });

  test("keeps the browser RPC surface narrow", async () => {
    await expect(rpc("account/read")).rejects.toThrow(/not available to browser clients/i);
    await expect(rpc("account/usage/read")).rejects.toThrow(/not available to browser clients/i);
    await expect(rpc("config/read")).rejects.toThrow(/not available to browser clients/i);
  });

  test("ignores a login type the browser tries to choose", async () => {
    const result = await rpc("account/login/start", { type: "apiKey", apiKey: "sk-not-a-real-key" });
    // The server pins the device-code flow, so an API key never travels to
    // the app-server through the browser RPC surface.
    expect(result.userCode).toBe("TEST-CODE");
    expect(JSON.stringify(result)).not.toContain("sk-not-a-real-key");
  });

  test("reports the account as signed out again after a logout", async () => {
    await rpc("account/logout", {});
    const status = await loginStatus();
    expect(status.signedIn).toBe(false);
    expect(status.accountType).toBe("unknown");
    expect(status.pending).toBe(null);
  });
});
