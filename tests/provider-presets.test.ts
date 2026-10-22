import { describe, expect, test } from "bun:test";
import { providerPresets, providerWithPreset } from "../server/provider-presets.ts";
import { normalizeProviders, providerCatalogModels } from "../server/model-providers.ts";
import { formatProviderModels, matchingProviderPreset, parseProviderModels } from "../public/provider-editor.js";

describe("Codex provider presets", () => {
  test("each preset provides a documented Responses endpoint and complete model defaults without a key", () => {
    const presets = providerPresets();
    expect(presets.map(entry => entry.id)).toEqual(["zai-cn", "zai", "deepseek", "minimax"]);
    for (const preset of presets) {
      expect(preset.docsUrl.startsWith("https://")).toBe(true);
      expect(preset.provider.apiKey).toBeUndefined();
      const providers = normalizeProviders({ providers: [preset.provider] });
      const catalog = providerCatalogModels(providers);
      expect(catalog.length).toBeGreaterThan(0);
      for (const model of catalog) {
        expect(model.supportedReasoningEfforts.map(entry => entry.reasoningEffort)).toContain(model.defaultReasoningEffort);
      }
    }
    expect(presets[0].provider.baseUrl).toBe("https://open.bigmodel.cn/api/v1");
    expect(presets[1].provider.baseUrl).toBe("https://api.z.ai/api/v1");
    expect(presets[2].provider.baseUrl).toBe("https://api.deepseek.com");
    expect(presets[3].provider.baseUrl).toBe("https://api.minimax.cn/v1");
  });

  test("the MiniMax preset targets the China Responses endpoint with documented models and efforts", () => {
    const preset = providerPresets().find(entry => entry.id === "minimax")!;
    expect(preset.provider.id).toBe("minimax");
    expect(preset.docsUrl).toBe("https://platform.minimaxi.com/docs/m-plan/codex");
    expect(preset.provider.models.map(model => model.id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    for (const model of preset.provider.models) {
      expect(model.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(model.defaultReasoningEffort).toBe("max");
      expect(model.vision).toBe(true);
      expect(model.efforts).not.toContain("none");
    }
    const raw = providerWithPreset("minimax", { apiKey: "fixture-key" });
    const [provider] = normalizeProviders({ providers: [raw] });
    expect(provider.baseUrl).toBe("https://api.minimax.cn/v1");
    expect(provider.models.map(model => model.id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    const catalog = providerCatalogModels([provider]);
    expect(catalog.map(entry => entry.model)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    expect(catalog[0].inputModalities).toEqual(["text", "image"]);
    expect(catalog[0].supportedReasoningEfforts.map(entry => entry.reasoningEffort)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(catalog[0].defaultReasoningEffort).toBe("max");
  });

  test("key-only payloads are expanded on the server, not only in the browser", () => {
    const raw = providerWithPreset("zai-cn", { apiKey: "fixture-key" });
    const [provider] = normalizeProviders({ providers: [raw] });
    expect(provider.id).toBe("zai");
    expect(provider.apiKey).toBe("fixture-key");
    expect(provider.models[0].id).toBe("glm-5.3");
    expect(provider.models[0].defaultReasoningEffort).toBe("max");
    expect(providerCatalogModels([provider])[0].defaultReasoningEffort).toBe("max");
    expect(providerPresets()[0].provider.apiKey).toBeUndefined();
  });

  test("advanced overrides and custom providers remain possible", () => {
    expect(providerWithPreset("deepseek", { baseUrl: "http://localhost:9999", models: [{ id: "fixture" }] })).toMatchObject({
      baseUrl: "http://localhost:9999", models: [{ id: "fixture" }],
    });
    expect(providerWithPreset("custom", { id: "local" })).toEqual({ id: "local" });
    expect(() => providerWithPreset("does-not-exist", {})).toThrow(/Unknown provider preset/);
    expect(() => providerWithPreset("deepseek", null)).toThrow(/payload/);
  });

  test("regions share one GLM provider and cannot accidentally add duplicate model ids", () => {
    const presets = providerPresets();
    expect(presets[0].provider.id).toBe(presets[1].provider.id);
    expect(matchingProviderPreset(presets, presets[0].provider)?.id).toBe("zai-cn");
    expect(matchingProviderPreset(presets, presets[1].provider)?.id).toBe("zai");
    expect(matchingProviderPreset(presets, { id: "custom", baseUrl: "http://localhost" })).toBeUndefined();
  });
});

describe("provider editor round trips", () => {
  test("an empty display-name column is preserved instead of becoming an effort label", () => {
    const models = [{ id: "fixture", displayName: "fixture", efforts: ["low", "high"] }];
    expect(formatProviderModels(models)).toBe("fixture |  | low,high");
    expect(parseProviderModels(formatProviderModels(models))[0]).toMatchObject(models[0]);
  });

  test("editing a preset preserves non-form metadata such as vision and default effort", () => {
    const models = providerPresets()[2].provider.models;
    const parsed = parseProviderModels(formatProviderModels(models), models);
    expect(parsed[0].vision).toBe(true);
    expect(parsed[0].defaultReasoningEffort).toBe("high");
    const changed = parseProviderModels("deepseek-flash | Flash | low,max", models);
    expect(changed[0].defaultReasoningEffort).toBeUndefined();
    expect(changed[0].vision).toBe(true);
  });

  test("invalid/empty model lines produce readable errors", () => {
    expect(() => parseProviderModels("")).toThrow(/at least one/);
    expect(() => parseProviderModels(" | display")).toThrow(/need an id/);
    expect(() => parseProviderModels("a | b | low | extra")).toThrow(/too many columns/);
  });
});
