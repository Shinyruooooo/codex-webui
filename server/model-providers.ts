import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Custom model providers (pi-web models.json style) for the Codex app-server.
 *
 * The Codex CLI only accepts OpenAI Responses-compatible third-party endpoints
 * (`wire_api = "responses"`); `wire_api = "chat"` was removed upstream. Providers
 * configured here are injected into the spawned `codex app-server` via `-c
 * model_providers.<id>={...}` overrides, and their API keys are passed through
 * per-provider environment variables so secrets never land in codex config.toml.
 */

export type ProviderModelConfig = {
  id: string;
  displayName?: string;
  description?: string;
  efforts?: string[];
  defaultReasoningEffort?: string;
  vision?: boolean;
  enabled?: boolean;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
  models: ProviderModelConfig[];
};

export type ProvidersFile = {
  version?: number;
  providers: ProviderConfig[];
};

// Provider ids codex already defines itself; overriding them would break the
// built-in OpenAI / OSS integrations.
const RESERVED_PROVIDER_IDS = new Set(["openai", "oss", "ollama", "lmstudio", "azure"]);

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MODEL_ID_MAX = 128;
const MAX_PROVIDERS = 20;
const MAX_MODELS_PER_PROVIDER = 50;

export const DEFAULT_PROVIDER_EFFORTS = ["low", "medium", "high"] as const;

export function providersStorePath(env: NodeJS.ProcessEnv = process.env) {
  if (env.CODEX_WEBUI_MODELS_JSON) return resolve(env.CODEX_WEBUI_MODELS_JSON);
  const codexHome = env.CODEX_HOME || join(homedir(), ".codex");
  return join(codexHome, "codex-webui-models.json");
}

/** Resolves `$VAR` / `${VAR}` API key references from the environment (pi-web syntax). */
export function resolveApiKey(apiKey: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof apiKey !== "string" || !apiKey.trim()) return null;
  const match = apiKey.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
  if (!match) return apiKey;
  const value = env[match[1]];
  return typeof value === "string" && value ? value : null;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function normalizeEfforts(raw: unknown): string[] {
  const efforts = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string" && /^[a-z][a-z0-9]{0,9}$/.test(item))
    : [];
  return [...new Set(efforts)].slice(0, 8);
}

/**
 * Validates and normalizes a raw providers payload (from the JSON store or the
 * settings UI). Throws a user-readable Error on the first problem found.
 */
export function normalizeProviders(raw: unknown): ProviderConfig[] {
  const source = raw && typeof raw === "object" ? (raw as ProvidersFile) : { providers: [] };
  const list = Array.isArray(source.providers) ? source.providers : [];
  if (list.length > MAX_PROVIDERS) throw new Error(`At most ${MAX_PROVIDERS} custom providers are supported`);

  const seenIds = new Set<string>();
  const seenModels = new Set<string>();
  const providers: ProviderConfig[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") throw new Error("Provider entries must be objects");
    const record = entry as Record<string, unknown>;
    const id = normalizeString(record.id, 40);
    if (!id || !PROVIDER_ID_PATTERN.test(id)) {
      throw new Error("Provider id must be 1-40 characters of letters, digits, dashes or underscores");
    }
    if (RESERVED_PROVIDER_IDS.has(id.toLowerCase())) throw new Error(`Provider id "${id}" is reserved by Codex`);
    if (seenIds.has(id)) throw new Error(`Duplicate provider id "${id}"`);
    seenIds.add(id);

    if (record.enabled !== undefined && typeof record.enabled !== "boolean") throw new Error("Provider enabled must be a boolean");
    const name = normalizeString(record.name, 64) || id;
    const baseUrl = normalizeString(record.baseUrl, 512);
    if (!baseUrl || !isHttpUrl(baseUrl)) throw new Error(`Provider "${id}" needs an http(s) base URL`);
    if (typeof record.apiKey === "string" && record.apiKey.length > 512) {
      throw new Error(`Provider "${id}" API key is too long`);
    }

    const modelsRaw = Array.isArray(record.models) ? record.models : [];
    if (!modelsRaw.length) throw new Error(`Provider "${id}" needs at least one model`);
    if (modelsRaw.length > MAX_MODELS_PER_PROVIDER) {
      throw new Error(`Provider "${id}" exceeds ${MAX_MODELS_PER_PROVIDER} models`);
    }
    const models: ProviderModelConfig[] = [];
    for (const modelEntry of modelsRaw) {
      if (!modelEntry || typeof modelEntry !== "object") throw new Error(`Models of provider "${id}" must be objects`);
      const modelRecord = modelEntry as Record<string, unknown>;
      if (modelRecord.enabled !== undefined && typeof modelRecord.enabled !== "boolean") throw new Error("Model enabled must be a boolean");
      const modelId = normalizeString(modelRecord.id, MODEL_ID_MAX);
      if (!modelId) throw new Error(`Provider "${id}" has a model without a valid id`);
      if (seenModels.has(modelId)) throw new Error(`Model id "${modelId}" is used by more than one provider`);
      seenModels.add(modelId);
      models.push({
        id: modelId,
        displayName: normalizeString(modelRecord.displayName, 80) || modelId,
        description: normalizeString(modelRecord.description, 200) || undefined,
        efforts: normalizeEfforts(modelRecord.efforts),
        defaultReasoningEffort: normalizeString(modelRecord.defaultReasoningEffort, 10) || undefined,
        vision: modelRecord.vision === true,
        enabled: modelRecord.enabled !== false,
      });
    }

    providers.push({
      id,
      name,
      baseUrl,
      apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey : undefined,
      enabled: record.enabled !== false,
      models,
    });
  }
  return providers;
}

export function loadProvidersConfig(path: string): { providers: ProviderConfig[]; warnings: string[] } {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error: any) {
    if (error?.code === "ENOENT") return { providers: [], warnings: [] };
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { providers: [], warnings: [`Invalid JSON in ${path}; custom providers are disabled`] }; }
  try {
    return { providers: normalizeProviders(parsed), warnings: [] };
  } catch (error) {
    return { providers: [], warnings: [error instanceof Error ? error.message : String(error)] };
  }
}

export function saveProvidersConfig(path: string, providers: ProviderConfig[]) {
  const payload: ProvidersFile = { version: 1, providers: normalizeProviders({ providers }) };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Environment variable name that carries a provider's API key into the app-server. */
export function providerEnvKey(id: string): string {
  // A reversible encoding prevents e.g. ZAI/zai or a-b/a_b from sharing a
  // credential variable and accidentally sending one provider's key elsewhere.
  return `CODEX_WEBUI_MODEL_KEY_${Buffer.from(id, "utf8").toString("hex").toUpperCase()}`;
}

/** Escapes a string as a TOML basic string (for `-c model_providers.<id>={...}` inline tables). */
export function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\t]/g, " ")}"`;
}

/**
 * `-c` override arguments that register every provider with the spawned
 * app-server. API keys are referenced through env_key, never inlined.
 */
export function providerConfigArgs(providers: ProviderConfig[]): string[] {
  const args: string[] = [];
  for (const provider of providers) {
    const table = [
      `name=${tomlString(provider.name)}`,
      `base_url=${tomlString(provider.baseUrl)}`,
      `env_key=${tomlString(providerEnvKey(provider.id))}`,
      `wire_api="responses"`,
    ].join(",");
    args.push("-c", `model_providers.${provider.id}={${table}}`);
  }
  return args;
}

/** Environment additions (API keys) for the spawned app-server process. */
export function providerSpawnEnv(providers: ProviderConfig[], env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const provider of providers) {
    const key = resolveApiKey(provider.apiKey, env);
    if (key) extra[providerEnvKey(provider.id)] = key;
  }
  return extra;
}

/** Model-catalog entries shaped like app-server `model/list` items. */
export function providerCatalogModels(providers: ProviderConfig[]): any[] {
  const entries: any[] = [];
  for (const provider of providers) {
    if (provider.enabled === false) continue;
    for (const model of provider.models) {
      if (model.enabled === false) continue;
      const efforts = model.efforts?.length ? model.efforts : [...DEFAULT_PROVIDER_EFFORTS];
      entries.push({
        id: model.id,
        model: model.id,
        displayName: model.displayName || model.id,
        description: model.description || `${provider.name} · Responses API`,
        isDefault: false,
        hidden: false,
        inputModalities: model.vision ? ["text", "image"] : ["text"],
        supportedReasoningEfforts: efforts.map((effort) => ({ reasoningEffort: effort, description: `${provider.name} ${effort} reasoning` })),
        defaultReasoningEffort: model.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort)
          ? model.defaultReasoningEffort
          : efforts[Math.min(1, efforts.length - 1)],
        modelProvider: provider.id,
      });
    }
  }
  return entries;
}

/** Merges custom catalog models into a `model/list` result without duplicating ids. */
export function mergeCustomModels(result: any, providers: ProviderConfig[]) {
  const custom = providerCatalogModels(providers);
  if (!custom.length) return result;
  const data = Array.isArray(result?.data) ? [...result.data] : [];
  const existing = new Set(data.map((item: any) => String(item?.model || item?.id || "")));
  for (const entry of custom) {
    if (existing.has(entry.model)) continue;
    existing.add(entry.model);
    data.push(entry);
  }
  return { ...result, data };
}

/** Provider id owning a model id, or null for built-in OpenAI models. */
export function providerForModel(providers: ProviderConfig[], model: unknown): string | null {
  if (typeof model !== "string" || !model) return null;
  for (const provider of providers) {
    if (provider.models.some((entry) => entry.id === model)) return provider.id;
  }
  return null;
}

/** Visibility toggles also gate new RPC inference, not just the browser picker. */
export function assertProviderModelEnabled(providers: ProviderConfig[], model: unknown, providerId?: unknown) {
  const provider = typeof providerId === "string"
    ? providers.find(entry => entry.id === providerId)
    : providers.find(entry => entry.models.some(candidate => candidate.id === model));
  if (!provider) return;
  if (provider.enabled === false) throw new Error("This provider is disabled. Enable it in Model providers before starting a new turn.");
  if (provider.models.find(entry => entry.id === model)?.enabled === false) {
    throw new Error("This model is disabled. Enable it in Model providers before starting a new turn.");
  }
}

/** Settings-UI view of the provider list; API keys are reduced to a presence flag. */
export function publicProvidersView(providers: ProviderConfig[], env: NodeJS.ProcessEnv = process.env) {
  return {
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      hasApiKey: Boolean(resolveApiKey(provider.apiKey, env)),
      enabled: provider.enabled !== false,
      models: provider.models.map((model) => ({
        id: model.id,
        displayName: model.displayName || model.id,
        description: model.description || "",
        efforts: model.efforts?.length ? model.efforts : [...DEFAULT_PROVIDER_EFFORTS],
        defaultReasoningEffort: model.defaultReasoningEffort,
        vision: model.vision === true,
        enabled: model.enabled !== false,
      })),
    })),
  };
}
