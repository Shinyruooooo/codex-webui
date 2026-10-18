import { describe, expect, test } from "bun:test";
import type { ProviderConfig } from "../server/model-providers.ts";
import { discoverProviderModels } from "../server/provider-model-discovery.ts";
import { providerPresets } from "../server/provider-presets.ts";

type TestModelConfig = ProviderConfig["models"][number] & { enabled?: boolean };

function provider(overrides: Omit<Partial<ProviderConfig>, "models"> & { models?: TestModelConfig[] } = {}): ProviderConfig {
  return {
    id: "fixture",
    name: "Fixture Provider",
    baseUrl: "https://models.example/v1/",
    apiKey: "$FIXTURE_KEY",
    models: [],
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

describe("discoverProviderModels", () => {
  test("uses the exact models endpoint, resolved Bearer key and redirect:error", async () => {
    let requestedUrl: URL | undefined;
    let requestInit: RequestInit | undefined;
    const result = await discoverProviderModels(provider(), {
      env: { FIXTURE_KEY: "resolved-test-secret" },
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = new URL(String(input));
        requestInit = init;
        return jsonResponse({ data: [{ id: "remote-model" }] });
      }) as typeof fetch,
    });

    expect(requestedUrl?.href).toBe("https://models.example/v1/models");
    expect(requestInit?.method).toBe("GET");
    expect(requestInit?.redirect).toBe("error");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer resolved-test-secret");
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({ source: "remote", added: 1, discovered: 1 });
    expect(JSON.stringify(result)).not.toContain("resolved-test-secret");
  });

  test("incrementally merges discovered ids while retaining existing metadata and disabled state", async () => {
    const existing = {
      id: "kept-model",
      displayName: "Hand-edited name",
      description: "manual description",
      efforts: ["low", "high"],
      enabled: false,
    };
    const input = provider({ models: [existing] });
    const result = await discoverProviderModels(input, {
      env: { FIXTURE_KEY: "fixture" },
      fetch: (async () => jsonResponse({ data: [{ id: "remote-one" }, { id: "remote-one" }, { id: "kept-model" }] })) as typeof fetch,
    });

    expect(result.models).toEqual([
      existing,
      { id: "remote-one", enabled: false },
    ]);
    expect(result).toMatchObject({ source: "remote", added: 1, discovered: 2 });
    expect(input.models).toEqual([existing]);
  });

  test("new preset models inherit preset metadata but are disabled pending confirmation", async () => {
    const preset = providerPresets().find((entry) => entry.id === "deepseek")!.provider;
    const configured = { ...preset, apiKey: "$FIXTURE_KEY", models: [] };
    const result = await discoverProviderModels(configured, {
      env: { FIXTURE_KEY: "fixture" },
      fetch: (async () => jsonResponse({ data: [{ id: "deepseek-flash" }, { id: "unlisted" }] })) as typeof fetch,
    });

    expect(result.models).toEqual([
      {
        ...preset.models[0],
        id: "deepseek-flash",
        enabled: false,
      },
      { id: "unlisted", enabled: false },
    ]);
    expect(result.models[0].efforts).toEqual(["low", "high", "max"]);
    expect(result.models[0].defaultReasoningEffort).toBe("high");
    expect(result.models[0].vision).toBe(true);
  });

  test("401 failures are sanitized and leave the provider unchanged", async () => {
    const input = provider({ apiKey: "top-secret", models: [{ id: "manual", enabled: false }] });
    const before = structuredClone(input);
    let message = "";
    try {
      await discoverProviderModels(input, {
        fetch: (async () => new Response("do not echo this body", { status: 401 })) as typeof fetch,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("Provider model discovery request failed.");
    expect(message).not.toContain("top-secret");
    expect(message).not.toContain("do not echo");
    expect(input).toEqual(before);
  });

  test("bounds a fetch promise that ignores AbortSignal", async () => {
    let signal: AbortSignal | undefined;
    await expect(discoverProviderModels(provider(), {
      env: { FIXTURE_KEY: "fixture" },
      timeoutMs: 15,
      fetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal as AbortSignal;
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    })).rejects.toThrow("Provider model discovery timed out.");
    expect(signal?.aborted).toBe(true);
  });

  test("bounds a response body read that ignores AbortSignal and never resolves", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {});
      },
      cancel() {
        return new Promise<void>(() => {});
      },
    }));
    await expect(discoverProviderModels(provider(), {
      env: { FIXTURE_KEY: "fixture" },
      timeoutMs: 15,
      fetch: (async () => response) as typeof fetch,
    })).rejects.toThrow("Provider model discovery timed out.");
  });

  test("rejects redirects rather than following them", async () => {
    let initSeen: RequestInit | undefined;
    await expect(discoverProviderModels(provider(), {
      env: { FIXTURE_KEY: "fixture" },
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        initSeen = init;
        throw new TypeError("redirect blocked");
      }) as typeof fetch,
    })).rejects.toThrow("Provider model discovery request failed.");
    expect(initSeen?.redirect).toBe("error");
  });

  test("rejects oversized, empty and invalid JSON responses", async () => {
    const oversized = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024 + 1));
        controller.close();
      },
    }));
    const responses = [
      oversized,
      new Response(""),
      new Response("not-json"),
      jsonResponse({ data: [] }),
      jsonResponse({ models: [{ id: "wrong-shape" }] }),
    ];
    const errors: string[] = [];
    for (const response of responses) {
      try {
        await discoverProviderModels(provider(), {
          env: { FIXTURE_KEY: "fixture" },
          fetch: (async () => response) as typeof fetch,
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    expect(errors).toHaveLength(responses.length);
    expect(errors[0]).toBe("Provider model catalog exceeded the 512 KiB limit.");
    expect(errors.slice(1).every((message) => message === "Provider returned an invalid or empty model catalog.")).toBe(true);
  });

  test("cancels error response bodies without awaiting slow cleanup", async () => {
    for (const status of [401, 404]) {
      let cancelled = false;
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("error page"));
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => {});
        },
      }), { status });
      const target = status === 404 ? providerPresets()[0].provider : provider();
      const configured = { ...target, apiKey: "$FIXTURE_KEY", models: [] };
      const request = discoverProviderModels(configured, {
        env: { FIXTURE_KEY: "fixture" },
        fetch: (async () => response) as typeof fetch,
      });
      if (status === 404) await expect(request).resolves.toMatchObject({ source: "preset" });
      else await expect(request).rejects.toThrow("Provider model discovery request failed.");
      expect(cancelled).toBe(true);
    }
  });

  test("404 falls back only for a matching provider preset", async () => {
    const preset = providerPresets()[0].provider;
    const configured = { ...preset, baseUrl: `${preset.baseUrl}/`, apiKey: "$FIXTURE_KEY", models: [] };
    const fallback = await discoverProviderModels(configured, {
      env: { FIXTURE_KEY: "fixture" },
      fetch: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });
    expect(fallback).toMatchObject({
      source: "preset",
      added: 1,
      discovered: 1,
      warning: "The provider does not expose a model catalog; using its built-in preset models.",
    });
    expect(fallback.models[0]).toMatchObject({ id: "glm-5.3", defaultReasoningEffort: "max", enabled: false });

    await expect(discoverProviderModels(provider(), {
      env: { FIXTURE_KEY: "fixture" },
      fetch: (async () => new Response(null, { status: 404 })) as typeof fetch,
    })).rejects.toThrow("Provider model discovery request failed.");
  });

  test("trims discovered ids and does not warn when exactly 50 models are retained", async () => {
    const data = [
      { id: "  padded-model  " },
      { id: "padded-model" },
      { id: "   " },
      ...Array.from({ length: 49 }, (_, index) => ({ id: `model-${index}` })),
    ];
    const result = await discoverProviderModels(provider(), {
      env: { FIXTURE_KEY: "fixture" },
      fetch: (async () => jsonResponse({ data })) as typeof fetch,
    });

    expect(result.models).toHaveLength(50);
    expect(result.models[0].id).toBe("padded-model");
    expect(result.discovered).toBe(50);
    expect(result.added).toBe(50);
    expect(result.warning).toBeUndefined();
  });

  test("native-ID conflicts do not consume the 50-model capacity", async () => {
    const input = provider({ models: Array.from({ length: 48 }, (_, index) => ({ id: `kept-${index}` })) });
    const result = await discoverProviderModels(input, {
      env: { FIXTURE_KEY: "fixture" }, excludedModelIds: new Set(["gpt-native"]),
      fetch: (async () => jsonResponse({ data: [{ id: "gpt-native" }, { id: "new-X" }, { id: "new-Y" }] })) as typeof fetch,
    });
    expect(result.models).toHaveLength(50);
    expect(result.models.slice(-2).map(model => model.id)).toEqual(["new-X", "new-Y"]);
    expect(result.added).toBe(2);
    expect(result.warning).toBe("Models conflicting with built-in Codex IDs were skipped.");
    expect(result.models.some(model => model.id === "gpt-native")).toBe(false);
  });

  test("deduplicates in stable order, examines at most 500 records and caps merged models at 50", async () => {
    const ids = [{ id: "duplicate" }, { id: "duplicate" }, ...Array.from({ length: 600 }, (_, index) => ({ id: `model-${index}` }))];
    const result = await discoverProviderModels(provider(), {
      env: { FIXTURE_KEY: "fixture" },
      fetch: (async () => jsonResponse({ data: ids })) as typeof fetch,
    });

    expect(result.discovered).toBe(499); // first 500 records include one duplicate
    expect(result.models).toHaveLength(50);
    expect(result.models.slice(0, 3).map((model) => model.id)).toEqual(["duplicate", "model-0", "model-1"]);
    expect(result.added).toBe(50);
    expect(result.warning).toBe("The provider model limit is 50; additional discovered models were not added.");
  });
});
