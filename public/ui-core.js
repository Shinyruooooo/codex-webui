export const DEFAULT_TURN_PAGE_SIZE = 20;

export function createLatestRequestGate() {
  let generation = 0;
  return {
    next() { generation += 1; return generation; },
    isCurrent(value) { return value === generation; },
  };
}

export function createTurnWindow(turns, pageSize = DEFAULT_TURN_PAGE_SIZE, currentStart, loadMore = 0) {
  const total = Array.isArray(turns) ? turns.length : 0;
  const safePage = Math.max(1, pageSize);
  const baseStart = currentStart == null ? Math.max(0, total - safePage) : Math.max(0, Math.min(currentStart, total));
  const start = Math.max(0, baseStart - Math.max(0, loadMore));
  return { visible: turns.slice(start), hiddenCount: start, start, total };
}

export function selectModelState(models, requestedModel) {
  const catalog = Array.isArray(models) ? models : [];
  const selected = catalog.find((item) => item.model === requestedModel)
    || catalog.find((item) => item.isDefault)
    || catalog[0]
    || { model: "", defaultReasoningEffort: "medium", supportedReasoningEfforts: [] };
  const efforts = (selected.supportedReasoningEfforts || []).map((item) => item.reasoningEffort).filter(Boolean);
  const effort = efforts.includes(selected.defaultReasoningEffort)
    ? selected.defaultReasoningEffort
    : (efforts[0] || selected.defaultReasoningEffort || "medium");
  return { model: selected.model, effort, efforts: efforts.length ? efforts : [effort] };
}

export function filterAppModels(models) {
  return (Array.isArray(models) ? models : []).filter((model) =>
    [model?.model, model?.id, model?.displayName].some((value) => /^gpt(?:[-_.\s]|$)/i.test(String(value || ""))),
  );
}

export function resolveComposerPlaceholder({
  followUpType,
  composerMode = "local",
  cloudStartingState,
  isBackgroundSubagentsPanelVisible = false,
  isGoalModeActive = false,
  isPlanModeActive = false,
  placeholderText,
  isHome = false,
} = {}) {
  if (isGoalModeActive) return "Describe your goal, define measurable outcomes for best results";
  if (isPlanModeActive) return "Describe your task to generate a plan...";
  if (placeholderText != null) return placeholderText;
  if (followUpType === "cloud") {
    if (composerMode === "local") return "Create a new local task that references this cloud task";
    if (cloudStartingState === "working-tree") return "Create a new cloud task that includes your current code and will reference this task";
    return "Follow-up to this cloud task";
  }
  if (followUpType === "local") {
    if (composerMode === "cloud") return "Follow-up in a new cloud task";
    return isBackgroundSubagentsPanelVisible
      ? "Ask for follow up changes or @ to tag an agent"
      : "Ask for follow-up changes";
  }
  if (isHome && composerMode === "local") return "Do anything";
  return composerMode === "cloud"
    ? "Ask Codex to do anything in the cloud"
    : "Ask ChatGPT anything. @ to use plugins or mention files";
}

export function getComposerAutocomplete(text, cursor = text.length) {
  const value = String(text || "");
  const end = Math.max(0, Math.min(Number.isFinite(cursor) ? cursor : value.length, value.length));
  const before = value.slice(0, end);
  const slash = before.match(/^\s*\/([^\s/]*)$/);
  if (slash) {
    const start = before.indexOf("/");
    return { type: "slash", query: slash[1], start, end };
  }
  const skill = before.match(/(?:^|\s)\$([a-z0-9-]*)$/i);
  if (skill) return { type: "skill", query: skill[1], start: before.lastIndexOf("$"), end };
  const quotedMention = before.match(/(?:^|\s)@"([^"\n]*)$/);
  if (quotedMention) {
    const start = end - (quotedMention[1].length + 2);
    return { type: "mention", query: quotedMention[1], quoted: true, start, end };
  }
  const mention = before.match(/(?:^|\s)@([^\s@"]*)$/);
  if (!mention) return null;
  const start = before.lastIndexOf("@");
  return { type: "mention", query: mention[1], quoted: false, start, end };
}

export function formatFileMention(path, { isDirectory = false, quoted = false } = {}) {
  const normalized = String(path || "").replace(/^\/+|\/+$/g, "");
  if (!normalized) return { text: "", cursorOffset: 0 };
  const target = isDirectory ? `${normalized}/` : normalized;
  const useQuotes = Boolean(quoted || /\s/.test(target));
  if (isDirectory) {
    const text = useQuotes ? `@"${target}"` : `@${target}`;
    return { text, cursorOffset: useQuotes ? text.length - 1 : text.length };
  }
  const text = useQuotes ? `@"${target}" ` : `@${target} `;
  return { text, cursorOffset: text.length };
}

export function applyComposerSuggestion(text, match, replacement) {
  const value = String(text || "");
  if (!match || match.start < 0 || match.end < match.start) return { text: value, cursor: value.length };
  const replaceEnd = match.quoted && value[match.end] === '"' ? match.end + 1 : match.end;
  const before = value.slice(0, match.start);
  const after = value.slice(replaceEnd);
  if (replacement && typeof replacement === "object" && typeof replacement.text === "string") {
    const raw = replacement.text;
    const isCompleteToken = raw.endsWith(" ");
    const trimmed = isCompleteToken ? raw.slice(0, -1) : raw;
    const needsSpace = isCompleteToken && (after.length === 0 || !/^\s/.test(after));
    const inserted = trimmed + (needsSpace ? " " : "");
    const cursorOffset = Number.isFinite(replacement.cursorOffset)
      ? Math.min(replacement.cursorOffset, inserted.length)
      : inserted.length;
    return { text: before + inserted + after, cursor: before.length + cursorOffset };
  }
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = String(replacement || "") + (needsSpace ? " " : "");
  return { text: before + inserted + after, cursor: before.length + inserted.length };
}
