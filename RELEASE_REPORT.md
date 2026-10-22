# Codex PiWeb UI v0.7.1 — Release Notes

- **Version:** `0.7.1`
- **Date:** 2026-10-22
- **Base release:** `v0.7.0`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.7.1`

## Highlights / 本次更新

### MiniMax (China) provider preset — 新增 MiniMax 国内预设

- MiniMax exposes an OpenAI **Responses** endpoint in China, which is exactly what Codex CLI requires: `wire_api = "chat"` is rejected upstream, so only a Responses-compatible endpoint can be registered as a custom provider.
- The new preset points at `https://api.minimax.cn/v1` and registers the two currently served coding models, `MiniMax-M3.1-Flash` and `MiniMax-M3`, with the reasoning levels MiniMax documents (`low`, `medium`, `high`, `xhigh`, `max`; default `max`) and image input enabled.
- Selecting the preset fills the endpoint, provider id and models; only the API key is typed. The provider card follows the existing preset-card design (same monogram badge, status line and enable switch as the GLM, Z.AI and DeepSeek cards), so no interface change was needed.
- The preset also makes model discovery degrade gracefully: MiniMax does not expose `/v1/models`, so a catalog refresh falls back to the preset models with a warning instead of failing.
- Pay-as-you-go API keys and M Plan / Token Plan subscription keys are not interchangeable; retired model names such as the M2.x family are not included.

## Verification / 验证结果

| Check | Result |
| --- | --- |
| `bun run test:unit` | Passed: 224 tests across 32 files, 0 failed |
| `bun run check` / `bun run build` | Passed: server, development entry and browser bundle compile |
| `git diff --check` | Passed |
| `tests/providers-settings.e2e.mjs` (Chromium) | Passed: preset card count, MiniMax card field filling, key isolation between vendors, provider store contents, desktop dark/light and mobile Chinese layout |
| Live `/api/providers` on the running service | Passed: the `minimax` preset is served with the China base URL, both models, their efforts, default effort and image input |
| MiniMax endpoint reachability | Passed: `POST https://api.minimax.cn/v1/responses` and `https://api.minimaxi.com/v1/responses` both answer with the expected 401 authorization error, confirming the route exists |

### Verification limits / 验证边界

- **No paid inference was performed.** No MiniMax API key was available, so no request reached a MiniMax model. The preset is verified at the configuration, protocol and route level, not by a completed answer.
- The providers browser suite is Chromium-only in this repository; it was not additionally run under Playwright WebKit for this release.
- Switching provider requires a new conversation, and MiniMax key types must match the plan being used.

## Scope and upgrade notes / 范围与升级说明

- This release only adds a provider preset. The authentication model, the Codex bridge, the working-directory behaviour, the conversation retry action and the inline image attachments from v0.7.0 are unchanged.
- Update the source and dependencies, then restart the WebUI so the new preset is served, and reload the browser. Finish active Codex turns before restarting the service.
- Publishing a Git tag or Release does not restart a running service, and no conversation, project or provider data is migrated or rewritten.
- Local screenshots, credentials, generated bundles and browser runtime libraries are excluded from the release commit.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
