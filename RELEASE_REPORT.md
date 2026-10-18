# Codex PiWeb UI v0.6.0 — Release Notes

- **Version:** `0.6.0`
- **Date:** 2026-10-18
- **Base release:** `v0.5.2`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.6.0`

## Highlights / 本次更新

### Third-party model providers — 第三方模型提供商

- Connect OpenAI **Responses API** endpoints through Settings → Model providers, without rewriting the user's Codex `config.toml`.
- Built-in presets cover **GLM Coding Plan (China)**, **Z.AI Coding Plan (International)** and **DeepSeek**. Click a provider card and enter its API key; endpoint/model defaults are supplied automatically.
- Provider cards show configured and enabled status. The redundant provider dropdown has been removed; the existing interface and optional Advanced configuration remain available.
- API keys stay in a local mode-0600 store and are injected into the app-server through collision-free environment variable names. Public provider responses never include the stored keys; changing an endpoint requires a new credential.

### Model catalogs and switches — 模型目录与开关

- Refresh one configured provider or all providers through bounded authenticated `/models` discovery. Matching presets explicitly fall back to their built-in catalog when discovery is unsupported.
- Preserve manual models, metadata and enabled selections. Newly discovered models default to **off** until their Responses compatibility is confirmed.
- Provider switches control the whole model group; individual model switches allow finer selection. Disabled models disappear from the picker and cannot start new WebUI inference or compaction.
- Model switches and catalog changes keep credentials, do not interrupt running turns, and do not restart the Codex bridge. Connection changes still require a bridge restart.
- Stale editor revisions return HTTP 409 instead of overwriting newer choices. Refreshes preserve the active conversation's model and reasoning effort. Native ID collision protection covers API saves, discovery, hand-edited startup files and actual routing; invalid file entries cannot hijack or disable native model selection, and the source file is not silently rewritten.

### Complete cross-provider history — 跨提供商会话完整显示

- Default session listing now explicitly requests **all model providers**. Z.AI and other non-default-provider sessions no longer disappear from the sidebar.
- Explicit provider filters, pagination, sorting and archive behavior remain intact. History stays visible when a provider is disabled or removed.
- Existing conversation files are not rewritten, migrated or reindexed by this fix.

## Verification / 验证结果

| Check | Result |
| --- | --- |
| `bun run check` | Passed: server, development entry and browser bundle compile |
| `bun run build` | Passed: browser bundle and `dist/server.js` generated |
| `git diff --check` | Passed |
| `bun run test:unit` | Passed: 188 tests across 29 files, 0 failed |
| `bun run test:providers` | Passed: 49 provider unit/integration checks plus focused browser smoke |
| Bundled server `/api/health` version | Passed: disposable-home smoke returned `codex: true`, version `0.6.0` |
| Release metadata and workflow validation | Passed: package/server/notes consistency, YAML and shell syntax, tag-only trigger and immutable checkout SHA |

### Verification limits / 验证边界

- Provider integration uses the **real Codex app-server** against a local mock Responses endpoint in a disposable `HOME` / `CODEX_HOME`; it verifies HTTP/Bearer routing, streaming completion, persisted history, switches, catalog discovery and failure handling without a paid third-party inference request.
- Focused browser coverage checks the provider cards, key-only setup, custom editing, switches, refresh, stale-save protection, light/dark button contrast and mobile Chinese layout. The entire legacy browser and end-to-end suites have **not** been run for this release.
- The separate existing OpenAI live-inference smoke was attempted during development and **did not pass**, reporting `workspace routing discovery failed` while the development host's OpenAI outbound connection was failing. It is not counted among the passed checks above; real OpenAI/ChatGPT account inference remains unverified for this release environment.
- One initial focused browser run timed out in `waitForFunction`; a diagnostic rerun and a subsequent clean `test:providers` run passed. No deterministic cause was established for that initial timeout.
- A saved API key or a `/models` listing is not proof that a real account has model access, tool-use support, quota or billing entitlement.

## Upgrade notes / 升级注意事项

- Install/update dependencies with Bun, then use `bun run start`; `bun run build` produces bundled deployment files.
- Finish active turns before restarting a managed WebUI service. Publishing branches, a tag or a Release does not itself restart the service.
- The default provider store is `$CODEX_HOME/codex-webui-models.json`; `CODEX_WEBUI_MODELS_JSON` can override it. `$VAR` / `${VAR}` API-key references are supported.
- GLM domestic and international presets share the `zai` provider ID: choose the region matching the **Coding Plan** key. Standard model API keys are not interchangeable with Coding Plan keys.
- Only Responses-compatible endpoints are supported. Pi's Chat Completions, Anthropic-only endpoints, OAuth state and credentials are not imported.
- Existing stores without `enabled` fields remain enabled. Local secrets, user sessions, logs, screenshots, runtime files and generated bundles are not included in the Git release commit.

## Publishing / 发布流程

The tag-triggered Release workflow verifies version consistency and publishes this document as the GitHub Release notes using GitHub's repository-scoped token. It does not require a personal API token on the development host and never overwrites an existing release tag.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md), [CONTRIBUTING.md](./CONTRIBUTING.md) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
