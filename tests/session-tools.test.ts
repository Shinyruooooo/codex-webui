import { describe, expect, test } from "bun:test";
import {
  ARCHIVED_THREADS_STORAGE_KEY,
  DRAFT_STORAGE_PREFIX,
  buildConversationInput,
  draftStorageKey,
  exportFilename,
  formatThreadExportMarkdown,
  readArchivedThreads,
  readThreadDraft,
  writeArchivedThreads,
  writeThreadDraft,
} from "../public/session-tools.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

describe("session tools", () => {
  test("builds stable keys and reads/writes draft data safely", () => {
    const storage = memoryStorage();
    expect(DRAFT_STORAGE_PREFIX).toBe("codex-webui-draft:");
    expect(draftStorageKey("thread-1", "/work")).toBe("codex-webui-draft:thread:thread-1");
    expect(draftStorageKey(null, "")).toBe("codex-webui-draft:new:~");
    expect(draftStorageKey(null, "/work")).toBe("codex-webui-draft:new:/work");

    expect(readThreadDraft("thread-1", "", storage)).toEqual({ text: "", mentions: [], attachments: [] });
    writeThreadDraft("thread-1", "", { text: " hello ", mentions: [{ path: "/a" }], attachments: [{ path: "/img.png", isImage: true }] }, storage);
    expect(readThreadDraft("thread-1", "", storage)).toEqual({ text: " hello ", mentions: [{ path: "/a" }], attachments: [{ path: "/img.png", isImage: true }] });
    writeThreadDraft("thread-1", "", { text: "  ", mentions: [], attachments: [] }, storage);
    expect(storage.values.has(draftStorageKey("thread-1"))).toBe(false);

    storage.setItem(draftStorageKey(null, "/bad"), "not json");
    expect(readThreadDraft(null, "/bad", storage)).toEqual({ text: "", mentions: [], attachments: [] });
  });

  test("ignores storage failures", () => {
    const failingStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    };
    expect(readThreadDraft("x", "", failingStorage)).toEqual({ text: "", mentions: [], attachments: [] });
    expect(() => writeThreadDraft("x", "", { text: "draft" }, failingStorage)).not.toThrow();
    expect(() => writeThreadDraft("x", "", {}, failingStorage)).not.toThrow();
  });

  test("constructs text, file mentions, and deduplicated image inputs", () => {
    expect(buildConversationInput({
      text: "Review these",
      mentions: [
        { type: "file", path: "src/a.ts", title: "a.ts" },
        { type: "file", path: "src/a.ts", name: "duplicate" },
        { type: "folder", path: "src", name: "src" },
      ],
      attachments: [
        { relativePath: "notes.txt", fullPath: "/work/notes.txt" },
        { path: "notes.txt" },
        { isImage: true, fullPath: "/work/image.png" },
        { kind: "image", path: "/work/image.png" },
      ],
    })).toEqual([
      { type: "text", text: "Review these\n\nAttached files: @notes.txt" },
      { type: "mention", name: "a.ts", path: "src/a.ts" },
      { type: "mention", name: "src", path: "src" },
      { type: "localImage", path: "/work/image.png" },
    ]);
    expect(buildConversationInput({
      text: "See @notes.txt and @\"docs/my guide.md\"",
      attachments: [{ relativePath: "notes.txt" }],
    })).toEqual([
      { type: "text", text: "See @notes.txt and @\"docs/my guide.md\"" },
      { type: "mention", name: "notes.txt", path: "notes.txt" },
      { type: "mention", name: "my guide.md", path: "docs/my guide.md" },
    ]);
    expect(buildConversationInput({ attachments: [{ kind: "image", path: "/tmp/pic.png" }] })).toEqual([
      { type: "text", text: "" },
      { type: "localImage", path: "/tmp/pic.png" },
    ]);
    expect(buildConversationInput({
      text: "Look",
      attachments: [{ kind: "image", isImage: true, mimeType: "image/png", data: "abc", filename: "shot.png" }],
    })).toEqual([
      { type: "text", text: "Look" },
      { type: "image", url: "data:image/png;base64,abc" },
    ]);
  });

  test("does not persist inline image bytes in drafts", () => {
    const storage = memoryStorage();
    writeThreadDraft("thread-1", "", {
      text: "with image",
      attachments: [{ id: "img-1", kind: "image", isImage: true, mimeType: "image/png", data: "abc", previewUrl: "data:image/png;base64,abc", filename: "shot.png" }],
    }, storage);
    expect(readThreadDraft("thread-1", "", storage)).toEqual({
      text: "with image",
      mentions: [],
      attachments: [{ id: "img-1", kind: "image", isImage: true, mimeType: "image/png", filename: "shot.png", inlineOmitted: true }],
    });
    expect(JSON.stringify(storage.values)).not.toContain("base64,abc");
  });

  test("exports ordered conversation content and only known metadata", () => {
    const markdown = formatThreadExportMarkdown({
      id: "thread-42",
      cwd: "/workspace/demo",
      turns: [{ items: [
        { type: "userMessage", content: [{ type: "text", text: "Please update the file." }] },
        { type: "commandExecution", command: "cat README.md", exitCode: 0 },
        { type: "fileChange", changes: [{ path: "README.md", kind: "update" }] },
        { type: "agentMessage", text: "Updated the documentation." },
      ] }],
    }, { title: "Demo", tokenUsage: { total: { totalTokens: 123 } } });
    expect(markdown).toContain("# Demo");
    expect(markdown).toContain("**Thread ID:** thread-42");
    expect(markdown).toContain("**Working directory:** /workspace/demo");
    expect(markdown).toContain("**Token Total:** 123");
    expect(markdown.indexOf("## User")).toBeLessThan(markdown.indexOf("### Tools / commands"));
    expect(markdown.indexOf("### Tools / commands")).toBeLessThan(markdown.indexOf("### File changes"));
    expect(markdown.indexOf("### File changes")).toBeLessThan(markdown.indexOf("## Assistant"));
    expect(markdown).toContain("`cat README.md`");
    expect(markdown).toContain("Updated the documentation.");

    const minimal = formatThreadExportMarkdown({ turns: [] });
    expect(minimal).toContain("# Conversation");
    expect(minimal).not.toContain("Thread ID");
    expect(minimal).not.toContain("Working directory");
    expect(minimal).not.toContain("Token Total");
  });

  test("creates safe dated export filenames", () => {
    const filename = exportFilename("My Project / Notes", ".md");
    expect(filename).toMatch(/^my-project-notes-\d{4}-\d{2}-\d{2}\.md$/);
    expect(exportFilename("!!!", "../json")).toMatch(/^conversation-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe("archived thread bookkeeping", () => {
  test("round-trips archived entries through storage and drops invalid rows", () => {
    const storage = memoryStorage();
    writeArchivedThreads([
      { id: "thread-1", name: "Plan A", cwd: "/work/app", archivedAt: 1730000000000 },
      { id: "", name: "broken", cwd: "", archivedAt: 0 },
      { name: "no id", cwd: "", archivedAt: 0 },
      "not-an-object",
    ], storage);
    expect(readArchivedThreads(storage)).toEqual([
      { id: "thread-1", name: "Plan A", cwd: "/work/app", archivedAt: 1730000000000 },
    ]);
    expect(storage.values.get(ARCHIVED_THREADS_STORAGE_KEY)).toBeTruthy();
  });

  test("normalizes missing fields and clears the key when the list empties", () => {
    const storage = memoryStorage();
    writeArchivedThreads([{ id: "thread-2" }], storage);
    expect(readArchivedThreads(storage)).toEqual([
      { id: "thread-2", name: "", cwd: "", archivedAt: 0 },
    ]);
    writeArchivedThreads([], storage);
    expect(storage.values.has(ARCHIVED_THREADS_STORAGE_KEY)).toBe(false);
    expect(readArchivedThreads(storage)).toEqual([]);
  });

  test("survives corrupt JSON and unavailable storage", () => {
    const storage = memoryStorage();
    storage.setItem(ARCHIVED_THREADS_STORAGE_KEY, "{not json");
    expect(readArchivedThreads(storage)).toEqual([]);
    const rejecting = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    };
    expect(readArchivedThreads(rejecting as any)).toEqual([]);
    expect(() => writeArchivedThreads([{ id: "x" }], rejecting as any)).not.toThrow();
  });
});
