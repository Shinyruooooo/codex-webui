# Codex PiWeb UI v0.8.0 — Release Notes

- **Version:** `0.8.0`
- **Date:** 2026-10-21
- **Base release:** `v0.7.0`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.8.0`

## Removed / 本次删除

The built-in interactive terminal has been removed by request, rather than continuing to investigate device-specific connection failures.

按用户要求删除内置交互终端，不再围绕设备连接问题继续修补：

- Removed terminal buttons from the sidebar, file toolbar and right-panel launcher, along with terminal reconnect/status/diagnostics UI.
- Removed the legacy bottom terminal panel and its Cmd/Ctrl+J shortcut; the chat area no longer reserves a bottom-panel grid row.
- Removed the terminal WebSocket transport, PTY child-process worker and shutdown hooks. Authenticated HTTP requests and WebSocket upgrades to `/terminal` are rejected with 404; unauthenticated requests remain protected by the existing authentication checks.
- Removed xterm CSS loading and the `@xterm/xterm`, `@xterm/addon-fit`, `node-pty` and native-addon dependencies from the manifest/lockfile, plus the Docker PTY compilation step.
- Removed terminal-only tests and replaced them with removal regression coverage. Updated shared layout, file and side-panel tests instead of removing their unrelated coverage.

## Preserved / 保留功能

- Codex still runs commands through its own tools and approval flow. Command activity, output, interactive command events and permission controls remain in the conversation.
- The authenticated `/ws` chat bridge, SSE fallback, conversations, image attachments, file upload/preview, Skills, browser/side-task views and resizable side panels remain available.
- No changes to the authentication policy, EasyTier forwarding, browser permissions or host networking are included. Speculative terminal-diagnostic changes from the preceding investigation are not shipped.

## Verification / 验证

Browser checks use isolated temporary homes and test passwords, not user conversations or credentials. No model inference is required by these fixtures.

| Check | Result |
| --- | --- |
| `bun run test:unit` | Passed: 228 tests across 32 files, 0 failed |
| `bun run check` / `bun run build` | Passed: server, development entry and browser bundle compile |
| `git diff --check` | Passed |
| Frozen lockfile consistency | Passed: `bun install --lockfile-only --frozen-lockfile --ignore-scripts` |
| `tests/terminal-removal.e2e.mjs` — Chromium | Passed at 1360 / 1000 / 390 px: password login, absent terminal UI/automatic sockets, disabled shortcut, HTTP 404 and rejected WS `/terminal`, accepted authenticated `/ws`, file preview, side-panel resize |
| `tests/terminal-removal.e2e.mjs` — Playwright WebKit | Passed at 1360 / 1000 / 390 px with the same assertions |
| `tests/message-actions.e2e.mjs` — Chromium and Playwright WebKit | Passed in both engines at 1360 / 1000 / 390 px: message wrap/copy regression |

The complete legacy browser/integration suites and Docker image execution were not rerun. These results establish the listed removal and retained UI behavior, not real Mac/iPad networking compatibility.

## Scope and upgrade notes / 范围与升级说明

- This is an intentional feature removal, **not a claimed fix or confirmed root cause for macOS/Safari connectivity**. Playwright WebKit on Linux is not an actual Mac/iPad device test.
- Use an external terminal/SSH client for a manual shell. Codex command execution inside a conversation is unaffected.
- Update the source and dependencies, then restart the WebUI and reload the browser. Finish active Codex turns before restarting the service.
- Publishing a Git tag/Release does not restart a running service. Existing conversation, project and provider data are not migrated, rewritten or deleted.
- Local screenshots, credentials, generated bundles and browser runtime libraries are excluded from the release commit. Docker image execution is not claimed as tested unless explicitly listed in the verification results.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
