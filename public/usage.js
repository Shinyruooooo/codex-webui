const TOKEN_FIELDS = [
  ["inputTokens", "input_tokens"],
  ["cachedInputTokens", "cached_input_tokens"],
  ["outputTokens", "output_tokens"],
  ["reasoningOutputTokens", "reasoning_output_tokens"],
  ["totalTokens", "total_tokens"],
];

function tokenCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readTokenGroup(source, camelKey, snakeKey) {
  const group = source?.[camelKey] ?? source?.[snakeKey];
  const result = {};
  for (const [camelField, snakeField] of TOKEN_FIELDS) {
    result[camelField] = tokenCount(group?.[camelField] ?? group?.[snakeField]);
  }
  return result;
}

/** Normalize app-server tokenUsage and CLI token_count.info without inferring totals. */
export function normalizeTokenUsage(value) {
  const source = value?.info ?? value?.token_count?.info ?? value;
  return {
    total: readTokenGroup(source, "total", "total_token_usage"),
    last: readTokenGroup(source, "last", "last_token_usage"),
    modelContextWindow: tokenCount(source?.modelContextWindow ?? source?.model_context_window),
  };
}

function contextResult(usedTokens, contextWindow) {
  if (usedTokens === null || contextWindow === null || contextWindow <= 0) return null;
  return {
    percent: (usedTokens / contextWindow) * 100,
    usedTokens,
    contextWindow,
    remainingTokens: Math.max(0, contextWindow - usedTokens),
  };
}

/** Return last-turn context use in the legacy UI shape, or null if unknown. */
export function contextUsageValue(value) {
  if (!value || typeof value !== "object") return null;

  // Accept the prior context display shape for callers migrating to this module.
  if ("usedTokens" in value || "contextWindow" in value) {
    return contextResult(tokenCount(value.usedTokens), tokenCount(value.contextWindow));
  }

  const usage = normalizeTokenUsage(value);
  return contextResult(usage.last.totalTokens, usage.modelContextWindow);
}

/** Format a known token count with English thousands separators. */
export function formatTokenCount(value) {
  const count = tokenCount(value);
  return count === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(count);
}

/** Format elapsed milliseconds using only the precision displayed by the UI. */
export function formatElapsed(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remainderSeconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function normalizeRateWindow(window) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = Number(window.usedPercent ?? window.used_percent);
  if (!Number.isFinite(usedPercent) || usedPercent < 0) return null;
  const clampedUsed = Math.max(0, Math.min(100, Math.round(usedPercent)));
  const remainingPercent = Math.max(0, 100 - clampedUsed);
  const rawDuration = Number(window.windowDurationMins ?? window.window_duration_mins);
  const windowDurationMins = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : null;
  const rawReset = Number(window.resetsAt ?? window.resets_at);
  const resetsAt = Number.isFinite(rawReset) && rawReset > 0 ? Math.round(rawReset) : null;
  return { usedPercent: clampedUsed, remainingPercent, windowDurationMins, resetsAt };
}

export function formatQuotaWindowLabel(windowDurationMins) {
  if (!Number.isFinite(windowDurationMins) || windowDurationMins <= 0) return "Quota";
  if (windowDurationMins === 300) return "5h";
  if (windowDurationMins === 10080) return "Weekly";
  if (windowDurationMins % 1440 === 0) return `${windowDurationMins / 1440}d`;
  if (windowDurationMins % 60 === 0) return `${windowDurationMins / 60}h`;
  return `${windowDurationMins}m`;
}

export function formatQuotaResetCountdown(resetsAtSeconds, nowMs = Date.now()) {
  if (!Number.isFinite(resetsAtSeconds) || resetsAtSeconds <= 0) return null;
  const remainingMs = resetsAtSeconds * 1000 - nowMs;
  if (remainingMs <= 0) return "now";
  const totalMinutes = Math.ceil(remainingMs / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 48) return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export function normalizeRateLimits(payload, previous = null) {
  const snapshot = payload?.rateLimitsByLimitId?.codex
    ?? payload?.rateLimits
    ?? payload;
  if (!snapshot || typeof snapshot !== "object") return previous;
  const primary = normalizeRateWindow(snapshot.primary) ?? previous?.primary ?? null;
  const secondary = normalizeRateWindow(snapshot.secondary) ?? previous?.secondary ?? null;
  if (!primary && !secondary) return previous;
  const planType = typeof snapshot.planType === "string" && snapshot.planType
    ? snapshot.planType
    : previous?.planType ?? null;
  const resetCreditsCount = Number.isInteger(payload?.rateLimitResetCredits?.availableCount)
    ? payload.rateLimitResetCredits.availableCount
    : previous?.resetCreditsCount ?? null;
  return { primary, secondary, planType, resetCreditsCount };
}
