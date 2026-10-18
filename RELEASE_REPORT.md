# Codex PiWeb UI v0.5.2 — Release Report

- **Version:** `0.5.2`
- **Date:** 2026-10-18
- **Base release:** `v0.5.1`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.5.2`

## Highlights / 本次更新

### Faster conversation startup — 更快打开历史对话

- Opening a conversation first loads lightweight thread metadata and the newest turn only.
- Older turns load automatically when scrolling near the top of the conversation.
- The page preserves the user's scroll position while older content is inserted.
- Existing servers without the paginated turns endpoint retain the full-history fallback.

### Independent conversation settings — 会话配置独立

- Each conversation stores its own model selection.
- Reasoning effort is restored independently for each conversation and model.
- Permission mode is restored independently for each conversation.
- Existing conversations without saved settings use the configured default values.

### Approval surface fix — 授权交互修复

- Approval cards can expand outside the composer boundary on narrow layouts, keeping authorization controls visible and usable.

### Surface cleanup — 界面清理

- Removed the review panel from the application surface.

## Verification / 验证结果

| Check | Result |
| --- | --- |
| `bun run check` | Passed: server, development entry and browser bundle compile |
| `bun run build` | Passed: browser bundle and `dist/server.js` generated |
| `git diff --check` | Passed |
| `bun run test:unit` | Passed: 149 tests across 25 files, 0 failed |
| `bun run test:browser` | Not run: the current environment has no Playwright Chromium executable |
| Version consistency | `package.json`, app-server client info and `/api/health` use `0.5.2` |

The browser suite requires a locally installed Playwright Chromium executable. Its absence is an environment limitation and does not change the release contents.

## Upgrade notes / 升级注意事项

- Standard installation remains `bun install` followed by `bun run start`; `bun run build` is available for bundled deployment.
- Stop or finish active turns before restarting a managed WebUI service because it owns the `codex app-server --stdio` child.
- Existing conversations use the current default model, reasoning effort and permission mode until a per-conversation setting is selected.
- The paginated history path requires `thread/turns/list`; older servers use the compatibility fallback.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
