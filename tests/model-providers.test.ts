import { describe, expect, test } from "bun:test";
import { chmodSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadProvidersConfig,
  assertProviderModelEnabled,
  mergeCustomModels,
  normalizeProviders,
  providerCatalogModels,
  providerConfigArgs,
  providerEnvKey,
  providerForModel,
  providerSpawnEnv,
  providersStorePath,
  publicProvidersView,
  resolveApiKey,
  saveProvidersConfig,
  tomlString,
} from "../server/model-providers.ts";

const validProvider = {
  id: "zai",
  name: "Z.AI GLM",
  baseUrl: "https://api.z.ai/api/v1",
  apiKey: "sk-test",
  models: [
    { id: "glm-5.3", displayName: "GLM-5.3", efforts: ["low", "medium", "high"] },
    { id: "glm-5.3-flash" },
  ],
};

describe("provider config normalization", () => {
  test("accepts a valid provider and applies defaults", () => {
    const providers = normalizeProviders({ providers: [validProvider] });
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("zai");
    expect(providers[0].models[1].displayName).toBe("glm-5.3-flash");
    expect(providers[0].models[1].efforts).toEqual([]);
  });

  test("rejects reserved, malformed and duplicated providers", () => {
    expect(() => normalizeProviders({ providers: [{ ...validProvider, id: "openai" }] })).toThrow(/reserved/);
    expect(() => normalizeProviders({ providers: [{ ...validProvider, id: "bad id!" }] })).toThrow(/Provider id/);
    expect(() => normalizeProviders({ providers: [{ ...validProvider, baseUrl: "ftp://x" }] })).toThrow(/base URL/);
    expect(() => normalizeProviders({ providers: [{ ...validProvider, models: [] }] })).toThrow(/at least one model/);
    expect(() => normalizeProviders({ providers: [validProvider, { ...validProvider, id: "other", models: [{ id: "glm-5.3" }] }] })).toThrow(/more than one provider/);
    expect(() => normalizeProviders({ providers: [{ ...validProvider, models: [{ id: "a" }, { id: "a" }] }] })).toThrow(/more than one provider/);
  });

  test("resolves $VAR API keys from the environment", () => {
    expect(resolveApiKey("$ZAI_KEY", { ZAI_KEY: "secret" })).toBe("secret");
    expect(resolveApiKey("${ZAI_KEY}", {})).toBeNull();
    expect(resolveApiKey("sk-literal")).toBe("sk-literal");
    expect(resolveApiKey("  ")).toBeNull();
  });

  test("derives the store path from the environment", () => {
    expect(providersStorePath({ CODEX_WEBUI_MODELS_JSON: "/tmp/custom.json" })).toBe("/tmp/custom.json");
    expect(providersStorePath({ CODEX_HOME: "/tmp/codex-home", HOME: "/home/user" })).toBe(join("/tmp/codex-home", "codex-webui-models.json"));
  });
});

describe("codex spawn overrides", () => {
  test("builds -c model_providers TOML overrides with env_key secrets", () => {
    const [flag, override] = providerConfigArgs(normalizeProviders({ providers: [validProvider] }));
    expect(flag).toBe("-c");
    expect(override).toBe('model_providers.zai={name="Z.AI GLM",base_url="https://api.z.ai/api/v1",env_key="CODEX_WEBUI_MODEL_KEY_7A6169",wire_api="responses"}');
  });

  test("escapes TOML-hostile characters", () => {
    expect(tomlString('a"b\\c\nd')).toBe('"a\\"b\\\\c d"');
    const [flag, override] = providerConfigArgs([{ ...validProvider, name: 'We"ird\\Name' }]);
    expect(flag).toBe("-c");
    expect(override).toContain('name="We\\"ird\\\\Name"');
  });

  test("provider ids that differ by case or punctuation never share a key variable", () => {
    expect(new Set(["zai", "ZAI", "a-b", "a_b"].map(providerEnvKey)).size).toBe(4);
    const providers = normalizeProviders({ providers: [
      { ...validProvider, id: "ZAI", apiKey: "first-key", models: [{ id: "first-model" }] },
      { ...validProvider, id: "zai", apiKey: "second-key", models: [{ id: "second-model" }] },
    ] });
    const env = providerSpawnEnv(providers);
    expect(env[providerEnvKey("ZAI")]).toBe("first-key");
    expect(env[providerEnvKey("zai")]).toBe("second-key");
  });

  test("maps API keys into provider environment variables", () => {
    const env = providerSpawnEnv(normalizeProviders({ providers: [validProvider, { ...validProvider, id: "envref", apiKey: "$MISSING_KEY", models: [{ id: "other-model" }] }] }), {});
    expect(env[providerEnvKey("zai")]).toBe("sk-test");
    expect(env[providerEnvKey("envref")]).toBeUndefined();
  });
});

describe("model catalog integration", () => {
  const providers = normalizeProviders({ providers: [validProvider] });

  test("shapes catalog entries like app-server models", () => {
    const entries = providerCatalogModels(providers);
    expect(entries.map((entry: any) => entry.model)).toEqual(["glm-5.3", "glm-5.3-flash"]);
    expect(entries[0].modelProvider).toBe("zai");
    expect(entries[0].supportedReasoningEfforts.map((item: any) => item.reasoningEffort)).toEqual(["low", "medium", "high"]);
    expect(entries[1].supportedReasoningEfforts.map((item: any) => item.reasoningEffort)).toEqual(["low", "medium", "high"]);
    expect(entries[0].inputModalities).toEqual(["text"]);
    expect(entries.find((entry: any) => entry.id === "glm-5.3").description).toContain("Z.AI GLM");
  });

  test("merges into model/list results without duplicating ids", () => {
    const merged = mergeCustomModels({ data: [{ model: "gpt-6.1-sol" }, { model: "glm-5.3" }] }, providers);
    expect(merged.data.map((entry: any) => entry.model)).toEqual(["gpt-6.1-sol", "glm-5.3", "glm-5.3-flash"]);
    const withoutProviders = mergeCustomModels({ data: [{ model: "gpt-6.1-sol" }] }, []);
    expect(withoutProviders.data).toHaveLength(1);
  });

  test("keeps disabled settings and keys, but removes models from the picker", () => {
    const disabled = normalizeProviders({ providers: [{ ...validProvider, enabled: false }] });
    expect(disabled[0].apiKey).toBe("sk-test");
    expect(providerCatalogModels(disabled)).toEqual([]);
    expect(providerForModel(disabled, "glm-5.3")).toBe("zai");
    expect(publicProvidersView(disabled).providers[0].enabled).toBe(false);
    expect(() => assertProviderModelEnabled(disabled, "glm-5.3")).toThrow(/provider is disabled/);
    // Connections stay registered so toggles do not recycle in-flight sessions.
    expect(providerConfigArgs(disabled)).toHaveLength(2);
    const partial = normalizeProviders({ providers: [{ ...validProvider, models: [{ id: "off", enabled: false }, { id: "on" }] }] });
    expect(providerCatalogModels(partial).map(entry => entry.model)).toEqual(["on"]);
    expect(() => assertProviderModelEnabled(partial, "off")).toThrow(/model is disabled/);
    expect(() => assertProviderModelEnabled(partial, "on")).not.toThrow();
    expect(() => normalizeProviders({ providers: [{ ...validProvider, enabled: "false" }] })).toThrow(/boolean/);
    expect(() => normalizeProviders({ providers: [{ ...validProvider, models: [{ id: "bad", enabled: "false" }] }] })).toThrow(/boolean/);
  });

  test("maps model ids back to their provider", () => {
    expect(providerForModel(providers, "glm-5.3")).toBe("zai");
    expect(providerForModel(providers, "gpt-6.1-sol")).toBeNull();
    expect(providerForModel(providers, 42)).toBeNull();
  });
});

describe("provider store persistence", () => {
  test("round-trips providers with restricted file permissions and hides keys", () => {
    const path = join("/tmp", `codex-webui-models-test-${process.pid}.json`);
    try {
      saveProvidersConfig(path, normalizeProviders({ providers: [{ ...validProvider, enabled: false, models: validProvider.models.map((model, index) => ({ ...model, enabled: index !== 0 })) }] }));
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const loaded = loadProvidersConfig(path);
      expect(loaded.warnings).toEqual([]);
      expect(loaded.providers[0].apiKey).toBe("sk-test");
      expect(loaded.providers[0].enabled).toBe(false);
      expect(loaded.providers[0].models.map(model => model.enabled)).toEqual([false, true]);

      const view = publicProvidersView(loaded.providers);
      expect(view.providers[0].hasApiKey).toBe(true);
      expect(JSON.stringify(view)).not.toContain("sk-test");

      chmodSync(path, 0o644);
      const corrupt = join("/tmp", `codex-webui-models-corrupt-${process.pid}.json`);
      saveProvidersConfig(corrupt, []);
      unlinkSync(corrupt);
    } finally {
      unlinkSync(path);
    }
  });

  test("warns instead of throwing on invalid store contents", () => {
    const path = join("/tmp", `codex-webui-models-invalid-${process.pid}.json`);
    try {
      const { writeFileSync: write } = { writeFileSync };
      write(path, "{ not json", "utf8");
      const loaded = loadProvidersConfig(path);
      expect(loaded.providers).toEqual([]);
      expect(loaded.warnings[0]).toMatch(/Invalid JSON/);
    } finally {
      unlinkSync(path);
    }
  });

  test("treats a missing store as an empty provider list", () => {
    const loaded = loadProvidersConfig(join("/tmp", `codex-webui-models-missing-${process.pid}.json`));
    expect(loaded.providers).toEqual([]);
    expect(loaded.warnings).toEqual([]);
  });
});
