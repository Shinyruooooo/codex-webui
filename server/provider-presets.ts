import type { ProviderConfig } from "./model-providers.ts";

/**
 * Credential-free, Codex-compatible defaults. Pi's provider registry is the UX
 * reference, not a runtime dependency: its Chat/Anthropic endpoints cannot be
 * used by Codex. URLs and model capabilities below follow the vendor Codex docs.
 * The two GLM regions intentionally share the `zai` provider id; selecting a
 * different region updates that provider, rather than duplicating model ids.
 */
export type ProviderPreset = {
  id: string;
  label: string;
  description: string;
  docsUrl: string;
  provider: ProviderConfig;
};

export function providerPresets(): ProviderPreset[] {
  return [
    {
      id: "zai-cn",
      label: "GLM Coding Plan (China)",
      description: "Use a BigModel Coding Plan key, not a standard model API key. China and international presets update the same GLM provider; choose the region matching your key.",
      docsUrl: "https://docs.bigmodel.cn/cn/coding-plan/tool/codex",
      provider: {
        id: "zai",
        name: "GLM Coding Plan (China)",
        baseUrl: "https://open.bigmodel.cn/api/v1",
        models: [{ id: "glm-5.3", displayName: "GLM-5.3", efforts: ["low", "high", "max"], defaultReasoningEffort: "max" }],
      },
    },
    {
      id: "zai",
      label: "Z.AI Coding Plan (International)",
      description: "Use a Z.AI Coding Plan key for the international endpoint. China and international presets update the same GLM provider; choose the region matching your key.",
      docsUrl: "https://docs.z.ai/devpack/tool/codex",
      provider: {
        id: "zai",
        name: "Z.AI Coding Plan (International)",
        baseUrl: "https://api.z.ai/api/v1",
        models: [{ id: "glm-5.3", displayName: "GLM-5.3", efforts: ["low", "high", "max"], defaultReasoningEffort: "max" }],
      },
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      description: "Use a DeepSeek API key. The Responses endpoint and model are filled in automatically.",
      docsUrl: "https://api-docs.deepseek.com/quick_start/agent_integrations/codex/",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        models: [{ id: "deepseek-flash", displayName: "DeepSeek Flash", efforts: ["low", "high", "max"], defaultReasoningEffort: "high", vision: true }],
      },
    },
    {
      id: "minimax",
      label: "MiniMax (China)",
      description: "Use a MiniMax API key. The Responses endpoint and models are filled in automatically.",
      docsUrl: "https://platform.minimaxi.com/docs/m-plan/codex",
      provider: {
        id: "minimax",
        name: "MiniMax",
        baseUrl: "https://api.minimax.cn/v1",
        models: [
          { id: "MiniMax-M3.1-Flash", displayName: "MiniMax-M3.1-Flash", efforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "max", vision: true },
          { id: "MiniMax-M3", displayName: "MiniMax-M3", efforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "max", vision: true },
        ],
      },
    },
  ];
}

/** Resolve defaults on the server, so key-only requests do not trust UI fields. */
export function providerWithPreset(presetId: unknown, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Provider payload is required");
  if (presetId == null || presetId === "" || presetId === "custom") return { ...raw };
  const preset = providerPresets().find((entry) => entry.id === presetId);
  if (!preset) throw new Error("Unknown provider preset");
  return { ...preset.provider, ...raw };
}
