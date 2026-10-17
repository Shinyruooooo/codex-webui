import { closeSync, createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, extname } from "node:path";
import { gzipSync } from "node:zlib";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { defaultBrowseRoots, isDirectory, listFolders, resolveBrowsePath } from "./server/folder-service.js";
import { applyReviewPatch } from "./server/review-service.js";
import { ReviewDiffStore, parseReviewPatchRequest } from "./server/review-state.js";
import { unifiedDiffFromFileChanges } from "./public/codex-surfaces.js";
import { rpcErrorPayload } from "./public/bridge-errors.js";
import { createTerminalSession, normalizeTerminalResize, resolveTerminalCwd } from "./server/terminal-service.js";
import { readWorkspaceContext } from "./server/workspace-context.js";
import { searchWorkspaceFiles } from "./server/file-search.js";
import { WORKSPACE_UPLOAD_MAX_BYTES, listWorkspaceDirectory, openVerifiedLocalFile, readWorkspaceFilePreview, resolveLocalFile, saveWorkspaceUpload } from "./server/file-service.js";
import { readVerifiedLocalImage, resolveLocalImage } from "./server/image-service.js";
import { LiveSessionStore } from "./server/live-session-service.js";
import {
  assertWritableCodexHome,
  defaultSkillExtraRoots,
  deletePersonalSkill,
  installCuratedOfficialSkill,
  isEditablePersonalSkillPath,
  listCuratedOfficialSkills,
  isOfficialCuratedSkillPath,
  readSkillFile,
  savePersonalSkill,
} from "./server/skill-service.js";
import {
  createLoginRateLimiter,
  createPasswordSession,
  createStoredPassword,
  isAllowedBrowserRpcMethod,
  isAuthorizedHttpRequest,
  isRequestAuthorized,
  passwordSessionCookie,
  resolvePublicAsset,
  resolveSafeRegularFile,
  storedPasswordSessionSecret,
  unauthorizedResponse,
  verifyStoredPassword,
} from "./server/server-security.js";
import { loadStoredPassword, passwordStorePath, saveStoredPassword, type StoredPassword } from "./server/password-store.ts";
import {
  createAccountIdentityLoader,
  fetchProfileAvatar,
  isLocalAccountRequest,
  resolveAccountIdentity,
  toPublicAccountIdentity,
} from "./server/profile-service.ts";

const APP_VERSION = "0.5.1";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8899);
const accessToken = process.env.CODEX_WEBUI_ACCESS_TOKEN || null;
const environmentPassword = process.env.CODEX_WEBUI_PASSWORD || null;
const managedPasswordPath = passwordStorePath();
let managedPassword: StoredPassword | null = environmentPassword || accessToken ? null : loadStoredPassword(managedPasswordPath);
let authSecret = environmentPassword || accessToken || storedPasswordSessionSecret(managedPassword);
let passwordSetupInProgress = false;
const localhostOnly = host === "127.0.0.1" || host === "::1" || host === "localhost";
const appRoot = existsSync(resolve(import.meta.dir, "public")) ? import.meta.dir : resolve(import.meta.dir, "..");
const publicDir = resolve(appRoot, "public");
const homeDir = process.env.HOME || process.cwd();
const projectless = process.env.CODEX_WEBUI_PROJECTLESS === "true";
const configuredReviewRoot = process.env.CODEX_WEBUI_REVIEW_ROOT || null;
const ntfyTopic = process.env.CODEX_WEBUI_NTFY_TOPIC || null;
const ntfyUrl = (process.env.CODEX_WEBUI_NTFY_URL || "https://ntfy.sh").replace(/\/+$/, "");
if (projectless && !configuredReviewRoot) {
  throw new Error("CODEX_WEBUI_REVIEW_ROOT is required when CODEX_WEBUI_PROJECTLESS=true");
}
const defaultCwd = resolve(process.env.CODEX_WEBUI_CWD || (projectless ? homeDir : appRoot));
const reviewRoots = [resolve(configuredReviewRoot || defaultCwd)];
const browseRoots = [...new Set([...defaultBrowseRoots(homeDir), defaultCwd, ...reviewRoots])];
const imageRoots = [...new Set([...browseRoots, resolve(tmpdir()), resolve("/tmp")])];
const fileRoots = [...new Set([...browseRoots, defaultCwd, resolve(tmpdir()), resolve("/tmp")])];
const loginRateLimiter = createLoginRateLimiter();
const clients = new Set<WebSocket>();
const sseClients = new Set<ServerResponse>();
const terminalSessions = new Map<WebSocket, ReturnType<typeof createTerminalSession>>();
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const reviewDiffs = new ReviewDiffStore();
const liveSessions = new LiveSessionStore();
const threadPaths = new Map<string, string>();
let codexHomeDir = resolve(process.env.CODEX_HOME || join(homeDir, ".codex"));
assertWritableCodexHome(codexHomeDir, homeDir);
let codexSessionsRoot = resolve(codexHomeDir, "sessions");
let skillExtraRoots = defaultSkillExtraRoots(homeDir, process.env.CODEX_WEBUI_SKILL_EXTRA_ROOTS || "");
let seq = 1;
let codex: ChildProcessWithoutNullStreams | null = null;
let stdoutBuffer = "";
let connected = false;
let shuttingDown = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let httpClosed = false;
const accountLoader = createAccountIdentityLoader(async (refresh) => {
  const account = await request("account/read", { refreshToken: refresh });
  return resolveAccountIdentity(account);
});

function startCodex() {
  if (shuttingDown) return;
  if (codex && codex.exitCode === null) return;
  const spawnCwd = isDirectory(defaultCwd) ? defaultCwd : isDirectory(homeDir) ? homeDir : process.cwd();
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn("codex", ["app-server", "--stdio"], {
      cwd: spawnCwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
  } catch (error) {
    console.error("[codex-webui] failed to spawn codex app-server:", error);
    connected = false;
    broadcast({ type: "bridge/status", status: "disconnected", code: null, signal: null });
    if (!shuttingDown && !restartTimer) restartTimer = setTimeout(() => { restartTimer = null; startCodex(); }, 2000);
    return;
  }
  codex = child;
  connected = false;
  stdoutBuffer = "";
  let exited = false;
  const handleDown = (code: number | null, signal: NodeJS.Signals | null, reason = "Codex app-server exited") => {
    if (exited) return;
    exited = true;
    connected = false;
    accountLoader.invalidate();
    reviewDiffs.clear();
    broadcast({ type: "bridge/status", status: "disconnected", code, signal });
    for (const item of pending.values()) item.reject(new Error(reason));
    pending.clear();
    if (codex === child) codex = null;
    if (shuttingDown) maybeFinishShutdown();
    else if (!restartTimer) restartTimer = setTimeout(() => { restartTimer = null; startCodex(); }, 1000);
  };
  child.on("error", (error) => {
    console.error("[codex app-server] process error:", error instanceof Error ? error.message : String(error));
    handleDown(null, null, `Codex app-server error: ${error instanceof Error ? error.message : String(error)}`);
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const pos = stdoutBuffer.indexOf("\n");
      if (pos < 0) break;
      const line = stdoutBuffer.slice(0, pos).trim();
      stdoutBuffer = stdoutBuffer.slice(pos + 1);
      if (!line) continue;
      try { handleCodex(JSON.parse(line)); }
      catch (error) { console.error("[codex-webui] invalid app-server JSON:", line, error); }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (data) => console.error("[codex app-server]", String(data).trimEnd()));
  child.on("exit", (code, signal) => handleDown(code, signal));
  initialize().catch((error) => {
    console.error("[codex-webui] initialize failed", error);
    terminateCodex();
  });
}

function terminateCodex(signal: NodeJS.Signals = "SIGTERM") {
  const child = codex;
  if (!child || child.exitCode !== null) return;
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, signal); return; }
    catch { /* Fall back to terminating the wrapper process. */ }
  }
  child.kill(signal);
}

function maybeFinishShutdown() {
  if (shuttingDown && httpClosed && !codex) process.exit(0);
}

function sendRaw(message: any) {
  if (shuttingDown) throw new Error("Codex WebUI is shutting down");
  startCodex();
  codex!.stdin.write(JSON.stringify(message) + "\n");
}

function request(method: string, params: any = {}) {
  const id = seq++;
  sendRaw({ id, method, params });
  return new Promise<any>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex request timed out: ${method}`));
    }, 30000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
  });
}

async function initialize() {
  const result = await request("initialize", {
    clientInfo: { name: "codex-piweb-ui", title: "Codex PiWeb UI", version: APP_VERSION },
    capabilities: { experimentalApi: true },
  });
  sendRaw({ method: "initialized", params: {} });
  if (typeof result?.codexHome === "string") {
    codexHomeDir = resolve(result.codexHome);
    codexSessionsRoot = resolve(codexHomeDir, "sessions");
  }
  skillExtraRoots = defaultSkillExtraRoots(homeDir, process.env.CODEX_WEBUI_SKILL_EXTRA_ROOTS || "");
  if (skillExtraRoots.length > 0) {
    await request("skills/extraRoots/set", { extraRoots: skillExtraRoots }).catch((error) => {
      console.warn("[codex-webui] skills/extraRoots/set failed:", error instanceof Error ? error.message : String(error));
    });
  }
  connected = true;
  broadcast({ type: "bridge/status", status: "connected", info: result });
}

function handleCodex(message: any) {
  if (message.id !== undefined && ("result" in message || "error" in message)) {
    const item = pending.get(Number(message.id));
    if (item) {
      pending.delete(Number(message.id));
      if (message.error) item.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else item.resolve(message.result);
      return;
    }
  }
  if (message.id !== undefined && message.method) {
    broadcast({ type: "codex/request", payload: message });
    return;
  }
  if (message.method) {
    if (message.method === "account/updated") accountLoader.invalidate();
    if (message.method === "turn/diff/updated") reviewDiffs.record(message.params || {});
    if (message.method === "item/fileChange/patchUpdated") recordFileChangeDiff(message.params || {});
    if (message.method === "item/completed" && message.params?.item?.type === "fileChange") {
      recordFileChangeDiff({ ...message.params, changes: message.params.item.changes });
    }
    if (message.method === "turn/completed") notifyNtfyTurnCompleted(message.params || {});
    broadcast({ type: "codex/notification", payload: message });
  }
}

async function notifyNtfyTurnCompleted(params: any) {
  if (!ntfyTopic) return;
  const turnId = typeof params?.turn?.id === "string" ? params.turn.id : "";
  const threadId = typeof params?.threadId === "string" ? params.threadId : "";
  const body = `Codex task completed${threadId ? ` (thread ${threadId.slice(0, 8)})` : ""}`;
  try {
    await fetch(`${ntfyUrl}/${encodeURIComponent(ntfyTopic)}`, {
      method: "POST",
      headers: { Title: "Codex task completed", Tags: "white_check_mark", ...(turnId ? { "X-Turn-Id": turnId } : {}) },
      body,
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error("ntfy notification failed:", error instanceof Error ? error.message : error);
  }
}

function recordFileChangeDiff({ threadId, turnId, changes }: any) {
  const diff = unifiedDiffFromFileChanges(Array.isArray(changes) ? changes : []);
  if (diff) reviewDiffs.record({ threadId, turnId, diff });
}

function recordReviewDiffsFromRpc(method: string, params: any, result: any) {
  if (!["thread/read", "thread/resume", "thread/turns/list"].includes(method)) return;
  const threadId = result?.thread?.id || params?.threadId;
  const turns = result?.thread?.turns || result?.data || [];
  if (typeof threadId !== "string" || !Array.isArray(turns)) return;
  for (const turn of turns) {
    const changes = (turn?.items || []).flatMap((item: any) => item?.type === "fileChange" && Array.isArray(item.changes) ? item.changes : []);
    const diff = unifiedDiffFromFileChanges(changes);
    if (typeof turn?.id === "string" && diff) reviewDiffs.record({ threadId, turnId: turn.id, diff });
  }
}

function recordThreadPathsFromRpc(result: any) {
  const threads = [result?.thread, ...(Array.isArray(result?.data) ? result.data : [])].filter(Boolean);
  for (const thread of threads) {
    if (typeof thread?.id === "string" && typeof thread?.path === "string") threadPaths.set(thread.id, thread.path);
  }
}

function resolveThreadRolloutPath(rawPath: unknown) {
  if (typeof rawPath !== "string" || !rawPath) return null;
  const child = relative(codexSessionsRoot, resolve(rawPath));
  return child && !child.startsWith("..") ? resolveSafeRegularFile(codexSessionsRoot, child) : null;
}

function enrichThreadsWithLiveRollout(result: any) {
  const threads = [result?.thread, ...(Array.isArray(result?.data) ? result.data : [])].filter(Boolean);
  for (const thread of threads) {
    if (typeof thread?.id !== "string") continue;
    const rawPath = typeof thread?.path === "string" ? thread.path : threadPaths.get(thread.id);
    if (typeof rawPath === "string") threadPaths.set(thread.id, rawPath);
    const safePath = resolveThreadRolloutPath(rawPath);
    if (!safePath) continue;
    try {
      const live = liveSessions.read(safePath);
      thread.liveActive = Boolean(live.active);
      thread.liveLastTurnId = live.lastTurnId || null;
      thread.liveLastTurnStatus = live.lastTurnStatus || null;
      if (live.active && thread.status?.type !== "active") {
        thread.status = { type: "active", activeFlags: [] };
      }
    } catch { /* Ignore unreadable or transient rollout files. */ }
  }
}

async function readLiveThread(threadId: unknown) {
  if (typeof threadId !== "string" || !threadId) throw new Error("Invalid thread id");
  let path = threadPaths.get(threadId);
  if (!path) {
    const result = await request("thread/read", { threadId, includeTurns: false });
    recordThreadPathsFromRpc(result);
    path = threadPaths.get(threadId);
  }
  if (!path) return { active: false, turn: null, lastEventAt: null };
  const safePath = resolveThreadRolloutPath(path);
  if (!safePath) throw new Error("Thread rollout is outside the Codex sessions directory");
  return liveSessions.read(safePath);
}

function broadcast(data: any) {
  const text = JSON.stringify(data);
  for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(text);
  for (const client of sseClients) if (!client.writableEnded) client.write(`data: ${text}\n\n`);
}

function sanitizeBrowserRpcParams(method: string, rawParams: any) {
  const params = rawParams && typeof rawParams === "object" ? { ...rawParams } : {};
  if (params.cwd !== undefined && params.cwd !== null) {
    if (typeof params.cwd !== "string" || !params.cwd.trim()) {
      throw new Error("Working directory must be a non-empty string");
    }
    const resolved = resolveBrowsePath(params.cwd, browseRoots, homeDir);
    if (!isDirectory(resolved)) throw new Error("Working directory is not an available directory");
    params.cwd = resolved;
  } else if (method === "thread/start" && !projectless) {
    params.cwd = resolveBrowsePath(defaultCwd, browseRoots, homeDir);
  }
  if (method === "skills/list") {
    if (params.cwds !== undefined && (!Array.isArray(params.cwds) || params.cwds.length > 10)) throw new Error("Invalid skill workspace list");
    params.cwds = (params.cwds?.length ? params.cwds : [defaultCwd]).map((item: unknown) => {
      if (typeof item !== "string" || !item.trim()) throw new Error("Invalid skill workspace");
      const cwd = resolveBrowsePath(item, browseRoots, homeDir);
      if (!isDirectory(cwd)) throw new Error("Skill workspace is not an available directory");
      return cwd;
    });
  }
  return params;
}

async function nativeSkillsFor(cwd: string, forceReload = false) {
  const result = await request("skills/list", { cwds: [cwd], forceReload });
  const entry = result?.data?.find((item: any) => item.cwd === cwd) || result?.data?.[0];
  if (!entry || !Array.isArray(entry.skills)) throw new Error("Codex did not return a skill catalog");
  return entry;
}

async function validateSkillSelection(params: any) {
  const cwd = params.cwd || defaultCwd;
  const entry = await nativeSkillsFor(cwd);
  const selected = entry.skills.find((skill: any) => skill.path === params.path);
  if (!selected) throw new Error("Skill is not in the current Codex catalog");
  return selected;
}

async function dispatchBrowserMessage(message: any) {
  const id = message?.id;
  if (message?.type === "rpc") {
    try {
      if (!isAllowedBrowserRpcMethod(message.method)) throw new Error("RPC method is not available to browser clients");
      const params = sanitizeBrowserRpcParams(message.method, message.params);
      if (message.method === "skills/config/write") {
        if (typeof params.path !== "string" || typeof params.enabled !== "boolean") throw new Error("Skill path and boolean enabled are required");
        assertWritableCodexHome(codexHomeDir, homeDir);
        await validateSkillSelection(params);
        // The catalog lookup is asynchronous; the destination must still be safe
        // when the native configuration write is actually dispatched.
        assertWritableCodexHome(codexHomeDir, homeDir);
        delete params.name;
        delete params.cwd;
      }
      const result = message.method === "host/thread/live"
        ? await readLiveThread(params.threadId)
        : await request(message.method, params);
      recordThreadPathsFromRpc(result);
      if (message.method === "thread/list" || message.method === "thread/read" || message.method === "thread/resume") {
        enrichThreadsWithLiveRollout(result);
      }
      recordReviewDiffsFromRpc(message.method, params, result);
      return { type: "rpc/result", id, result };
    } catch (error) {
      return rpcErrorPayload(id, error);
    }
  }
  if (message?.type === "codex/response") {
    if (!Number.isSafeInteger(message.requestId)) throw new Error("Invalid Codex request id");
    sendRaw({ id: message.requestId, result: message.result });
    return { type: "ack" };
  }
  if (message?.type === "codex/error") {
    if (!Number.isSafeInteger(message.requestId)) throw new Error("Invalid Codex request id");
    sendRaw({ id: message.requestId, error: message.error });
    return { type: "ack" };
  }
  if (message?.type === "ping") return { type: "pong" };
  throw new Error("Unsupported browser bridge message");
}

async function handleClient(client: WebSocket, message: any) {
  try { client.send(JSON.stringify(await dispatchBrowserMessage(message))); }
  catch (error) { client.send(JSON.stringify(rpcErrorPayload(message?.id, error))); }
}

function readJsonBody(req: IncomingMessage, maxBytes = 256_000) {
  return new Promise<any>((resolvePromise, reject) => {
    let body = "", tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", chunk => {
      if (tooLarge) return;
      if (Buffer.byteLength(body) + Buffer.byteLength(chunk) > maxBytes) { tooLarge = true; return; }
      body += chunk;
    });
    req.on("error", reject);
    req.on("end", () => {
      if (tooLarge) return reject(new Error("Bridge payload too large"));
      try { resolvePromise(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid JSON payload")); }
    });
  });
}

function readBinaryBody(req: IncomingMessage, maxBytes = WORKSPACE_UPLOAD_MAX_BYTES) {
  return new Promise<Buffer>((resolvePromise, reject) => {
    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      req.resume();
      const err = new Error("Upload is too large") as Error & { statusCode?: number };
      err.statusCode = 413;
      reject(err);
      return;
    }
    let chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (message: string, statusCode = 400) => {
      if (settled) return;
      settled = true;
      chunks = [];
      const err = new Error(message) as Error & { statusCode?: number };
      err.statusCode = statusCode;
      reject(err);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > maxBytes) {
        req.resume();
        fail("Upload is too large", 413);
        return;
      }
      chunks.push(chunk);
    });
    req.on("aborted", () => fail("Upload aborted", 400));
    req.on("error", error => fail(error.message || "Upload failed", 400));
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks, total));
      chunks = [];
    });
  });
}

function passwordSetupRequired() {
  return !localhostOnly && !authSecret;
}

function browserPasswordConfigured() {
  return Boolean(environmentPassword || managedPassword || accessToken);
}

function requestMatchesSecret(req: IncomingMessage, submittedPassword: string, expectedSecret: string | null) {
  if (!submittedPassword || !expectedSecret) return false;
  return isRequestAuthorized({
    remoteAddress: req.socket.remoteAddress,
    hostHeader: req.headers.host,
    authorization: `Bearer ${submittedPassword}`,
    accessToken: expectedSecret,
    origin: req.headers.origin,
    fetchSite: req.headers["sec-fetch-site"],
    forwardedFor: req.headers["x-forwarded-for"],
    forwarded: req.headers.forwarded,
    realIp: req.headers["x-real-ip"],
    allowLoopback: false,
  });
}

function validBrowserPassword(req: IncomingMessage, submittedPassword: string) {
  if (environmentPassword) return requestMatchesSecret(req, submittedPassword, environmentPassword);
  if (managedPassword) {
    if (!requestMatchesSecret(req, submittedPassword, submittedPassword)) return false;
    return verifyStoredPassword(submittedPassword, managedPassword);
  }
  return requestMatchesSecret(req, submittedPassword, accessToken);
}

function sendAuthError(res: ServerResponse, status: number, error: string, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(JSON.stringify({ error }));
}

function issueBrowserSession(req: IncomingMessage, res: ServerResponse) {
  if (!authSecret) throw new Error("Authentication is not configured");
  const session = createPasswordSession(authSecret);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "set-cookie": passwordSessionCookie(session.token, { secure: Boolean((req.socket as any).encrypted) }),
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify({ ok: true }));
}

function encodeContentDispositionFilename(filename: string) {
  return encodeURIComponent(filename).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

// 静态资源每次都带 ETag 重验，既不会用过期的界面，也避免刷新时重传整个前端包。
const COMPRESSIBLE_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg"]);
const staticAssetCache = new Map<string, { etag: string; raw: Buffer; gzip: Buffer | null }>();

function staticAsset(file: string) {
  const stats = statSync(file);
  const key = `${file}:${stats.size}:${stats.mtimeMs}`;
  let cached = staticAssetCache.get(key);
  if (!cached) {
    const raw = readFileSync(file);
    const compressible = COMPRESSIBLE_EXTENSIONS.has(extname(file).toLowerCase());
    cached = {
      etag: `"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`,
      raw,
      gzip: compressible && raw.length > 1024 ? gzipSync(raw, { level: 6 }) : null,
    };
    staticAssetCache.clear();
    staticAssetCache.set(key, cached);
  }
  return cached;
}

function sendStaticAsset(req: IncomingMessage, res: ServerResponse, file: string) {
  const asset = staticAsset(file);
  if (req.headers["if-none-match"] === asset.etag) {
    res.writeHead(304, { etag: asset.etag, "cache-control": "no-cache", "x-content-type-options": "nosniff" });
    res.end();
    return;
  }
  const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
  const compressed = acceptsGzip && asset.gzip ? asset.gzip : null;
  const body = compressed || asset.raw;
  const headers: Record<string, string> = {
    "content-type": mime[extname(file)] || "application/octet-stream",
    "cache-control": "no-cache",
    "content-length": String(body.length),
    etag: asset.etag,
    vary: "accept-encoding",
  };
  if (compressed) headers["content-encoding"] = "gzip";
  res.writeHead(200, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  let url: URL;
  try { url = new URL(req.url || "/", "http://localhost"); }
  catch {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify({ error: "Invalid request URL" }));
    return;
  }
  const appRoute = req.method === "GET" && (url.pathname === "/" || /^\/settings(?:\/[^/]+)?\/?$/.test(url.pathname));
  const loginAssets = new Set(["/", "/index.html", "/style.css", "/favicon.svg", "/auth-bootstrap.js", "/i18n.js", "/codex-brand.js"]);
  if (url.pathname === "/api/auth/status") {
    const authenticated = isAuthorizedHttpRequest(req, authSecret);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify({
      setupRequired: passwordSetupRequired() && !authenticated,
      passwordRequired: browserPasswordConfigured(),
      authenticated,
    }));
    return;
  }
  if (url.pathname === "/api/auth/setup") {
    if (req.method !== "POST") {
      sendAuthError(res, 405, "Method not allowed", { allow: "POST" });
      return;
    }
    let payload: any;
    try { payload = await readJsonBody(req, 4096); }
    catch (error) {
      sendAuthError(res, 400, error instanceof Error ? error.message : "Invalid setup request");
      return;
    }
    const submittedPassword = typeof payload?.password === "string" ? payload.password : "";
    if (submittedPassword.length < 12 || submittedPassword.length > 256) {
      sendAuthError(res, 400, "Password must be between 12 and 256 characters");
      return;
    }
    if (!requestMatchesSecret(req, submittedPassword, submittedPassword)) {
      sendAuthError(res, 403, "Password setup request was rejected");
      return;
    }
    if (!passwordSetupRequired() || passwordSetupInProgress) {
      sendAuthError(res, 409, "Password setup is no longer available");
      return;
    }
    passwordSetupInProgress = true;
    try {
      const credential = createStoredPassword(submittedPassword) as StoredPassword;
      saveStoredPassword(managedPasswordPath, credential);
      managedPassword = credential;
      authSecret = storedPasswordSessionSecret(credential);
      issueBrowserSession(req, res);
    } catch (error: any) {
      if (error?.code === "EEXIST") {
        try {
          managedPassword = loadStoredPassword(managedPasswordPath);
          authSecret = storedPasswordSessionSecret(managedPassword);
        } catch { /* Keep the original exclusive-create failure as the response. */ }
        sendAuthError(res, 409, "Password setup is no longer available");
      } else {
        console.error("[codex-webui] password setup failed", error);
        sendAuthError(res, 500, "Unable to save the password");
      }
    } finally {
      passwordSetupInProgress = false;
    }
    return;
  }
  if (url.pathname === "/api/auth/login") {
    if (req.method !== "POST") {
      sendAuthError(res, 405, "Method not allowed", { allow: "POST" });
      return;
    }
    const clientIp = req.socket.remoteAddress || "unknown";
    const rate = loginRateLimiter.check(clientIp);
    if (!rate.allowed) {
      sendAuthError(res, 429, "Too many login attempts. Please try again shortly.", { "retry-after": String(rate.retryAfterSeconds) });
      return;
    }
    let payload: any;
    try { payload = await readJsonBody(req, 4096); }
    catch {
      loginRateLimiter.recordFailure(clientIp);
      sendAuthError(res, 401, "Incorrect password");
      return;
    }
    const submittedPassword = typeof payload?.password === "string" ? payload.password : "";
    if (!validBrowserPassword(req, submittedPassword)) {
      const failure = loginRateLimiter.recordFailure(clientIp);
      if (failure.blocked) {
        sendAuthError(res, 429, "Too many login attempts. Please try again shortly.", { "retry-after": String(failure.retryAfterSeconds) });
      } else {
        sendAuthError(res, 401, "Incorrect password");
      }
      return;
    }
    loginRateLimiter.reset(clientIp);
    issueBrowserSession(req, res);
    return;
  }
  if (!isAuthorizedHttpRequest(req, authSecret)) {
    if (appRoute || loginAssets.has(url.pathname)) {
      const file = resolvePublicAsset(appRoute ? "/" : url.pathname, publicDir);
      if (file) {
        sendStaticAsset(req, res, file);
        return;
      }
    }
    unauthorizedResponse(res);
    return;
  }
  if (url.pathname === "/api/events") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    res.flushHeaders?.();
    res.write("retry: 1000\n\n");
    sseClients.add(res);
    res.write(`data: ${JSON.stringify({ type: "bridge/status", status: connected ? "connected" : "connecting" })}\n\n`);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (url.pathname === "/api/rpc" || url.pathname === "/api/codex/respond") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const message = url.pathname === "/api/rpc"
        ? { type: "rpc", id: payload.id, method: payload.method, params: payload.params || {} }
        : { type: payload.error ? "codex/error" : "codex/response", requestId: payload.requestId, result: payload.result, error: payload.error };
      const reply = await dispatchBrowserMessage(message);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(reply));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, codex: connected, version: APP_VERSION }));
    return;
  }
  if (url.pathname === "/api/config") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ home: homeDir, defaultCwd, reviewRoot: reviewRoots[0], projectless }));
    return;
  }
  if (url.pathname === "/api/workspace/context") {
    try {
      const context = readWorkspaceContext(url.searchParams.get("cwd") || defaultCwd, browseRoots);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(context));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/files/tree") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const cwd = url.searchParams.get("cwd") || defaultCwd;
      const path = url.searchParams.get("path") || "";
      const showHidden = url.searchParams.get("hidden") === "1";
      const tree = listWorkspaceDirectory(cwd, path, { home: homeDir, allowedRoots: browseRoots, showHidden });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(tree));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/files/preview") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const cwd = url.searchParams.get("cwd") || defaultCwd;
      const targetPath = url.searchParams.get("path") || "";
      const preview = readWorkspaceFilePreview(targetPath, { cwd, home: homeDir, allowedRoots: fileRoots });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(preview));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/files/upload") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const cwd = url.searchParams.get("cwd") || defaultCwd;
      const directory = url.searchParams.get("dir") || "";
      const filename = url.searchParams.get("filename") || "";
      const data = await readBinaryBody(req, WORKSPACE_UPLOAD_MAX_BYTES);
      const uploaded = saveWorkspaceUpload({
        cwd,
        directory,
        filename,
        data,
        home: homeDir,
        allowedRoots: browseRoots,
        maxBytes: WORKSPACE_UPLOAD_MAX_BYTES,
      });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(uploaded));
    } catch (error) {
      const status = typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : /too large/i.test(String(error)) ? 413 : 400;
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/files/search") {
    try {
      const cwd = url.searchParams.get("cwd") || defaultCwd;
      const query = url.searchParams.get("query") || "";
      const items = await searchWorkspaceFiles(cwd, query, { allowedRoots: browseRoots, limit: 30 });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ cwd, query, items }));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/skills/catalog") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const requestedCwd = url.searchParams.get("cwd") || defaultCwd;
      const cwd = resolveBrowsePath(requestedCwd, browseRoots, homeDir);
      const forceReload = url.searchParams.get("refresh") === "1";
      const skillsEntry = await nativeSkillsFor(cwd, forceReload);
      const skills = skillsEntry.skills.map((skill: any) => {
        const path = String(skill?.path || "");
        const scope = String(skill?.scope || "user");
        const editable = isEditablePersonalSkillPath(path, codexHomeDir);
        const category = scope === "system" || isOfficialCuratedSkillPath(path, codexHomeDir) ? "official" : "personal";
        const sourceKind = scope === "system"
          ? "system"
          : scope === "repo"
            ? "project"
            : editable
              ? "personal"
              : "external";
        return {
          ...skill,
          category,
          sourceKind,
          editable,
        };
      });
      const curated = listCuratedOfficialSkills({ codexHome: codexHomeDir, installedSkills: skills });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({
        cwd,
        codexHome: codexHomeDir,
        personalRoot: resolve(codexHomeDir, "skills"),
        extraRoots: skillExtraRoots,
        skills,
        curated,
        errors: Array.isArray(skillsEntry.errors) ? skillsEntry.errors : [],
      }));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/skills/file") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const targetPath = url.searchParams.get("path") || "";
      const cwd = resolveBrowsePath(url.searchParams.get("cwd") || defaultCwd, browseRoots, homeDir);
      const entry = await nativeSkillsFor(cwd);
      const curated = listCuratedOfficialSkills({ codexHome: codexHomeDir, installedSkills: entry.skills });
      if (!entry.skills.some((skill: any) => skill.path === targetPath) && !curated.some((skill: any) => skill.sourcePath === targetPath)) throw new Error("Skill is not in the current Codex catalog");
      const file = readSkillFile(targetPath, {
        codexHome: codexHomeDir,
        homeDir,
        browseRoots,
        // Exact native/catalog membership was checked above; admin/external skills
        // need read-only access even if their directory is outside workspace browsing roots.
        extraRoots: [...skillExtraRoots, dirname(targetPath)],
      });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(file));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/skills/personal") {
    if (req.method !== "POST" && req.method !== "DELETE") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST, DELETE", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const payload = await readJsonBody(req, 512_000);
      if (req.method === "DELETE") {
        const deleted = deletePersonalSkill({
          name: payload?.name,
          path: payload?.path,
          codexHome: codexHomeDir,
        });
        try { await request("skills/list", { cwds: [defaultCwd], forceReload: true }); } catch {}
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(JSON.stringify(deleted));
        return;
      }
      const saved = savePersonalSkill({
        name: payload?.name,
        content: payload?.content,
        displayName: payload?.displayName,
        description: payload?.description,
        instructions: payload?.instructions,
        overwrite: Boolean(payload?.overwrite),
        codexHome: codexHomeDir,
      });
      try { await request("skills/list", { cwds: [defaultCwd], forceReload: true }); } catch {}
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(saved));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/skills/install") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const payload = await readJsonBody(req, 32_000);
      const installed = installCuratedOfficialSkill({
        id: payload?.id || payload?.name,
        codexHome: codexHomeDir,
      });
      try { await request("skills/list", { cwds: [defaultCwd], forceReload: true }); } catch {}
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(installed));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/files/download") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    let opened: ReturnType<typeof openVerifiedLocalFile> | null = null;
    try {
      opened = openVerifiedLocalFile(url.searchParams.get("path"), {
        cwd: url.searchParams.get("cwd") || defaultCwd,
        home: homeDir,
        allowedRoots: fileRoots,
      });
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(opened.size),
        "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encodeContentDispositionFilename(opened.filename)}`,
        "cache-control": "no-store",
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      });
      const stream = createReadStream("", { fd: opened.fd, autoClose: true });
      opened = null;
      stream.on("error", () => res.destroy());
      req.on("aborted", () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (opened?.fd !== undefined) { try { closeSync(opened.fd); } catch {} }
      res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: "File unavailable" }));
    }
    return;
  }
  if (url.pathname === "/api/images/local") {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const image = readVerifiedLocalImage(url.searchParams.get("path"), {
        cwd: url.searchParams.get("cwd") || defaultCwd,
        home: homeDir,
        allowedRoots: imageRoots,
      });
      res.writeHead(200, {
        "content-type": image.contentType,
        "content-length": String(image.size),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
        "cache-control": "private, max-age=60",
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      });
      res.end(image.bytes);
    } catch {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify({ error: "Image unavailable" }));
    }
    return;
  }
  if (url.pathname === "/api/account" || url.pathname === "/api/account/avatar") {
    const proxied = Boolean(req.headers["x-forwarded-for"] || req.headers.forwarded || req.headers["x-real-ip"]);
    if (proxied || !isLocalAccountRequest(req.socket.remoteAddress, req.headers.host, req.headers["sec-fetch-site"] as string | undefined)) {
      res.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Account identity is available only on localhost" }));
      return;
    }
    try {
      const account = await accountLoader.get(url.searchParams.get("refresh") === "1");
      if (url.pathname === "/api/account") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(JSON.stringify(toPublicAccountIdentity(account)));
        return;
      }
      if (!account.imageUrl) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "No profile avatar" }));
        return;
      }
      const avatar = await fetchProfileAvatar(account.imageUrl);
      res.writeHead(200, {
        "content-type": avatar.contentType,
        "content-length": String(avatar.body.byteLength),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      });
      res.end(avatar.body);
    } catch (error) {
      console.warn("[codex-webui] account request failed:", error instanceof Error ? error.message : String(error));
      if (url.pathname === "/api/account/avatar") {
        res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "Profile avatar unavailable" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(toPublicAccountIdentity(await resolveAccountIdentity({ account: null, requiresOpenaiAuth: true }))));
    }
    return;
  }
  if (url.pathname === "/api/folders") {
    try {
      const path = resolveBrowsePath(url.searchParams.get("path") || "~", browseRoots, homeDir);
      if (!isDirectory(path)) throw new Error("Directory not found");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(listFolders(path, browseRoots)));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (url.pathname === "/api/review/patch") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy(new Error("Review patch payload too large"));
    });
    req.on("end", async () => {
      let requestPayload: ReturnType<typeof parseReviewPatchRequest> | null = null;
      let operationStarted = false;
      let success = false;
      try {
        const payload = JSON.parse(body || "{}");
        requestPayload = parseReviewPatchRequest(payload);
        const stored = reviewDiffs.begin(requestPayload.threadId, requestPayload.turnId, requestPayload.action);
        operationStarted = true;
        const threadResult = await request("thread/read", { threadId: requestPayload.threadId, includeTurns: false });
        const cwd = threadResult?.thread?.cwd;
        if (typeof cwd !== "string" || !cwd) throw new Error("Thread working directory is unavailable");
        const result = await applyReviewPatch({ cwd, diff: stored.diff, action: requestPayload.action }, reviewRoots);
        success = true;
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } finally {
        if (operationStarted && requestPayload) reviewDiffs.finish(requestPayload.threadId, requestPayload.turnId, requestPayload.action, success);
      }
    });
    return;
  }
  if (url.pathname.startsWith("/vendor/katex/")) {
    let relative;
    try { relative = decodeURIComponent(url.pathname.slice("/vendor/katex/".length)); }
    catch { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
    const katexDir = resolve(appRoot, "node_modules/katex/dist");
    const file = resolveSafeRegularFile(katexDir, relative);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return;
    }
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "public, max-age=86400" });
    res.end(readFileSync(file));
    return;
  }
  if (url.pathname === "/vendor/xterm/xterm.css") {
    const xtermDir = resolve(appRoot, "node_modules/@xterm/xterm/css");
    const file = resolveSafeRegularFile(xtermDir, "xterm.css");
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return;
    }
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=86400" });
    res.end(readFileSync(file));
    return;
  }
  const file = resolvePublicAsset(appRoute ? "/" : url.pathname, publicDir);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return;
  }
  sendStaticAsset(req, res, file);
});

const sseKeepalive = setInterval(() => {
  for (const client of sseClients) if (!client.writableEnded) client.write(": keepalive\n\n");
}, 25_000);
sseKeepalive.unref();

const wss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  let pathname = "";
  try { pathname = new URL(req.url || "/", "http://localhost").pathname; }
  catch { socket.destroy(); return; }
  if ((pathname !== "/ws" && pathname !== "/terminal") || !isAuthorizedHttpRequest(req, authSecret)) {
    const body = JSON.stringify({ error: "Authentication required" });
    socket.end([
      "HTTP/1.1 401 Unauthorized",
      "Connection: close",
      'WWW-Authenticate: Basic realm="Codex WebUI", charset="UTF-8"',
      "Content-Type: application/json; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "X-Content-Type-Options: nosniff",
      "",
      body,
    ].join("\r\n"));
    return;
  }
  const target = pathname === "/terminal" ? terminalWss : wss;
  target.handleUpgrade(req, socket, head, client => target.emit("connection", client, req));
});
wss.on("connection", (client) => {
  clients.add(client);
  client.send(JSON.stringify({ type: "bridge/status", status: connected ? "connected" : "connecting" }));
  client.on("message", (raw) => {
    try { handleClient(client, JSON.parse(String(raw))); }
    catch (error) { client.send(JSON.stringify({ type: "rpc/error", error: String(error) })); }
  });
  client.on("close", () => clients.delete(client));
});
terminalWss.on("connection", (client, req) => {
  let terminal: ReturnType<typeof createTerminalSession> | null = null;
  try {
    const url = new URL(req.url || "/terminal", "http://localhost");
    const cwd = resolveTerminalCwd(url.searchParams.get("cwd"), browseRoots, defaultCwd);
    terminal = createTerminalSession({
      cwd,
      cols: 100,
      rows: 24,
      onData: data => { if (client.readyState === WebSocket.OPEN) client.send(data); },
      onExit: event => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(`\r\n[Process exited ${event.exitCode}]\r\n`);
          client.close(1000, "Terminal exited");
        }
      },
    });
    terminalSessions.set(client, terminal);
  } catch (error) {
    console.error("[codex-webui] terminal failed", error);
    client.close(1011, "Terminal unavailable");
    return;
  }
  client.on("message", (raw, isBinary) => {
    if (!terminal || raw.byteLength > 1_000_000) return;
    if (isBinary) {
      terminal.write(Buffer.from(raw as Buffer).toString("utf8"));
      return;
    }
    try {
      const resize = normalizeTerminalResize(JSON.parse(String(raw)));
      if (resize) terminal.resize(resize.cols, resize.rows);
    } catch { /* Terminal input is sent as binary; ignore malformed control frames. */ }
  });
  client.on("close", () => {
    terminalSessions.delete(client);
    terminal?.kill();
    terminal = null;
  });
  client.on("error", () => client.close());
});

const frontendBuild = await Bun.build({
  entrypoints: [resolve(publicDir, "app.js")],
  outdir: publicDir,
  naming: "app.bundle.js",
  target: "browser",
  minify: false,
});
if (!frontendBuild.success) throw new Error(`Frontend build failed: ${frontendBuild.logs.join("\n")}`);

startCodex();
server.listen(port, host, () => {
  console.log(`Codex WebUI listening on http://${host}:${port}`);
  if (passwordSetupRequired()) console.warn(`[codex-webui] LAN password setup is required; the first LAN visitor will create it in ${managedPasswordPath}`);
  if (!localhostOnly) {
    const addresses = Object.values(networkInterfaces()).flat().filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.family === "IPv4" && !entry.internal);
    for (const entry of addresses) console.log(`LAN: http://${entry.address}:${port} (authentication required)`);
  }
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  connected = false;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  clearInterval(sseKeepalive);
  for (const item of pending.values()) item.reject(new Error("Codex WebUI is shutting down"));
  pending.clear();
  for (const client of clients) client.terminate();
  clients.clear();
  for (const client of sseClients) client.end();
  sseClients.clear();
  wss.close();
  for (const [client, terminal] of terminalSessions) { terminal.kill(); client.terminate(); }
  terminalSessions.clear();
  terminalWss.close();
  terminateCodex();
  server.close(() => { httpClosed = true; maybeFinishShutdown(); });
  server.closeAllConnections?.();
  const forceExit = setTimeout(() => {
    terminateCodex("SIGKILL");
    process.exit(0);
  }, 5000);
  forceExit.unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
