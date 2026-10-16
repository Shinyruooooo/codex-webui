export const DRAFT_STORAGE_PREFIX = "codex-webui-draft:";

export function draftStorageKey(threadId = null, cwd = "") {
  return threadId
    ? `${DRAFT_STORAGE_PREFIX}thread:${threadId}`
    : `${DRAFT_STORAGE_PREFIX}new:${cwd || "~"}`;
}

const EMPTY_DRAFT = () => ({ text: "", mentions: [], attachments: [] });

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readThreadDraft(threadId = null, cwd = "", storage = undefined) {
  try {
    const raw = resolveStorage(storage)?.getItem(draftStorageKey(threadId, cwd));
    if (!raw) return EMPTY_DRAFT();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY_DRAFT();
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions : [],
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    };
  } catch {
    return EMPTY_DRAFT();
  }
}

export function writeThreadDraft(threadId = null, cwd = "", draft = {}, storage = undefined) {
  const text = String(draft?.text || "");
  const mentions = Array.isArray(draft?.mentions) ? draft.mentions : [];
  const attachments = Array.isArray(draft?.attachments) ? draft.attachments : [];
  try {
    const target = resolveStorage(storage);
    if (!target) return;
    const key = draftStorageKey(threadId, cwd);
    if (!text.trim() && mentions.length === 0 && attachments.length === 0) {
      target.removeItem(key);
      return;
    }
    target.setItem(key, JSON.stringify({ text, mentions, ...(attachments.length ? { attachments } : {}) }));
  } catch {
    // Storage can be unavailable (for example, in private browsing); drafts are optional.
  }
}

export function buildConversationInput({ text = "", mentions = [], attachments = [] } = {}) {
  const body = String(text ?? "");
  const input = [];
  const filePaths = [];
  const imagePaths = new Set();
  const attachmentList = Array.isArray(attachments) ? attachments : [];

  for (const attachment of attachmentList) {
    if (!attachment || typeof attachment !== "object") continue;
    if (attachment.isImage === true || attachment.kind === "image") {
      const path = attachment.fullPath || attachment.path;
      if (typeof path === "string" && path && !imagePaths.has(path)) {
        imagePaths.add(path);
      }
      continue;
    }
    const path = attachment.relativePath || attachment.path || attachment.fullPath;
    if (typeof path === "string" && path && !filePaths.includes(path)) filePaths.push(path);
  }

  const appendedPaths = filePaths.filter((path) => !body.includes(`@${path}`));
  const attachmentNote = appendedPaths.length
    ? `${body ? "\n\n" : ""}Attached files: ${appendedPaths.map((path) => `@${path}`).join(", ")}`
    : "";
  const finalText = `${body}${attachmentNote}`;
  if (finalText || (!body && attachmentList.length > 0)) {
    input.push({ type: "text", text: finalText });
  }

  const mentionPaths = new Set();
  const skillPaths = new Set();
  for (const item of Array.isArray(mentions) ? mentions : []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "skill") {
      const path = item.path;
      const name = item.name || item.title;
      if (typeof path === "string" && path && typeof name === "string" && name && !skillPaths.has(path)) {
        skillPaths.add(path);
        input.push({ type: "skill", name, path });
      }
      continue;
    }
    if (item.type && item.type !== "file" && item.type !== "folder") continue;
    if (typeof item.path !== "string" || !item.path) continue;
    const name = item.title || item.name;
    if (typeof name !== "string" || !name || mentionPaths.has(item.path)) continue;
    mentionPaths.add(item.path);
    input.push({ type: "mention", name, path: item.path });
  }
  const inlinePattern = /(?:^|\s)@(?:"([^"\n]+)"|([^\s@"]+))/g;
  for (const match of body.matchAll(inlinePattern)) {
    const rawPath = String(match[1] || match[2] || "").replace(/\/+$/, "").trim();
    if (!rawPath || mentionPaths.has(rawPath)) continue;
    const name = rawPath.split("/").filter(Boolean).at(-1) || rawPath;
    mentionPaths.add(rawPath);
    input.push({ type: "mention", name, path: rawPath });
  }

  for (const path of imagePaths) input.push({ type: "localImage", path });
  return input;
}

function asText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function itemText(item) {
  return asText(item?.text ?? item?.content ?? item?.message ?? item?.summary);
}

function commandSummary(item) {
  const command = item.command || (Array.isArray(item.commandActions)
    ? item.commandActions.map((action) => action?.command).filter(Boolean).join("; ")
    : "");
  const output = item.aggregatedOutput ?? item.output?.aggregatedOutput ?? item.output;
  const exitCode = item.exitCode ?? item.output?.exitCode;
  const parts = [];
  if (command) parts.push(`Command: \`${String(command).replace(/`/g, "\\`")}\``);
  if (Number.isFinite(exitCode)) parts.push(`Exit code: ${exitCode}`);
  if (!parts.length && typeof output === "string" && output.trim()) parts.push(output.trim());
  return parts.join(" — ");
}

function fileChangeSummary(item) {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  return changes.map((change) => {
    const path = change?.path || change?.filePath;
    if (!path) return "";
    const kind = change.kind || change.changeType || change.status;
    return kind ? `${path} (${kind})` : String(path);
  }).filter(Boolean);
}

function markdownBlock(text) {
  const clean = String(text || "").trim();
  return clean ? `${clean}\n` : "";
}

export function formatThreadExportMarkdown(thread = {}, { title = "", tokenUsage = null } = {}) {
  const threadData = thread && typeof thread === "object" ? thread : {};
  const lines = [`# ${title || threadData.name || "Conversation"}`, ""];
  const metadata = [];
  if (threadData.id) metadata.push(`- **Thread ID:** ${threadData.id}`);
  if (threadData.cwd) metadata.push(`- **Working directory:** ${threadData.cwd}`);
  const tokenTotal = tokenUsage?.total?.totalTokens ?? tokenUsage?.totalTokens ?? tokenUsage?.total_tokens;
  if (Number.isFinite(tokenTotal)) metadata.push(`- **Token Total:** ${tokenTotal}`);
  if (metadata.length) lines.push(...metadata, "");

  const turns = Array.isArray(threadData.turns) ? threadData.turns : [];
  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    const userMessages = items.filter((item) => item?.type === "userMessage");
    const assistants = items.filter((item) => item?.type === "agentMessage");
    const summaries = [];
    const fileChanges = [];
    for (const item of items) {
      if (item?.type === "commandExecution") {
        const summary = commandSummary(item);
        if (summary) summaries.push(summary);
      } else if (item?.type === "fileChange") {
        fileChanges.push(...fileChangeSummary(item));
      }
    }

    for (const item of userMessages) {
      const text = itemText(item);
      if (text) lines.push("## User", "", markdownBlock(text), "");
    }
    if (summaries.length) lines.push("### Tools / commands", "", ...summaries.map((summary) => `- ${summary}`), "");
    if (fileChanges.length) lines.push("### File changes", "", ...fileChanges.map((change) => `- ${change}`), "");
    for (const item of assistants) {
      const text = itemText(item);
      if (text) lines.push("## Assistant", "", markdownBlock(text), "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function exportFilename(title = "conversation", extension = "md") {
  const slug = String(title || "conversation")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "conversation";
  const date = new Date().toISOString().slice(0, 10);
  const safeExtension = String(extension || "md").replace(/^\.+/, "").replace(/[^a-zA-Z0-9]+/g, "") || "md";
  return `${slug}-${date}.${safeExtension}`;
}
