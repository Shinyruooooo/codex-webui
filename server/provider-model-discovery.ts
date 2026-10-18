import type { ProviderConfig, ProviderModelConfig } from "./model-providers.ts";
import { resolveApiKey } from "./model-providers.ts";
import { providerPresets } from "./provider-presets.ts";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_DISCOVERED_MODELS = 500;
const MAX_PROVIDER_MODELS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;
const MODEL_ID_PATTERN = /^[^\u0000-\u001f\u007f\u0080-\u009f]{1,128}$/;

const ERRORS = {
  missingApiKey: "Provider model discovery requires a configured API key.",
  requestFailed: "Provider model discovery request failed.",
  invalidResponse: "Provider returned an invalid or empty model catalog.",
  responseTooLarge: "Provider model catalog exceeded the 512 KiB limit.",
  timeout: "Provider model discovery timed out.",
} as const;

const WARNINGS = {
  presetFallback: "The provider does not expose a model catalog; using its built-in preset models.",
  presetFallbackLimited: "The provider does not expose a model catalog; using its built-in preset models. The provider model limit is 50; additional discovered models were not added.",
  modelLimit: "The provider model limit is 50; additional discovered models were not added.",
} as const;

export type DiscoverProviderModelsOptions = {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  excludedModelIds?: ReadonlySet<string>;
};

export type DiscoveredProviderModelConfig = ProviderModelConfig & { enabled?: boolean };

export type DiscoverProviderModelsResult = {
  models: DiscoveredProviderModelConfig[];
  source: "remote" | "preset";
  added: number;
  discovered: number;
  warning?: string;
};

function normalizedBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function matchingPreset(provider: ProviderConfig): ProviderConfig | undefined {
  const baseUrl = normalizedBaseUrl(provider.baseUrl);
  return providerPresets().find(({ provider: preset }) =>
    preset.id === provider.id && normalizedBaseUrl(preset.baseUrl) === baseUrl,
  )?.provider;
}

function normalizeModelId(id: unknown): string | undefined {
  if (typeof id !== "string") return undefined;
  const normalized = id.trim();
  return normalized && MODEL_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function cancelBody(response?: Response, reader?: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    const cancellation = reader ? reader.cancel() : response?.body?.cancel();
    if (cancellation) void cancellation.catch(() => {});
  } catch {
    // Cleanup is best-effort and must never delay the request result.
  }
}

async function readBoundedBody(
  response: Response,
  onReader: (reader: ReadableStreamDefaultReader<Uint8Array> | undefined) => void,
): Promise<string> {
  if (!response.body) throw new Error(ERRORS.invalidResponse);
  const reader = response.body.getReader();
  onReader(reader);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        cancelBody(response, reader);
        throw new Error(ERRORS.responseTooLarge);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === ERRORS.responseTooLarge) throw error;
    throw new Error(ERRORS.requestFailed);
  } finally {
    onReader(undefined);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function mergeCatalog(
  provider: ProviderConfig,
  discoveredIds: string[],
  excludedIds: ReadonlySet<string> = new Set(),
): { models: DiscoveredProviderModelConfig[]; added: number; warning?: string } {
  const conflicts = provider.models.some(model => excludedIds.has(model.id)) || discoveredIds.some(id => excludedIds.has(id));
  const presetById = new Map((matchingPreset(provider)?.models ?? []).map((model) => [model.id, model]));
  const models: DiscoveredProviderModelConfig[] = [];
  const seen = new Set<string>();
  let uniqueExisting = 0;

  for (const existing of provider.models ?? []) {
    if (!existing || !MODEL_ID_PATTERN.test(existing.id) || seen.has(existing.id) || excludedIds.has(existing.id)) continue;
    seen.add(existing.id);
    uniqueExisting += 1;
    if (models.length < MAX_PROVIDER_MODELS) models.push({ ...existing });
  }

  let added = 0;
  let droppedDiscovered = false;
  for (const id of discoveredIds) {
    if (seen.has(id) || excludedIds.has(id)) continue;
    seen.add(id);
    if (models.length >= MAX_PROVIDER_MODELS) {
      droppedDiscovered = true;
      continue;
    }
    const presetModel = presetById.get(id);
    models.push({ ...(presetModel ?? {}), id, enabled: false });
    added += 1;
  }

  return {
    models,
    added,
    warning: [
      uniqueExisting > MAX_PROVIDER_MODELS || droppedDiscovered ? WARNINGS.modelLimit : undefined,
      conflicts ? "Models conflicting with built-in Codex IDs were skipped." : undefined,
    ].filter(Boolean).join(" ") || undefined,
  };
}

/**
 * Fetches an OpenAI-style `/models` directory without mutating provider settings.
 * Newly discovered models are disabled until the user confirms compatibility.
 */
export async function discoverProviderModels(
  provider: ProviderConfig,
  options: DiscoverProviderModelsOptions = {},
): Promise<DiscoverProviderModelsResult> {
  const env = options.env ?? process.env;
  const apiKey = resolveApiKey(provider.apiKey, env);
  if (!apiKey) throw new Error(ERRORS.missingApiKey);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(ERRORS.requestFailed);

  const controller = new AbortController();
  let response: Response | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      cancelBody(response, activeReader);
      reject(new Error(ERRORS.timeout));
    }, timeoutMs);
  });

  const operation = (async (): Promise<DiscoverProviderModelsResult> => {
    try {
      const endpoint = new URL(`${normalizedBaseUrl(provider.baseUrl)}/models`);
      response = await (options.fetch ?? fetch)(endpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new Error(ERRORS.requestFailed);
    }

    if (timedOut) {
      cancelBody(response);
      throw new Error(ERRORS.timeout);
    }

    if (!response.ok) {
      cancelBody(response);
      if ([404, 405, 501].includes(response.status)) {
        const preset = matchingPreset(provider);
        if (preset) {
          const discoveredIds = [...new Set(preset.models.map((model) => normalizeModelId(model.id)).filter((id): id is string => Boolean(id)))].slice(0, MAX_DISCOVERED_MODELS);
          const merged = mergeCatalog(provider, discoveredIds, options.excludedModelIds);
          return {
            ...merged,
            source: "preset",
            discovered: discoveredIds.length,
            warning: [WARNINGS.presetFallback, merged.warning].filter(Boolean).join(" "),
          };
        }
      }
      throw new Error(ERRORS.requestFailed);
    }

    let payload: unknown;
    try {
      const text = await readBoundedBody(response, (reader) => { activeReader = reader; });
      payload = JSON.parse(text);
    } catch (error) {
      if (error instanceof Error && (error.message === ERRORS.responseTooLarge || error.message === ERRORS.invalidResponse || error.message === ERRORS.requestFailed)) throw error;
      throw new Error(ERRORS.invalidResponse);
    }

    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
      throw new Error(ERRORS.invalidResponse);
    }
    const discoveredIds = [...new Set(
      (payload as { data: unknown[] }).data.slice(0, MAX_DISCOVERED_MODELS)
        .map((entry) => entry && typeof entry === "object" ? normalizeModelId((entry as { id?: unknown }).id) : undefined)
        .filter((id): id is string => Boolean(id)),
    )];
    if (discoveredIds.length === 0) throw new Error(ERRORS.invalidResponse);

    const merged = mergeCatalog(provider, discoveredIds, options.excludedModelIds);
    return {
      ...merged,
      source: "remote",
      discovered: discoveredIds.length,
      ...(merged.warning ? { warning: merged.warning } : {}),
    };
  })();

  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (timedOut) throw new Error(ERRORS.timeout);
    if (error instanceof Error && Object.values(ERRORS).includes(error.message as typeof ERRORS[keyof typeof ERRORS])) {
      throw error;
    }
    throw new Error(ERRORS.requestFailed);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}
