# Codex PiWeb UI v0.6.1 — Release Notes

- **Version:** `0.6.1`
- **Date:** 2026-10-20
- **Base release:** `v0.6.0`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.6.1`

## Highlights / 本次更新

### Contained long messages — 修复长文本溢出

- Long unbroken strings such as public keys, paths and URLs wrap inside user message bubbles without truncating the source or inserting line breaks into the copied text.
- Code stays formatted inside bounded, horizontally scrollable blocks rather than expanding the conversation beyond its viewport.

### Message and code copy — 消息与代码复制

- Pi Web-style copy buttons for user and assistant messages: hover on desktop, with persistent controls on touch devices and keyboard activation support.
- Each fenced code block has a top-right copy action. It copies code only, without Markdown fences, toolbar labels or line numbers; indentation, line breaks and Unicode are preserved.
- Message actions read the current text/Markdown, including streamed updates; completion replay does not duplicate controls. Buttons show a short check-mark confirmation only when copying succeeds.
- Secure Clipboard API writes fall back to a selected readonly textarea when unavailable or rejected, including HTTP deployments. Focus and selection are restored. If both methods are blocked, the UI reports failure instead of pretending success.
- Copying never submits a prompt or executes a command. The added copy glyph uses the existing ISC-licensed Lucide icon set, with its source recorded in third-party notices.

### Resizable right panel — 右侧栏可拖动调宽

- Drag the panel's left edge to adjust its width; browser-local preferences survive reloads. Double-click resets the width, and separator keyboard controls support precise adjustments.
- Viewport/sidebar bounds keep the chat usable, including when the left sidebar opens with an animation. Narrow mobile layouts retain their full-width panel behavior.
- Terminal columns follow panel size changes without replacing the connected shell.

### Terminal interaction and diagnostics — 终端交互与诊断

- Reopening an already-connected terminal on overlay layouts keeps keyboard focus in its input instead of the close button.
- The terminal header distinguishes connecting, connected, waiting-for-output and disconnected/error states.
- A confirmed reconnect action restarts only that terminal session. Its confirmation warns that attached programs end; it does not restart the WebUI Codex service.
- Copyable diagnostics contain transport/rendering metadata only: no commands, terminal output or credentials. Late callbacks from an old WebSocket do not overwrite a replacement connection's state.

### Publishing recovery — 发布流程补充

- The Release workflow can publish an existing tag through manual dispatch when its original push event has no run, checking out and validating the exact tagged version and notes without moving the tag.

## Verification / 验证结果

| Check | Result |
| --- | --- |
| `bun run check` | Passed: server, development entry and browser bundle compile |
| `bun run build` | Passed: generated browser bundle and `dist/server.js` |
| `git diff --check` | Passed |
| `bun run test:unit` | Passed: 218 tests across 31 files, 0 failed |
| `bun run test:messages` | Passed: 31 targeted unit checks and Chromium at 1360/1000/390px |
| `bun run test:messages:webkit` | Passed: WebKit at 1360/1000/390px |
| `bun run test:terminal` | Passed: 3 service checks and authenticated Chromium input, focus, reconnect, diagnostics and resizing |
| `bun run test:terminal:webkit` | Passed: authenticated WebKit at all three widths, including silent/error connection fixtures |
| `bun run test:providers` | Passed: 49 provider unit/integration checks plus focused browser smoke |
| Bundled server `/api/health` | Passed: disposable-home smoke returned `codex: true`, version `0.6.1` |
| Release metadata/workflow validation | Passed: YAML/shell syntax, pinned checkout and the actual `v0.6.1` version/notes guard |

### Verification limits / 验证边界

- The user's specific **blank terminal in Mac Safari has not been reproduced or confirmed fixed**. This release includes the reproducible focus fix, status, reconnect and diagnostics; Chromium and Playwright WebKit results do not substitute for validating that exact client environment.
- Message tests use synthetic transcripts and key-like strings, never the user's screenshot or conversation. They cover controlled before/after overflow, streaming/replay, native clipboard mocks, fallback and real browser DOM copy events without reading existing clipboard contents or issuing model/SSH commands.
- Terminal browser checks use real PTYs in disposable homes with password authentication. Provider integration uses the real app-server against local mock endpoints; no paid provider inference is required.
- The entire legacy browser/end-to-end suites and live OpenAI/account inference were not rerun for this UI patch. The v0.6.0 development live smoke reported `workspace routing discovery failed`; that historical failure is not counted as a passed check or claimed repaired here.
- Browser clipboard policy can still prohibit both copy methods; the supported response is a clear failure prompt and manual selection, not an automatic permission bypass.

## Upgrade notes / 升级注意事项

- Update source/dependencies as usual and use `bun run start`, or generate bundled files with `bun run build`.
- Publishing branches, a tag or a Release does not itself restart a managed service. Finish active Codex turns before restarting it; finish or detach terminal programs before reloading the browser or reconnecting a terminal.
- Existing provider stores and conversation files are not migrated or rewritten by this patch. Width preferences are browser-local.
- Local credentials, user sessions, the uploaded screenshot, logs, browser runtime libraries and generated bundles are excluded from the Git release commit.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md), [CONTRIBUTING.md](./CONTRIBUTING.md) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
