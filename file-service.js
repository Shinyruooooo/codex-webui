import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_FILE_MAX_BYTES = 512 * 1024 * 1024;
export const WORKSPACE_TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
export const WORKSPACE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const inside = (candidate, root) => candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

function canonicalRoots(roots) {
  const result = [];
  for (const root of roots || []) {
    try {
      const canonical = realpathSync(resolve(root));
      if (!result.includes(canonical)) result.push(canonical);
    } catch { /* Ignore unavailable roots. */ }
  }
  return result;
}

function decodePath(value) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function expandFilePath(value, home) {
  const input = String(value || "").trim();
  if (!input || input.length > 8192 || input.includes("\0")) throw new Error("Invalid file path");
  if (/^file:/i.test(input)) return fileURLToPath(input);
  if (/^sandbox:/i.test(input)) return decodePath(input.replace(/^sandbox:/i, ""));
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return resolve(home, decodePath(input.slice(2)));
  return decodePath(input);
}

export function resolveLocalFile(input, {
  cwd = process.cwd(),
  home = process.env.HOME || process.cwd(),
  allowedRoots = [home],
  maxBytes = LOCAL_FILE_MAX_BYTES,
} = {}) {
  const expanded = expandFilePath(input, home);
  const candidate = resolve(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
  const roots = canonicalRoots(allowedRoots);
  if (!roots.length) throw new Error("No file roots are available");

  const metadata = lstatSync(candidate);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("File not found");
  const path = realpathSync(candidate);
  if (path !== candidate || !roots.some(root => inside(path, root))) throw new Error("File is outside allowed roots");
  const realStat = statSync(path);
  if (!realStat.isFile() || realStat.ino !== metadata.ino || realStat.dev !== metadata.dev) throw new Error("File not found");

  const size = realStat.size;
  if (size > maxBytes) throw new Error("File is too large");
  return { path, size, filename: basename(path), ino: realStat.ino, dev: realStat.dev };
}

function canonicalWorkspaceCwd(cwd, allowedRoots) {
  const requested = resolve(cwd);
  const metadata = lstatSync(requested);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("Workspace cwd must be a real directory");
  const canonicalCwd = realpathSync(requested);
  const roots = canonicalRoots(allowedRoots);
  if (!roots.length || !roots.some(root => inside(canonicalCwd, root))) {
    throw new Error("Workspace cwd is outside allowed roots");
  }
  return canonicalCwd;
}

function resolveWorkspaceDirectory(canonicalCwd, relativeDir = "") {
  const input = String(relativeDir || "");
  if (input.includes("\0")) throw new Error("Invalid workspace directory");
  const target = resolve(canonicalCwd, input);
  if (!inside(target, canonicalCwd)) throw new Error("Workspace directory is outside cwd");
  const relativeTarget = relative(canonicalCwd, target);
  const segments = relativeTarget ? relativeTarget.split(sep).filter(Boolean) : [];
  let cursor = canonicalCwd;
  const rootStat = lstatSync(cursor);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || realpathSync(cursor) !== canonicalCwd) {
    throw new Error("Workspace cwd must be a real directory");
  }
  const chain = [{ path: cursor, ino: rootStat.ino, dev: rootStat.dev }];
  for (const segment of segments) {
    if (segment === ".." || segment === ".") throw new Error("Workspace directory is outside cwd");
    cursor = resolve(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Workspace directory must be a real directory");
    if (realpathSync(cursor) !== cursor || !inside(cursor, canonicalCwd)) {
      throw new Error("Workspace directory is outside cwd or contains a symbolic link");
    }
    chain.push({ path: cursor, ino: stat.ino, dev: stat.dev });
  }
  return { path: cursor, chain };
}

function assertDirectoryChainUnchanged(chain) {
  for (const entry of chain) {
    const stat = lstatSync(entry.path);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.ino !== entry.ino || stat.dev !== entry.dev || realpathSync(entry.path) !== entry.path) {
      throw new Error("Workspace directory changed during operation");
    }
  }
}

function hasSensitiveVcsSegment(targetPath) {
  return String(targetPath || "").split(sep).includes(".git");
}

function openVerifiedRegularFile(file, allowedRoots) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
  const fd = openSync(file.path, flags);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.ino !== file.ino || stat.dev !== file.dev) {
      throw new Error("File changed during preview");
    }
    const currentReal = realpathSync(file.path);
    const postStat = lstatSync(file.path);
    const roots = canonicalRoots(allowedRoots);
    if (postStat.isSymbolicLink() || postStat.ino !== stat.ino || postStat.dev !== stat.dev || currentReal !== file.path || !roots.some(root => inside(currentReal, root))) {
      throw new Error("File is outside allowed roots");
    }
    return { fd, size: stat.size };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function writeAllSync(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
    if (!Number.isInteger(written) || written <= 0) throw new Error("Short write during upload");
    offset += written;
  }
}

const toPosix = value => value.split(sep).join("/");
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".svg"]);

export function listWorkspaceDirectory(cwd, relativeDir = "", {
  home = process.env.HOME || process.cwd(),
  allowedRoots = [home],
  showHidden = false,
  limit = 500,
} = {}) {
  const canonicalCwd = canonicalWorkspaceCwd(cwd, allowedRoots);
  const resolved = resolveWorkspaceDirectory(canonicalCwd, relativeDir);
  const target = resolved.path;
  const path = toPosix(relative(canonicalCwd, target));
  const parentPath = dirname(path || ".");
  const parent = !path ? null : parentPath === "." ? "" : parentPath;
  const maxEntries = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 500;
  const candidates = [];

  for (const name of readdirSync(target)) {
    if (name === ".git" || name === "node_modules" && !showHidden || !showHidden && name.startsWith(".")) continue;
    const entryPath = resolve(target, name);
    let metadata;
    try { metadata = lstatSync(entryPath); } catch { continue; }
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) continue;
    candidates.push({ name, path: toPosix(relative(canonicalCwd, entryPath)), kind: metadata.isDirectory() ? "folder" : "file", size: metadata.isFile() ? metadata.size : null });
  }
  candidates.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1) || a.name.localeCompare(b.name));
  return { cwd: canonicalCwd, path, parent, entries: candidates.slice(0, maxEntries), truncated: candidates.length > maxEntries };
}

export function readWorkspaceFilePreview(targetPath, {
  cwd = process.cwd(),
  home = process.env.HOME || process.cwd(),
  allowedRoots = [home],
  maxBytes = WORKSPACE_TEXT_PREVIEW_MAX_BYTES,
} = {}) {
  const file = resolveLocalFile(targetPath, { cwd, home, allowedRoots, maxBytes: Number.MAX_SAFE_INTEGER });
  const canonicalCwd = realpathSync(resolve(cwd));
  const relativePath = inside(file.path, canonicalCwd) ? toPosix(relative(canonicalCwd, file.path)) : null;
  const base = { path: file.path, relativePath, filename: file.filename, size: file.size };
  if (imageExtensions.has(extname(file.filename).toLowerCase())) {
    return { kind: "image", ...base, truncated: false, content: null };
  }
  const byteLimit = Math.max(0, Math.floor(Number(maxBytes) || 0));
  const opened = openVerifiedRegularFile(file, allowedRoots);
  let bytes;
  try {
    bytes = Buffer.alloc(Math.min(opened.size, byteLimit));
    if (bytes.length) {
      const count = readSync(opened.fd, bytes, 0, bytes.length, 0);
      bytes = bytes.subarray(0, count);
    }
  } finally { closeSync(opened.fd); }
  if (bytes.includes(0)) return { kind: "binary", ...base, truncated: false, content: null };
  const extension = extname(file.filename).toLowerCase();
  return {
    kind: extension === ".md" || extension === ".markdown" ? "markdown" : "text",
    ...base,
    truncated: file.size > byteLimit,
    content: bytes.toString("utf8"),
  };
}

export function saveWorkspaceUpload({
  cwd,
  directory = "",
  filename,
  data,
  home = process.env.HOME || process.cwd(),
  allowedRoots = [home],
  maxBytes = WORKSPACE_UPLOAD_MAX_BYTES,
}) {
  if (typeof filename !== "string" || !filename || filename.trim() === "") throw new Error("Upload filename is required");
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) throw new Error("Upload filename must not contain paths or '..'");
  if (/[\u0000-\u001f\u007f]/.test(filename)) throw new Error("Upload filename must not contain control characters");
  const bytes = Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : typeof data === "string" ? Buffer.from(data, "base64") : null;
  if (!bytes) throw new Error("Upload data must be a Buffer, Uint8Array, or base64 string");
  const byteLimit = Number(maxBytes);
  if (!Number.isFinite(byteLimit) || byteLimit < 0) throw new Error("Invalid upload size limit");
  if (bytes.length > byteLimit) throw new Error("Upload is too large");

  const canonicalCwd = canonicalWorkspaceCwd(cwd, allowedRoots);
  const resolved = resolveWorkspaceDirectory(canonicalCwd, directory);
  const target = resolved.path;
  if (hasSensitiveVcsSegment(canonicalCwd) || hasSensitiveVcsSegment(target)) {
    throw new Error("Uploads into .git are not allowed");
  }
  const extension = extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const createFlags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW || 0);
  let index = 1;
  while (true) {
    const savedFilename = index === 1 ? filename : `${stem}-${index}${extension}`;
    const savedPath = resolve(target, savedFilename);
    let fd = null;
    let created = false;
    try {
      assertDirectoryChainUnchanged(resolved.chain);
      fd = openSync(savedPath, createFlags, 0o600);
      created = true;
      const createdStat = fstatSync(fd);
      writeAllSync(fd, bytes);
      closeSync(fd);
      fd = null;
      assertDirectoryChainUnchanged(resolved.chain);
      const postStat = lstatSync(savedPath);
      const canonicalSaved = realpathSync(savedPath);
      if (postStat.isSymbolicLink() || postStat.ino !== createdStat.ino || postStat.dev !== createdStat.dev || dirname(canonicalSaved) !== target || !inside(canonicalSaved, canonicalCwd)) {
        try { unlinkSync(savedPath); } catch {}
        throw new Error("Upload path escaped workspace boundary");
      }
      return {
        path: canonicalSaved,
        relativePath: toPosix(relative(canonicalCwd, canonicalSaved)),
        filename: savedFilename,
        size: bytes.length,
        isImage: imageExtensions.has(extension.toLowerCase()),
      };
    } catch (error) {
      if (fd !== null) { try { closeSync(fd); } catch {} }
      if (error?.code === "EEXIST") { index += 1; continue; }
      if (created) { try { unlinkSync(savedPath); } catch {} }
      throw error;
    }
  }
}
