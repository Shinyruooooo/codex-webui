import { describe, expect, test } from "bun:test";
import { contextUsageValue, formatElapsed, formatTokenCount, normalizeTokenUsage } from "../public/usage.js";

const emptyGroup = {
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  reasoningOutputTokens: null,
  totalTokens: null,
};

describe("normalizeTokenUsage", () => {
  test("normalizes app-server camel-case usage, preserving zero and unknown fields", () => {
    expect(normalizeTokenUsage({
      total: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 7, reasoningOutputTokens: 2, totalTokens: 7 },
      last: { inputTokens: 5, cachedInputTokens: 1, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 8 },
      modelContextWindow: 0,
    })).toEqual({
      total: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 7, reasoningOutputTokens: 2, totalTokens: 7 },
      last: { inputTokens: 5, cachedInputTokens: 1, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 8 },
      modelContextWindow: 0,
    });
  });

  test("normalizes CLI token_count.info snake-case usage", () => {
    expect(normalizeTokenUsage({ token_count: { info: {
      total_token_usage: { input_tokens: 9000000, cached_input_tokens: 8000000, output_tokens: 400000, reasoning_output_tokens: 100000, total_tokens: 9400000 },
      last_token_usage: { input_tokens: 900, cached_input_tokens: 800, output_tokens: 40, reasoning_output_tokens: 10, total_tokens: 940 },
      model_context_window: 128000,
    } } })).toEqual({
      total: { inputTokens: 9000000, cachedInputTokens: 8000000, outputTokens: 400000, reasoningOutputTokens: 100000, totalTokens: 9400000 },
      last: { inputTokens: 900, cachedInputTokens: 800, outputTokens: 40, reasoningOutputTokens: 10, totalTokens: 940 },
      modelContextWindow: 128000,
    });
  });

  test("does not invent missing values or infer totalTokens from subsets", () => {
    expect(normalizeTokenUsage({ total: { inputTokens: 12, cachedInputTokens: 9, outputTokens: 4 }, last: {} })).toEqual({
      total: { inputTokens: 12, cachedInputTokens: 9, outputTokens: 4, reasoningOutputTokens: null, totalTokens: null },
      last: emptyGroup,
      modelContextWindow: null,
    });
    expect(normalizeTokenUsage(null)).toEqual({ total: emptyGroup, last: emptyGroup, modelContextWindow: null });
  });

  test("turns NaN, infinity, negative, and non-integer counts into null", () => {
    const usage = normalizeTokenUsage({
      total: { inputTokens: Number.NaN, cachedInputTokens: Number.POSITIVE_INFINITY, outputTokens: -1, reasoningOutputTokens: 1.5, totalTokens: 0 },
      last: { totalTokens: Number.NEGATIVE_INFINITY },
      modelContextWindow: -10,
    });
    expect(usage.total).toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningOutputTokens: null, totalTokens: 0 });
    expect(usage.last.totalTokens).toBeNull();
    expect(usage.modelContextWindow).toBeNull();
  });

  test("keeps input/cache and output/reasoning as reported subsets, without adding them", () => {
    const usage = normalizeTokenUsage({
      total_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 30, reasoning_output_tokens: 20, total_tokens: 130 },
      last_token_usage: { input_tokens: 10, cached_input_tokens: 8, output_tokens: 3, reasoning_output_tokens: 2, total_tokens: 13 },
    });
    expect(usage.total).toEqual({ inputTokens: 100, cachedInputTokens: 80, outputTokens: 30, reasoningOutputTokens: 20, totalTokens: 130 });
    expect(usage.last.totalTokens).toBe(13);
  });
});

describe("contextUsageValue", () => {
  test("uses last-turn total with the context window, never the cumulative total", () => {
    expect(contextUsageValue({
      total: { totalTokens: 900000 },
      last: { totalTokens: 1200 },
      modelContextWindow: 4000,
    })).toEqual({ percent: 30, usedTokens: 1200, contextWindow: 4000, remainingTokens: 2800 });
  });

  test("supports the legacy context shape and clamps remaining tokens at zero", () => {
    expect(contextUsageValue({ percent: 60, usedTokens: 120, contextWindow: 100, remainingTokens: 0 })).toEqual({
      percent: 120, usedTokens: 120, contextWindow: 100, remainingTokens: 0,
    });
  });

  test("returns null when usage or a usable context window is unknown", () => {
    expect(contextUsageValue({ last: { totalTokens: null }, modelContextWindow: 100 })).toBeNull();
    expect(contextUsageValue({ last: { totalTokens: 10 }, modelContextWindow: 0 })).toBeNull();
    expect(contextUsageValue({ last: { totalTokens: 10 } })).toBeNull();
    expect(contextUsageValue(null)).toBeNull();
  });
});

describe("formatters", () => {
  test("formats valid token counts as English grouped integers", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(1234567890)).toBe("1,234,567,890");
    expect(formatTokenCount(null)).toBe("—");
    expect(formatTokenCount(Number.NaN)).toBe("—");
    expect(formatTokenCount(-2)).toBe("—");
  });

  test("formats elapsed time without wall-clock precision", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(1999)).toBe("1s");
    expect(formatElapsed(65000)).toBe("1m 05s");
    expect(formatElapsed(3720000)).toBe("1h 02m");
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatElapsed(-1)).toBe("—");
  });
});
