import {
  closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync,
  fchmodSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmdirSync,
  writeSync, unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export const SKILL_FILE_MAX_BYTES = 512 * 1024;
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BUNDLE_FILES = 2000;
const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
const MAX_BUNDLE_FILE_BYTES = 5 * 1024 * 1024;
// A self-declared local repository origin used only as a source hint, not a cryptographic trust proof.
const OFFICIAL_REMOTE = "https://github.com/openai/skills.git";

const inside = (candidate, root) => candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
const validSkillName = (name) => typeof name === "string" && name.length <= 64 && SKILL_NAME_PATTERN.test(name);

function assertNoSymlinkPath(path, { allowMissing = false } = {}) {
  const absolute = resolve(path);
  const parsed = absolute.split(sep).filter(Boolean);
  let cursor = sep;
  for (const part of parsed) {
    cursor = join(cursor, part);
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in skill paths: ${cursor}`);
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissing) return;
      throw error;
    }
  }
}

function canonicalDir(dirPath) {
  try {
    assertNoSymlinkPath(dirPath);
    const stat = lstatSync(dirPath);
    if (!stat.isDirectory()) return null;
    return realpathSync(dirPath);
  } catch {
    return null;
  }
}

function protectedPiRoot(homeDir = homedir()) {
  return resolve(homeDir, ".pi");
}

function descriptorRoot() {
  if (process.platform === "linux" && existsSync("/proc/self/fd")) return "/proc/self/fd";
  if (process.platform === "darwin" && existsSync("/dev/fd")) return "/dev/fd";
  throw new Error("Descriptor-anchored skill access is unavailable on this platform");
}

function fdPath(fd, child = "") {
  return join(descriptorRoot(), String(fd), child);
}

function openDirectoryPath(path, { create = false } = {}) {
  const absolute = resolve(path);
  const flags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | (fsConstants.O_NOFOLLOW || 0);
  let fd = openSync(sep, flags);
  try {
    for (const part of absolute.split(sep).filter(Boolean)) {
      const childPath = fdPath(fd, part);
      let childFd;
      try {
        childFd = openSync(childPath, flags);
      } catch (error) {
        if (error?.code !== "ENOENT" || !create) throw error;
        try { mkdirSync(childPath, { mode: 0o755 }); }
        catch (mkdirError) { if (mkdirError?.code !== "EEXIST") throw mkdirError; }
        childFd = openSync(childPath, flags);
      }
      if (!fstatSync(childFd).isDirectory()) {
        closeSync(childFd);
        throw new Error(`Expected a real directory: ${part}`);
      }
      closeSync(fd);
      fd = childFd;
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function openDirectoryChild(parentFd, name, { create = false } = {}) {
  if (!name || name === "." || name === ".." || name.includes(sep) || name.includes("\0")) throw new Error("Invalid directory entry name");
  const path = fdPath(parentFd, name);
  const flags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | (fsConstants.O_NOFOLLOW || 0);
  try { return openSync(path, flags); }
  catch (error) {
    if (error?.code !== "ENOENT" || !create) throw error;
    try { mkdirSync(path, { mode: 0o755 }); }
    catch (mkdirError) { if (mkdirError?.code !== "EEXIST") throw mkdirError; }
    return openSync(path, flags);
  }
}

function assertDescriptorPath(fd, expectedPath, homeDir = homedir()) {
  const expected = resolve(expectedPath);
  assertNoSymlinkPath(expected);
  const actual = realpathSync(fdPath(fd));
  if (actual !== expected) throw new Error("Verified skill directory moved during operation");
  if (inside(actual, protectedPiRoot(homeDir))) throw new Error("Writes to ~/.pi are not allowed");
}

export function assertWritableCodexHome(codexHome, homeDir = homedir()) {
  if (typeof codexHome !== "string" || !codexHome.trim()) throw new Error("CODEX_HOME must be a non-empty path");
  const root = resolve(codexHome);
  const protectedRoot = protectedPiRoot(homeDir);
  if (inside(root, protectedRoot)) throw new Error("CODEX_HOME must not be inside protected ~/.pi");
  assertNoSymlinkPath(root, { allowMissing: true });
  try {
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory()) throw new Error("CODEX_HOME must be a real directory");
    const canonicalRoot = realpathSync(root);
    let canonicalPi;
    try { canonicalPi = realpathSync(protectedRoot); } catch {}
    if (canonicalPi && inside(canonicalRoot, canonicalPi)) throw new Error("CODEX_HOME resolves inside protected ~/.pi");
    const configPath = join(root, "config.toml");
    try {
      const configStat = lstatSync(configPath);
      if (configStat.isSymbolicLink() || !configStat.isFile() || configStat.nlink !== 1) throw new Error("CODEX_HOME config.toml must not be a symlink, hard link, or special file");
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return root;
}

function requireMutationDescriptors() {
  if (process.platform !== "linux" || !existsSync("/proc/self/fd")) {
    throw new Error("Skill mutations require Linux /proc/self/fd descriptor anchoring on this platform");
  }
}

export function normalizeSkillName(raw) {
  if (!validSkillName(raw)) {
    throw new Error("Skill name must use lowercase letters, numbers, and hyphens (e.g. my-skill)");
  }
  return raw;
}

export function buildSkillMarkdownTemplate({ name, displayName = "", description = "", instructions = "" }) {
  const safeName = normalizeSkillName(name);
  const desc = String(description || "Describe when Codex should use this skill and what workflow it owns.").replace(/\r?\n/g, " ").trim();
  const title = String(displayName || safeName).trim();
  const body = String(instructions || "").trim() || [
    `# ${title}`,
    "",
    "## When to use",
    `- ${desc}`,
    "",
    "## Instructions",
    "- Step 1: Inspect the relevant files or inputs.",
    "- Step 2: Execute the workflow and verify outputs.",
  ].join("\n");
  return ["---", `name: ${safeName}`, `description: ${JSON.stringify(desc)}`, "---", "", body, ""].join("\n");
}

export function defaultSkillExtraRoots(homeDir, configuredExtra = "") {
  const roots = [];
  for (const candidate of String(configuredExtra || "").split(",")) {
    const value = candidate.trim().replace(/^~(?=$|[\\/])/, homeDir);
    if (!value) continue;
    const real = canonicalDir(resolve(value));
    if (real && !roots.includes(real)) roots.push(real);
  }
  return roots;
}

function verifiedRegularStatAt(parentFd, name, { rejectHardlinks = false } = {}) {
  const path = fdPath(parentFd, name);
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`Not a regular file: ${name}`);
  if (rejectHardlinks && before.nlink !== 1) throw new Error(`Refusing destructive operation on hard-linked file: ${name}`);
  const fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0) | (fsConstants.O_NONBLOCK || 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("File changed while opening");
    if (rejectHardlinks && opened.nlink !== 1) throw new Error(`Refusing destructive operation on hard-linked file: ${name}`);
    return opened;
  } finally { closeSync(fd); }
}

function readRegularFileAt(parentFd, name, { maxBytes = SKILL_FILE_MAX_BYTES, rejectHardlinks = false } = {}) {
  const path = fdPath(parentFd, name);
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`Not a regular file: ${name}`);
  if (rejectHardlinks && before.nlink !== 1) throw new Error(`Refusing destructive operation on hard-linked file: ${name}`);
  if (before.size > maxBytes) throw new Error(`File is too large: ${name}`);
  const fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0) | (fsConstants.O_NONBLOCK || 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("File changed while opening");
    if (rejectHardlinks && opened.nlink !== 1) throw new Error(`Refusing destructive operation on hard-linked file: ${name}`);
    if (opened.size > maxBytes) throw new Error(`File is too large: ${name}`);
    const chunks = [];
    let total = 0;
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes + 1 - total), null);
      if (!count) break;
      total += count;
      if (total > maxBytes) throw new Error(`File is too large: ${name}`);
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== total) throw new Error("File changed while reading");
    const bytes = Buffer.concat(chunks);
    return { bytes, content: bytes.toString("utf8"), stat: after };
  } finally {
    closeSync(fd);
  }
}

function safeRegularFile(path, options = {}) {
  const parentFd = openDirectoryPath(dirname(resolve(path)));
  try { return readRegularFileAt(parentFd, basename(path), options); }
  finally { closeSync(parentFd); }
}

function parseSkillMarkdown(content) {
  if (typeof content !== "string") throw new Error("Skill content must be text");
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error("Skill content must start with YAML frontmatter");
  let metadata;
  try {
    metadata = Bun.YAML.parse(match[1]);
  } catch (error) {
    throw new Error(`Invalid YAML frontmatter: ${error?.message || error}`);
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("YAML frontmatter must be a mapping");
  if (!validSkillName(metadata.name)) throw new Error("Frontmatter name must be a valid lowercase skill name");
  if (typeof metadata.description !== "string" || !metadata.description.trim()) throw new Error("Frontmatter description must be a non-empty string");
  return { metadata, header: match[1], body: normalized.slice(match[0].length) };
}

function updateFrontmatter(content, expectedName, description) {
  const parsed = parseSkillMarkdown(content);
  if (parsed.metadata.name !== expectedName) throw new Error(`Frontmatter name must match skill name "${expectedName}"`);
  if (description !== undefined && description !== null && description !== "") {
    if (typeof description !== "string" || !description.trim()) throw new Error("Description must be a non-empty string");
    if (parsed.metadata.description === description.trim()) return content.replace(/\r\n/g, "\n");
    // Preserve optional metadata and the submitted instruction body when the separate
    // description field changes. Only the YAML header needs reserialization.
    const metadata = { ...parsed.metadata, description: description.trim() };
    return `---\n${Bun.YAML.stringify(metadata)}\n---\n${parsed.body}`;
  }
  return content.replace(/\r\n/g, "\n");
}

function allowedSkillReadRoots({ codexHome, homeDir, browseRoots = [], extraRoots = [] }) {
  const roots = [];
  for (const item of [join(codexHome, "skills"), join(codexHome, "vendor_imports", "skills"), ...browseRoots, ...extraRoots]) {
    const real = canonicalDir(resolve(String(item || "")));
    if (real && !roots.includes(real)) roots.push(real);
  }
  return roots;
}

export function isEditablePersonalSkillPath(filePath, codexHome, homeDir = homedir()) {
  let rootFd, skillFd;
  try {
    rootFd = openDirectoryPath(join(codexHome, "skills"));
    const root = realpathSync(fdPath(rootFd));
    assertNoSymlinkPath(filePath);
    const canonical = realpathSync(resolve(filePath));
    const protectedRoot = protectedPiRoot(homeDir);
    if (inside(canonical, protectedRoot)) return false;
    try { if (inside(canonical, realpathSync(protectedRoot))) return false; } catch {}
    const rel = relative(root, canonical);
    const parts = rel.split(sep).filter(Boolean);
    if (!inside(canonical, root) || parts.length !== 2 || !validSkillName(parts[0]) || parts[1] !== "SKILL.md") return false;
    skillFd = openDirectoryChild(rootFd, parts[0]);
    const fileStat = verifiedRegularStatAt(skillFd, "SKILL.md", { rejectHardlinks: true });
    return fileStat.isFile() && realpathSync(fdPath(skillFd, "SKILL.md")) === canonical;
  } catch {
    return false;
  } finally {
    if (skillFd !== undefined) closeSync(skillFd);
    if (rootFd !== undefined) closeSync(rootFd);
  }
}

export function readSkillFile(targetPath, { codexHome, homeDir, browseRoots = [], extraRoots = [] }) {
  const input = String(targetPath || "").trim();
  if (!input || input.includes("\0")) throw new Error("Invalid skill file path");
  const candidate = resolve(isAbsolute(input) ? input : resolve(homeDir, input));
  if (basename(candidate) !== "SKILL.md") throw new Error("Only SKILL.md files can be read through the skills API");
  const roots = allowedSkillReadRoots({ codexHome, homeDir, browseRoots, extraRoots });
  if (!roots.some((root) => inside(candidate, root))) throw new Error("Skill file is outside allowed skill roots");
  assertNoSymlinkPath(candidate);
  const canonical = realpathSync(candidate);
  const parentFd = openDirectoryPath(dirname(candidate));
  try {
    const result = readRegularFileAt(parentFd, basename(candidate), { maxBytes: SKILL_FILE_MAX_BYTES });
    const verifiedPath = realpathSync(fdPath(parentFd, basename(candidate)));
    if (verifiedPath !== canonical) throw new Error("Skill file changed during read");
    return {
      path: verifiedPath,
      name: basename(dirname(verifiedPath)),
      size: result.stat.size,
      editable: isEditablePersonalSkillPath(verifiedPath, codexHome, homeDir),
      content: result.content,
    };
  } finally { closeSync(parentFd); }
}

function writeExclusive(path, content, mode = 0o644, { preserveExecuteBits = false } = {}) {
  const fd = openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0), mode);
  try {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    if (preserveExecuteBits) {
      const currentMode = fstatSync(fd).mode & 0o777;
      fchmodSync(fd, (currentMode & ~0o111) | (mode & 0o111));
    }
  } finally {
    closeSync(fd);
  }
}

function atomicWriteSkillFileAt(parentFd, name, content, overwrite) {
  const parent = fdPath(parentFd);
  const path = join(parent, name);
  const temp = join(parent, `.${name}-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  let tempCreated = false;
  try {
    const output = content.endsWith("\n") ? content : `${content}\n`;
    writeExclusive(temp, output);
    tempCreated = true;
    const tempStat = lstatSync(temp);
    if (tempStat.isSymbolicLink() || !tempStat.isFile() || tempStat.nlink !== 1) throw new Error("Unsafe temporary skill file");
    let previous;
    try {
      previous = lstatSync(path);
      if (previous.isSymbolicLink() || !previous.isFile()) throw new Error("Refusing to replace non-regular skill file");
      if (previous.nlink !== 1) throw new Error("Refusing destructive write to hard-linked skill file");
      if (!overwrite) throw new Error("Skill file already exists");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (previous) {
      const now = lstatSync(path);
      if (now.dev !== previous.dev || now.ino !== previous.ino || now.nlink !== 1 || now.isSymbolicLink()) throw new Error("Skill file changed before replacement");
    } else {
      try { lstatSync(path); throw new Error("Skill file already exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    renameSync(temp, path);
    tempCreated = false;
  } finally {
    if (tempCreated) {
      try { unlinkSync(temp); } catch {}
    }
  }
}

export function savePersonalSkill({ name, content, displayName = "", description = "", instructions = "", overwrite = false, codexHome }) {
  const skillName = normalizeSkillName(name);
  if (content !== undefined && content !== null && typeof content !== "string") throw new Error("Skill content must be text");
  if (description !== undefined && description !== null && typeof description !== "string") throw new Error("Description must be text");
  let body;
  if (typeof content === "string" && content.trim()) {
    body = updateFrontmatter(content, skillName, description || undefined);
  } else {
    if (description !== undefined && typeof description !== "string") throw new Error("Description must be text");
    body = buildSkillMarkdownTemplate({ name: skillName, displayName, description, instructions });
    parseSkillMarkdown(body);
  }
  if (Buffer.byteLength(body, "utf8") > SKILL_FILE_MAX_BYTES) throw new Error("Skill content is too large");
  requireMutationDescriptors();
  assertWritableCodexHome(codexHome);
  const personalRootPath = resolve(codexHome, "skills");
  const rootFd = openDirectoryPath(personalRootPath, { create: true });
  let skillFd;
  let createdDir = false;
  let createdIdentity;
  try {
    try { skillFd = openDirectoryChild(rootFd, skillName); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const entryPath = fdPath(rootFd, skillName);
      try { mkdirSync(entryPath, { mode: 0o755 }); createdDir = true; }
      catch (mkdirError) { if (mkdirError?.code !== "EEXIST") throw mkdirError; }
      skillFd = openDirectoryChild(rootFd, skillName);
    }
    if (createdDir) createdIdentity = fstatSync(skillFd);
    if (!createdDir && !overwrite) throw new Error(`Skill "${skillName}" already exists`);
    assertDescriptorPath(rootFd, personalRootPath);
    assertDescriptorPath(skillFd, join(personalRootPath, skillName));
    atomicWriteSkillFileAt(skillFd, "SKILL.md", body, Boolean(overwrite));
    const saved = readRegularFileAt(skillFd, "SKILL.md", { maxBytes: SKILL_FILE_MAX_BYTES, rejectHardlinks: true });
    return { name: skillName, path: realpathSync(fdPath(skillFd, "SKILL.md")), editable: true, content: saved.content };
  } catch (error) {
    if (skillFd !== undefined) { closeSync(skillFd); skillFd = undefined; }
    if (createdDir && createdIdentity) {
      try { removeTreeAt(rootFd, skillName, { rejectHardlinks: true, expectedStat: createdIdentity }); } catch {}
    }
    throw error;
  } finally {
    if (skillFd !== undefined) closeSync(skillFd);
    closeSync(rootFd);
  }
}

function officialRepoRoot(codexHome) {
  const repoRoot = resolve(codexHome, "vendor_imports", "skills");
  try {
    assertNoSymlinkPath(repoRoot);
    const configPath = join(repoRoot, ".git", "config");
    const config = safeRegularFile(configPath, { maxBytes: 64 * 1024 }).content;
    const origin = config.split(/(?=^\s*\[)/m).find((section) => /^\s*\[remote\s+"origin"\]\s*$/m.test(section.split(/\r?\n/, 1)[0] || ""));
    const originUrl = origin?.match(/^\s*url\s*=\s*(.*?)\s*$/m)?.[1];
    if (originUrl !== OFFICIAL_REMOTE) return null;
    const stat = lstatSync(repoRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    return realpathSync(repoRoot);
  } catch {
    return null;
  }
}

function curatedDirectory(codexHome, id) {
  if (!validSkillName(id)) return null;
  const repo = officialRepoRoot(codexHome);
  if (!repo) return null;
  const curatedRoot = join(repo, "skills", ".curated");
  try {
    assertNoSymlinkPath(curatedRoot);
    const canonicalRoot = canonicalDir(curatedRoot);
    const skillDir = join(curatedRoot, id);
    const canonicalSkillDir = canonicalDir(skillDir);
    if (!canonicalRoot || !canonicalSkillDir || dirname(canonicalSkillDir) !== canonicalRoot) return null;
    validateBundle(canonicalSkillDir);
    const skillFile = join(canonicalSkillDir, "SKILL.md");
    const { content } = safeRegularFile(skillFile, { maxBytes: SKILL_FILE_MAX_BYTES, rejectHardlinks: true });
    const metadata = parseSkillMarkdown(content).metadata;
    if (metadata.name !== id) return null;
    return { repo, root: canonicalRoot, dir: canonicalSkillDir, file: skillFile };
  } catch {
    return null;
  }
}

function validateBundleAt(rootFd) {
  let fileCount = 0;
  let entryCount = 0;
  let totalBytes = 0;
  const walk = (dirFd, depth = 0) => {
    if (depth > 64) throw new Error("Curated skill bundle is nested too deeply");
    for (const name of readdirSync(fdPath(dirFd))) {
      entryCount += 1;
      if (entryCount > MAX_BUNDLE_FILES * 2) throw new Error("Curated skill bundle contains too many entries");
      const path = fdPath(dirFd, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Bundle contains a symbolic link: ${name}`);
      if (stat.isDirectory()) {
        const childFd = openDirectoryChild(dirFd, name);
        try { walk(childFd, depth + 1); } finally { closeSync(childFd); }
      } else if (stat.isFile()) {
        if (stat.nlink !== 1) throw new Error(`Bundle contains a hard-linked file: ${name}`);
        fileCount += 1;
        totalBytes += stat.size;
        if (fileCount > MAX_BUNDLE_FILES || stat.size > MAX_BUNDLE_FILE_BYTES || totalBytes > MAX_BUNDLE_BYTES) throw new Error("Curated skill bundle exceeds limits");
      } else throw new Error(`Bundle contains a special file: ${name}`);
    }
  };
  walk(rootFd);
  const skillStat = lstatSync(fdPath(rootFd, "SKILL.md"));
  if (!fileCount || skillStat.isSymbolicLink() || !skillStat.isFile()) throw new Error("Curated bundle must contain a regular SKILL.md");
}

function validateBundle(root) {
  const rootFd = openDirectoryPath(root);
  try { validateBundleAt(rootFd); } finally { closeSync(rootFd); }
}

function copyBundle(sourceFd, targetFd) {
  let totalBytes = 0;
  let files = 0;
  let entries = 0;
  const copyDir = (srcFd, dstFd, depth = 0) => {
    if (depth > 64) throw new Error("Curated skill bundle is nested too deeply");
    for (const name of readdirSync(fdPath(srcFd))) {
      entries += 1;
      if (entries > MAX_BUNDLE_FILES * 2) throw new Error("Curated skill bundle contains too many entries");
      const srcPath = fdPath(srcFd, name);
      const stat = lstatSync(srcPath);
      if (stat.isSymbolicLink()) throw new Error(`Bundle contains a symbolic link: ${name}`);
      if (stat.isDirectory()) {
        mkdirSync(fdPath(dstFd, name), { mode: 0o755 });
        const childSource = openDirectoryChild(srcFd, name);
        const childTarget = openDirectoryChild(dstFd, name);
        try { copyDir(childSource, childTarget, depth + 1); }
        finally { closeSync(childSource); closeSync(childTarget); }
      } else if (stat.isFile()) {
        if (stat.nlink !== 1) throw new Error(`Bundle contains a hard-linked file: ${name}`);
        files += 1;
        if (files > MAX_BUNDLE_FILES || stat.size > MAX_BUNDLE_FILE_BYTES) throw new Error("Curated skill bundle exceeds limits");
        const read = readRegularFileAt(srcFd, name, { maxBytes: MAX_BUNDLE_FILE_BYTES, rejectHardlinks: true });
        totalBytes += read.bytes.length;
        if (totalBytes > MAX_BUNDLE_BYTES) throw new Error("Curated skill bundle exceeds limits");
        writeExclusive(fdPath(dstFd, name), read.bytes, 0o644 | (stat.mode & 0o111), { preserveExecuteBits: true });
      } else throw new Error(`Bundle contains a special file: ${name}`);
    }
  };
  copyDir(sourceFd, targetFd);
}

function bundleContentsEqual(a, b) {
  let leftFd, rightFd;
  try {
    leftFd = openDirectoryPath(a);
    rightFd = openDirectoryPath(b);
    validateBundleAt(leftFd);
    validateBundleAt(rightFd);
    const compare = (left, right) => {
      const leftEntries = readdirSync(fdPath(left)).sort();
      const rightEntries = readdirSync(fdPath(right)).sort();
      if (leftEntries.length !== rightEntries.length || leftEntries.some((entry, index) => entry !== rightEntries[index])) return false;
      for (const name of leftEntries) {
        const lp = lstatSync(fdPath(left, name)), rp = lstatSync(fdPath(right, name));
        if (lp.isDirectory() !== rp.isDirectory() || lp.isFile() !== rp.isFile()) return false;
        if (lp.isDirectory()) {
          const leftChild = openDirectoryChild(left, name), rightChild = openDirectoryChild(right, name);
          try { if (!compare(leftChild, rightChild)) return false; }
          finally { closeSync(leftChild); closeSync(rightChild); }
        } else {
          const leftFile = readRegularFileAt(left, name, { maxBytes: MAX_BUNDLE_FILE_BYTES });
          const rightFile = readRegularFileAt(right, name, { maxBytes: MAX_BUNDLE_FILE_BYTES });
          if ((lp.mode & 0o111) !== (rp.mode & 0o111) || !leftFile.bytes.equals(rightFile.bytes)) return false;
        }
      }
      return true;
    };
    return compare(leftFd, rightFd);
  } catch {
    return false;
  } finally {
    if (leftFd !== undefined) closeSync(leftFd);
    if (rightFd !== undefined) closeSync(rightFd);
  }
}

/** Local source hint based on the cache's self-declared origin and byte-identical bundle; not a cryptographic guarantee. */
export function isOfficialCuratedSkillPath(filePath, codexHome) {
  let parentFd;
  try {
    const candidate = resolve(filePath);
    if (basename(candidate) !== "SKILL.md") return false;
    assertNoSymlinkPath(candidate);
    const canonical = realpathSync(candidate);
    parentFd = openDirectoryPath(dirname(candidate));
    readRegularFileAt(parentFd, "SKILL.md", { maxBytes: SKILL_FILE_MAX_BYTES });
    if (realpathSync(fdPath(parentFd, "SKILL.md")) !== canonical) return false;
    const id = basename(dirname(canonical));
    if (!validSkillName(id)) return false;
    const source = curatedDirectory(codexHome, id);
    if (!source) return false;
    if (canonical === source.file) return true;
    const personalRoot = canonicalDir(join(codexHome, "skills"));
    if (!personalRoot || dirname(dirname(canonical)) !== personalRoot || join(personalRoot, id, "SKILL.md") !== canonical) return false;
    return bundleContentsEqual(source.dir, dirname(canonical));
  } catch {
    return false;
  } finally { if (parentFd !== undefined) closeSync(parentFd); }
}

export function listCuratedOfficialSkills({ codexHome }) {
  const repo = officialRepoRoot(codexHome);
  if (!repo) return [];
  const cachePath = join(codexHome, "vendor_imports", "skills-curated-cache.json");
  let catalog = [];
  try {
    catalog = JSON.parse(safeRegularFile(cachePath, { maxBytes: 2 * 1024 * 1024 }).content)?.skills;
    if (!Array.isArray(catalog)) catalog = [];
  } catch { return []; }
  return catalog.filter((entry) => entry && validSkillName(entry.id)).map((entry) => {
    const source = curatedDirectory(codexHome, entry.id);
    const installedPath = join(codexHome, "skills", entry.id, "SKILL.md");
    const installed = isOfficialCuratedSkillPath(installedPath, codexHome);
    return {
      id: entry.id,
      name: typeof entry.name === "string" ? entry.name : entry.id,
      displayName: typeof entry.name === "string" ? entry.name : entry.id,
      description: typeof entry.description === "string" ? entry.description : "",
      shortDescription: typeof entry.shortDescription === "string" ? entry.shortDescription : (typeof entry.description === "string" ? entry.description : ""),
      repoPath: typeof entry.repoPath === "string" ? entry.repoPath : `skills/.curated/${entry.id}`,
      sourcePath: source?.file || null,
      availableLocal: Boolean(source),
      installed,
      category: "official-curated",
    };
  });
}

export function installCuratedOfficialSkill({ id, codexHome }) {
  const skillName = normalizeSkillName(id);
  const source = curatedDirectory(codexHome, skillName);
  if (!source) throw new Error(`Curated skill "${skillName}" is not available in the local skills cache with the expected origin hint`);
  requireMutationDescriptors();
  assertWritableCodexHome(codexHome);
  const sourceFd = openDirectoryPath(source.dir);
  let rootFd;
  const personalRootPath = resolve(codexHome, "skills");
  try { rootFd = openDirectoryPath(personalRootPath, { create: true }); }
  catch (error) { closeSync(sourceFd); throw error; }
  let targetFd;
  let createdIdentity;
  let created = false;
  try {
    validateBundleAt(sourceFd);
    const sourceSkill = readRegularFileAt(sourceFd, "SKILL.md", { maxBytes: SKILL_FILE_MAX_BYTES, rejectHardlinks: true });
    if (parseSkillMarkdown(sourceSkill.content).metadata.name !== skillName) throw new Error("Curated skill metadata does not match its directory name");
    assertDescriptorPath(rootFd, personalRootPath);
    try { mkdirSync(fdPath(rootFd, skillName), { mode: 0o755 }); created = true; }
    catch (error) { if (error?.code === "EEXIST") throw new Error(`Skill "${skillName}" is already installed`); throw error; }
    targetFd = openDirectoryChild(rootFd, skillName);
    createdIdentity = fstatSync(targetFd);
    assertDescriptorPath(targetFd, join(personalRootPath, skillName));
    copyBundle(sourceFd, targetFd);
    const installedSkill = readRegularFileAt(targetFd, "SKILL.md", { maxBytes: SKILL_FILE_MAX_BYTES, rejectHardlinks: true });
    if (parseSkillMarkdown(installedSkill.content).metadata.name !== skillName) throw new Error("Installed skill metadata validation failed");
    assertDescriptorPath(rootFd, personalRootPath);
    assertDescriptorPath(targetFd, join(personalRootPath, skillName));
    return { name: skillName, path: realpathSync(fdPath(targetFd, "SKILL.md")), editable: true };
  } catch (error) {
    if (targetFd !== undefined) { closeSync(targetFd); targetFd = undefined; }
    if (created && createdIdentity) {
      try { removeTreeAt(rootFd, skillName, { rejectHardlinks: true, expectedStat: createdIdentity }); } catch {}
    }
    throw error;
  } finally {
    if (targetFd !== undefined) closeSync(targetFd);
    closeSync(rootFd);
    closeSync(sourceFd);
  }
}

function validateTreeAt(parentFd, name, { rejectHardlinks = true } = {}) {
  const walk = (dirFd) => {
    for (const entry of readdirSync(fdPath(dirFd))) {
      const stat = lstatSync(fdPath(dirFd, entry));
      if (stat.isSymbolicLink()) throw new Error("Refusing operation on a tree containing symbolic links");
      if (stat.isDirectory()) {
        const child = openDirectoryChild(dirFd, entry);
        try { walk(child); } finally { closeSync(child); }
      } else if (stat.isFile()) {
        if (rejectHardlinks && stat.nlink !== 1) throw new Error("Refusing operation on a tree containing hard-linked files");
      } else throw new Error("Refusing operation on a tree containing special files");
    }
  };
  const rootFd = openDirectoryChild(parentFd, name);
  try { walk(rootFd); } finally { closeSync(rootFd); }
}

function removeTreeAt(parentFd, name, { rejectHardlinks = true, expectedStat } = {}) {
  const path = fdPath(parentFd, name);
  const stat = lstatSync(path);
  if (expectedStat && (stat.dev !== expectedStat.dev || stat.ino !== expectedStat.ino)) throw new Error("Refusing rollback after target directory changed");
  if (stat.isSymbolicLink()) throw new Error("Refusing to remove a symbolic link as a skill directory");
  if (stat.isDirectory()) {
    const childFd = openDirectoryChild(parentFd, name);
    try {
      const opened = fstatSync(childFd);
      if (opened.dev !== stat.dev || opened.ino !== stat.ino || (expectedStat && (opened.dev !== expectedStat.dev || opened.ino !== expectedStat.ino))) throw new Error("Skill directory changed before deletion");
      for (const entry of readdirSync(fdPath(childFd))) removeTreeAt(childFd, entry, { rejectHardlinks });
      const remaining = lstatSync(path);
      if (remaining.isSymbolicLink() || remaining.dev !== opened.dev || remaining.ino !== opened.ino) throw new Error("Skill directory changed before removal");
      rmdirSync(path);
    } finally { closeSync(childFd); }
  } else if (stat.isFile()) {
    if (rejectHardlinks && stat.nlink !== 1) throw new Error("Refusing destructive operation on a hard-linked file");
    unlinkSync(path);
  } else throw new Error("Refusing to remove a tree containing special files");
}

export function deletePersonalSkill({ name, path, codexHome }) {
  requireMutationDescriptors();
  assertWritableCodexHome(codexHome);
  let skillName;
  if (typeof path === "string" && path.trim()) {
    const resolved = resolve(path.trim());
    const candidateDir = basename(resolved) === "SKILL.md" ? dirname(resolved) : resolved;
    if (dirname(candidateDir) !== resolve(codexHome, "skills")) throw new Error("Only personal skills directly under ~/.codex/skills can be deleted");
    skillName = basename(candidateDir);
  } else skillName = normalizeSkillName(name);
  normalizeSkillName(skillName);
  const personalRootPath = resolve(codexHome, "skills");
  const rootFd = openDirectoryPath(personalRootPath);
  let targetFd;
  try {
    targetFd = openDirectoryChild(rootFd, skillName);
    assertDescriptorPath(rootFd, personalRootPath);
    assertDescriptorPath(targetFd, join(personalRootPath, skillName));
    validateTreeAt(rootFd, skillName, { rejectHardlinks: true });
    assertDescriptorPath(rootFd, personalRootPath);
    assertDescriptorPath(targetFd, join(personalRootPath, skillName));
    const targetPath = realpathSync(fdPath(targetFd));
    removeTreeAt(rootFd, skillName, { rejectHardlinks: true, expectedStat: fstatSync(targetFd) });
    return { deleted: skillName, path: targetPath };
  } finally {
    if (targetFd !== undefined) closeSync(targetFd);
    closeSync(rootFd);
  }
}
