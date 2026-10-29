import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listWorkspaceDirectory,
  readWorkspaceFilePreview,
  resolveLocalFile,
  saveWorkspaceUpload,
  WORKSPACE_TEXT_PREVIEW_MAX_BYTES,
  WORKSPACE_UPLOAD_MAX_BYTES,
} from "../server/file-service.js";

function temporaryWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), "codex-webui-workspace-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

describe("local agent file download boundary", () => {
  test("resolves absolute, relative, file URL and sandbox file references inside an allowed root", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-webui-file-"));
    const folder = join(root, "generated files");
    const file = join(folder, "report.txt");
    try {
      mkdirSync(folder);
      writeFileSync(file, "download me");
      const canonicalFile = realpathSync(file);
      expect(resolveLocalFile(file, { cwd: root, home: root, allowedRoots: [root] })).toMatchObject({ path: canonicalFile, filename: "report.txt", size: 11 });
      expect(resolveLocalFile("./generated%20files/report.txt", { cwd: root, home: root, allowedRoots: [root] }).path).toBe(canonicalFile);
      expect(resolveLocalFile(new URL(`file://${file}`).href, { cwd: root, home: root, allowedRoots: [root] }).path).toBe(canonicalFile);
      expect(resolveLocalFile(`sandbox:${file.replaceAll(" ", "%20")}`, { cwd: root, home: root, allowedRoots: [root] }).path).toBe(canonicalFile);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects paths outside the boundary, directories, symbolic links, invalid paths and oversized files", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-webui-file-root-"));
    const outside = mkdtempSync(join(tmpdir(), "codex-webui-file-outside-"));
    try {
      const outsideFile = join(outside, "outside.txt");
      const localFile = join(root, "large.bin");
      writeFileSync(outsideFile, "outside");
      writeFileSync(localFile, Buffer.alloc(8));
      symlinkSync(outsideFile, join(root, "linked.txt"));

      expect(() => resolveLocalFile(outsideFile, { cwd: root, home: root, allowedRoots: [root] })).toThrow();
      expect(() => resolveLocalFile(root, { cwd: root, home: root, allowedRoots: [root] })).toThrow();
      expect(() => resolveLocalFile(join(root, "linked.txt"), { cwd: root, home: root, allowedRoots: [root] })).toThrow();
      expect(() => resolveLocalFile(localFile, { cwd: root, home: root, allowedRoots: [root], maxBytes: 4 })).toThrow();
      expect(() => resolveLocalFile("bad\0path", { cwd: root, home: root, allowedRoots: [root] })).toThrow();
      expect(() => resolveLocalFile("a".repeat(8193), { cwd: root, home: root, allowedRoots: [root] })).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("workspace directory listing", () => {
  test("returns sorted one-level entries, filters hidden items and marks truncation", () => {
    const { cwd, cleanup } = temporaryWorkspace();
    try {
      mkdirSync(join(cwd, "z-folder"));
      mkdirSync(join(cwd, "a-folder"));
      mkdirSync(join(cwd, ".hidden-dir"));
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, "node_modules"));
      writeFileSync(join(cwd, "b.txt"), "123");
      writeFileSync(join(cwd, "a.txt"), "x");
      writeFileSync(join(cwd, ".secret"), "hidden");
      symlinkSync(join(cwd, "a-folder"), join(cwd, "linked-dir"));

      const listing = listWorkspaceDirectory(cwd, "", { home: cwd, allowedRoots: [cwd], limit: 2 });
      expect(listing).toMatchObject({ cwd: realpathSync(cwd), path: "", parent: null, truncated: true });
      expect(listing.entries.map(entry => [entry.name, entry.kind, entry.size])).toEqual([
        ["a-folder", "folder", null], ["z-folder", "folder", null],
      ]);
      expect(listWorkspaceDirectory(cwd, "", { home: cwd, allowedRoots: [cwd], showHidden: true }).entries.map(entry => entry.name)).toEqual([
        ".hidden-dir", "a-folder", "node_modules", "z-folder", ".secret", "a.txt", "b.txt",
      ]);
      expect(listWorkspaceDirectory(cwd, "a-folder", { home: cwd, allowedRoots: [cwd] })).toMatchObject({ path: "a-folder", parent: "", entries: [] });
      expect(() => listWorkspaceDirectory(cwd, "../", { home: cwd, allowedRoots: [cwd] })).toThrow();
      expect(() => listWorkspaceDirectory(cwd, "linked-dir", { home: cwd, allowedRoots: [cwd] })).toThrow();
      expect(() => listWorkspaceDirectory(cwd, "", { home: cwd, allowedRoots: [join(cwd, "a-folder")] })).toThrow();
    } finally { cleanup(); }
  });
});

describe("workspace file previews", () => {
  test("returns bounded text, markdown, binary and image previews with canonical paths", () => {
    const { cwd, cleanup } = temporaryWorkspace();
    try {
      writeFileSync(join(cwd, "readme.md"), "# heading\nmore");
      writeFileSync(join(cwd, "long.txt"), "0123456789");
      writeFileSync(join(cwd, "binary.dat"), Buffer.from([65, 0, 66]));
      writeFileSync(join(cwd, "picture.SVG"), "<svg/>");
      const opts = { cwd, home: cwd, allowedRoots: [cwd] };
      expect(readWorkspaceFilePreview("readme.md", opts)).toMatchObject({
        kind: "markdown", relativePath: "readme.md", filename: "readme.md", size: 14, truncated: false, content: "# heading\nmore",
      });
      expect(readWorkspaceFilePreview("long.txt", { ...opts, maxBytes: 4 })).toMatchObject({ kind: "text", truncated: true, content: "0123" });
      expect(readWorkspaceFilePreview("binary.dat", opts)).toMatchObject({ kind: "binary", truncated: false, content: null });
      expect(readWorkspaceFilePreview("picture.SVG", opts)).toMatchObject({ kind: "image", truncated: false, content: null });
      expect(readWorkspaceFilePreview("readme.md", { ...opts, maxBytes: 0 })).toMatchObject({ kind: "markdown", truncated: true, content: "" });
      expect(readWorkspaceFilePreview("readme.md", { ...opts, maxBytes: 1234 }).size).toBe(14);
      expect(WORKSPACE_TEXT_PREVIEW_MAX_BYTES).toBe(256 * 1024);
      expect(() => readWorkspaceFilePreview(join(tmpdir(), "missing-file"), opts)).toThrow();
    } finally { cleanup(); }
  });
});

describe("workspace uploads", () => {
  test("writes bytes under the workspace and chooses a non-overwriting unique filename", () => {
    const { cwd, cleanup } = temporaryWorkspace();
    try {
      mkdirSync(join(cwd, "uploads"));
      writeFileSync(join(cwd, "uploads", "image.png"), "existing");
      const options = { cwd, directory: "uploads", home: cwd, allowedRoots: [cwd] };
      const first = saveWorkspaceUpload({ ...options, filename: "image.png", data: Buffer.from("one") });
      const second = saveWorkspaceUpload({ ...options, filename: "image.png", data: new Uint8Array([2, 3]) });
      const third = saveWorkspaceUpload({ ...options, filename: "image.png", data: Buffer.from("three").toString("base64") });
      expect(first).toMatchObject({ filename: "image-2.png", relativePath: "uploads/image-2.png", size: 3, isImage: true });
      expect(second).toMatchObject({ filename: "image-3.png", size: 2 });
      expect(third).toMatchObject({ filename: "image-4.png", size: 5 });
      expect(readFileSync(first.path, "utf8")).toBe("one");
      expect(saveWorkspaceUpload({ ...options, filename: "notes.txt", data: Buffer.from("hello"), maxBytes: 5 })).toMatchObject({ filename: "notes.txt", size: 5, isImage: false });
      expect(WORKSPACE_UPLOAD_MAX_BYTES).toBe(25 * 1024 * 1024);
    } finally { cleanup(); }
  });

  test("rejects unsafe names, oversized data, paths outside cwd and .git destinations", () => {
    const { cwd, cleanup } = temporaryWorkspace();
    try {
      mkdirSync(join(cwd, ".git"));
      const opts = { cwd, home: cwd, allowedRoots: [cwd], data: Buffer.from("x") };
      for (const filename of ["", "../evil.txt", "a/b", "a\\b", "bad\nname"]) {
        expect(() => saveWorkspaceUpload({ ...opts, filename })).toThrow();
      }
      expect(() => saveWorkspaceUpload({ ...opts, filename: "large", maxBytes: 0 })).toThrow(/too large/i);
      expect(() => saveWorkspaceUpload({ ...opts, filename: "safe.txt", directory: "../" })).toThrow();
      expect(() => saveWorkspaceUpload({ ...opts, filename: "safe.txt", directory: ".git" })).toThrow(/\.git/);
      expect(() => saveWorkspaceUpload({ ...opts, cwd: join(cwd, ".git"), filename: "safe.txt" })).toThrow(/\.git/);
      expect(() => saveWorkspaceUpload({ ...opts, filename: "safe.txt", allowedRoots: [join(cwd, ".git")] })).toThrow();
      for (const filename of [".env", ".bashrc", "id_rsa", "server.pem", "private.key"]) {
        expect(() => saveWorkspaceUpload({ ...opts, filename })).toThrow(/not allowed/i);
      }
      expect(() => saveWorkspaceUpload({ ...opts, filename: "../../x" })).toThrow();
      mkdirSync(join(cwd, ".ssh"));
      expect(() => saveWorkspaceUpload({ ...opts, filename: "authorized_keys", directory: ".ssh" })).toThrow(/not allowed/i);
    } finally { cleanup(); }
  });
});
