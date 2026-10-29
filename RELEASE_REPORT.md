# Codex PiWeb UI v0.8.0 — Release Notes

- **Version:** `0.8.0`
- **Date:** 2026-10-29
- **Base release:** `v0.7.1`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.8.0`

## Highlights / 本次更新

### Provider switching inside an existing chat — 对话内可切换提供商

- Every turn now sends the `modelProvider` that owns the selected model, so a conversation can move between providers without starting a new chat. Previously the bridge pinned a chat to the provider that created it and rejected a mismatch with "start a new chat to use …".
- Codex resolves **one** default provider for the whole built-in model catalog, and users routinely alias it (`model_provider = "chatgpt-http"`). The bridge now reads that provider from the Codex configuration (`config/read`) and treats it as the built-in channel, so every native model stays on one channel instead of being split into foreign providers that would lock the conversation.
- The bridge keeps the per-thread provider only for model validation and compaction; a turn may now cross channels. Visibility gates still apply: a model whose provider is disabled or removed is rejected for new inference.
- The model picker no longer warns "Switching provider requires a new chat", and the Settings → Model providers note was updated to state that each turn uses the provider of the selected model.

### Star a default model — 星标默认模型

- A star next to each model in the model picker saves it as the default model for new conversations, matching Pi Web. The default is stored per browser, applies to new chats only, and each conversation keeps its own model.

### Model picker grouped by provider — 模型选择器按提供商分组

- The model picker now groups models by provider with a provider heading per group, matching Pi Web.

## Verification / 验证结果

| Check | Result |
| --- | --- |
| `bun run test:unit` | Passed: 227 tests across 32 files, 0 failed |
| `bun run check` | Passed: server, development entry and browser bundle compile |
| `bun test tests/global-provider.integration.test.ts` | Passed: 3 tests, 0 failed — an aliased default provider (`model_provider = "alias-global"`) switches between built-in models, from the default channel to a managed provider and back, through a real Codex app-server against a mock Responses endpoint |
| `bun test tests/custom-provider.integration.test.ts` | Passed: 14 tests, 0 failed — including the real turn that switches from a custom provider to a built-in model |
| `bun test tests/i18n.test.ts` | Passed: 4 tests, 0 failed — the updated provider note stays translatable |
| `git diff --check` | Passed |

### Verification limits / 验证边界

- **The browser end-to-end suites did not run on this machine.** Chromium fails to launch with `libatk-1.0.so.0: cannot open shared object file`, and the machine has no passwordless `sudo` to install the missing system library. The UI change is limited to removing one toast string and rewriting one Settings note, both covered by the i18n unit test, but the provider settings browser suite was not executed for this release.
- **`tests/app-server.integration.test.ts` has two failing cases in this environment, and both fail identically on the unmodified `v0.7.1` tree.** "loads models and threads from the real Codex app-server" expects at least one existing thread and finds none on this account; "streams a harmless real turn to completion" failed twice with the upstream error `Selected model is at capacity` (`serverOverloaded`) and passed on re-runs. The first failure reproduces on a clean checkout of `4130c30`, so it is not caused by this release.
- **No paid inference against a real provider was performed.** The provider routing was verified with a mock Responses endpoint and a real `codex app-server`; no API key was used and no billed model call was made.
- The default provider is read once at startup with a 5 second timeout. If `config/read` fails or times out, provider checks stay permissive instead of blocking turns.

## Scope and upgrade notes / 范围与升级说明

- This release changes provider routing and the model picker. The authentication model, the working-directory behaviour, the conversation retry action, the inline image attachments and the terminal from v0.7.0 are unchanged.
- Update the source and dependencies, then restart the WebUI so the new bridge logic is served, and reload the browser. Finish active Codex turns before restarting the service.
- Publishing a Git tag or Release does not restart a running service, and no conversation, project or provider data is migrated or rewritten.
- Local screenshots, credentials, generated bundles and browser runtime libraries are excluded from the release commit.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
