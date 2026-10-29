// Mock `codex app-server` used by the sign-in integration test.
//
// It speaks the same stdio JSON-RPC as the real app-server, but answers the
// account methods with fixed data and pushes the login completion on its own.
// The test copies this file to a temporary `bin/codex` so the WebUI spawns it
// instead of the real Codex binary; no network access is required.
import { createInterface } from "node:readline";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const loginId = "login-test-0001";
const userCode = "TEST-CODE";
const verificationUrl = "https://auth.openai.com/codex/device";
const codexHome = process.env.CODEX_HOME || "/tmp/mock-codex-home";

let seq = 0;
const pendingCompletions = new Map();

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function reply(id, result) {
  send({ id, result });
}

function fail(id, code, message) {
  send({ id, error: { code, message } });
}

function notify(method, params) {
  send({ method, params });
}

// The mock reports an unsigned-in account until a login completes. The state
// lives in the Codex home, so a restarted bridge still sees the signed-in
// account, the way the real credential store behaves.
const authPath = join(codexHome, "auth.json");
let signedIn = existsSync(authPath);

function persistAuth() {
  writeFileSync(authPath, JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: "acct_mock" } }, null, 2), { mode: 0o600 });
}

function handle(id, method, params) {
  switch (method) {
    case "initialize":
      return reply(id, { codexHome, platformFamily: "unix", platformOs: "linux", userAgent: "mock-app-server" });
    case "model/list":
      return reply(id, { data: [] });
    case "config/read":
      return reply(id, { config: { model_provider: "openai" } });
    case "skills/extraRoots/set":
      return reply(id, {});
    case "account/read":
      return reply(id, signedIn
        ? { account: { type: "chatgpt", email: "operator@example.com", planType: "pro" }, requiresOpenaiAuth: false }
        : { account: null, requiresOpenaiAuth: true });
    case "account/login/start": {
      if (params?.type !== "chatgptDeviceCode") return fail(id, -32602, "Unsupported login type");
      // The completion arrives on its own, the way the real device-code flow
      // reports the result of the browser sign-in.
      const timer = setTimeout(() => {
        signedIn = true;
        persistAuth();
        notify("account/login/completed", { loginId, success: true, error: null });
        notify("account/updated", {});
      }, 600);
      pendingCompletions.set(loginId, timer);
      return reply(id, { type: "chatgptDeviceCode", loginId, userCode, verificationUrl });
    }
    case "account/login/cancel": {
      const timer = pendingCompletions.get(params?.loginId);
      if (timer) {
        clearTimeout(timer);
        pendingCompletions.delete(params.loginId);
      }
      return reply(id, { status: "cancelled" });
    }
    case "account/logout":
      signedIn = false;
      rmSync(authPath, { force: true });
      return reply(id, {});
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

const reader = createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try { message = JSON.parse(text); } catch { return; }
  if (typeof message.method === "string") handle(message.id, message.method, message.params || {});
  else if (message.method === "initialized") { /* nothing to do */ }
});
reader.on("close", () => {
  for (const timer of pendingCompletions.values()) clearTimeout(timer);
  process.exit(0);
});
process.on("SIGTERM", () => process.exit(0));
void seq;
