# Release Report — Codex PiWeb UI `v0.4.0`

- **Project Name**: Codex PiWeb UI (`codex-piweb-ui`)
- **Version**: `0.4.0`
- **Release Date**: 2026-10-15
- **Repository**: [`https://github.com/Shinyruooooo/codex-webui`](https://github.com/Shinyruooooo/codex-webui)
- **Branches**:
  - `main`: Stable production release branch (`v0.4.0`)
  - `dev`: Active development branch
- **Upstream & Attribution**:
  - Base project: [`lezi-fun/codex-webui`](https://github.com/lezi-fun/codex-webui) (MIT License)
  - Workspace UI/UX inspiration: [`agegr/pi-web`](https://github.com/agegr/pi-web) `v0.12.1` (MIT License)

---

## 1. Executive Summary

**Codex PiWeb UI `v0.4.0`** completes the secondary development of `codex-webui` into a fast, secure, Pi Web-aligned three-column workspace for `codex app-server --stdio` and `codex-cli`. This release delivers:

1. **Pi Web-Aligned Three-Column Layout & Manual Push Sidebar**:
   - Left sidebar provides an icon-only switcher for **Sessions** and **Files** plus a one-click **Terminal** button.
   - Left sidebar uses a manual toggle (`#toggleSidebar` / `Ctrl+B`) and CSS Grid push layout that adapts the center conversation area instead of covering it on touch/tablet devices.
   - Project groups and session items maintain a stable order and scroll position when switching between conversations.
2. **Concise Runtime Observability & Session Status Indicators**:
   - Compact icon-only runtime status indicator (`#runtimeStatusIcon`), elapsed timer, compact token usage (`↑in ↓out · ctx%`), and Codex `5h` / `Weekly` remaining quota summary in `#runtimeFooter`.
   - Real-time sidebar session status indicators: spinning loader for running sessions, amber dot for pending approvals, and cyan unread completion dot that clears immediately upon opening the session.
   - Full rollout lifecycle parsing (`task_started`, `task_complete`, `turn_aborted`, `token_count`) so background CLI and WebUI sessions reflect accurate status without requiring opening the conversation first.
3. **File Workspace, `@` Mentions & Session Productivity**:
   - Built-in workspace file tree (`/api/files/tree`), safe file preview (`/api/files/preview`), and attachment upload (`/api/files/upload` with paste/drag-and-drop).
   - Pi Web-style `@` file mention autocomplete with immediate directory listing, `@folder/` trailing-slash drilldown, quoted paths, and hover `@` quick-mention in the file tree.
   - Per-session draft persistence, IME composition `Enter` protection, thread rename, context compaction (`/compact`), Markdown/JSON export, and full KaTeX math rendering for both `$...$` / `$$...$$` and `\(...\)` / `\[...\]` delimiters.
4. **Security Audit Remediation & Hardening**:
   - All actionable findings from the read-only security and code quality audit have been resolved and verified by automated tests.

---

## 2. Security & Reliability Audit Remediation Summary

| # | Audit Finding | Severity | Resolution in `v0.4.0` | Verification |
| --- | --- | --- | --- | --- |
| 1 | Browser RPC `cwd` parameter was forwarded without boundary validation | High | Added `sanitizeBrowserRpcParams()` in `server.ts` to validate and canonicalize `params.cwd` against `browseRoots` before forwarding any RPC call to `codex app-server`. | `tests/app-server.integration.test.ts` |
| 2 | `spawn("codex", ...)` lacked `child.on("error")` handler and `cwd` fallback | High | Added `try/catch`, `spawnCwd` directory verification, and `child.on("error")` handling in `startCodex()` so spawn failures broadcast `disconnected` and schedule a backoff retry instead of crashing the server. | `server.ts` |
| 3 | File download & local image endpoints had a TOCTOU race between path check and file open | Medium | Added `openVerifiedLocalFile()` (`server/file-service.js`) and `readVerifiedLocalImage()` (`server/image-service.js`) using `O_NOFOLLOW` + `fstat` inode/device verification, streaming directly from the verified file descriptor (`createReadStream("", { fd })`). | `tests/file-service.test.ts`, `tests/image-service.test.ts`, `tests/file-download.e2e.mjs`, `tests/image-viewer.e2e.mjs` |
| 4 | Custom `CODEX_WEBUI_CWD` outside `$HOME` conflicted with `browseRoots` | Medium | Unified `browseRoots` in `server.ts` to include `defaultBrowseRoots(homeDir)`, `defaultCwd`, and `reviewRoots`. | `tests/workspace-files-and-actions.e2e.mjs` |
| 5 | Rollout parser ignored `turn_aborted`, leaving interrupted sessions stuck in `inProgress` | High (UX) | Handled `turn_aborted` in `server/live-session-service.js` (`applyRolloutEvent`), marking aborted turns as `active: false` and `status: "interrupted"` / `"failed"`. | `tests/live-session-service.test.ts` |
| 6 | `/api/auth/login` had no per-IP brute-force rate limiting | Low / Medium | Added `createLoginRateLimiter()` in `server/server-security.js` and enforced HTTP `429` (`Retry-After`) on repeated failed password attempts in `server.ts`. | `tests/server-security.test.ts`, `tests/password-login.e2e.mjs` |
| 7 | Integration test hardcoded legacy model `gpt-5.4-mini` | Low | Updated `tests/app-server.integration.test.ts` to dynamically query `model/list` and select the active default model and supported reasoning effort. | `tests/app-server.integration.test.ts` |
| 8 | Version mismatch across `package.json`, `initialize`, and `/api/health` | Low | Unified version constant `APP_VERSION = "0.4.0"` across `package.json` and `server.ts`. | `tests/password-login.e2e.mjs` |

---

## 3. Repository Structure

```text
codex-webui/
├── server.ts                  # Main HTTP/WebSocket server & Codex app-server stdio bridge
├── dev.ts                     # Development watcher for backend & browser bundle
├── server/                    # Modular backend services
│   ├── file-search.js         # Workspace @ file/folder search within allowed roots
│   ├── file-service.js        # File tree, preview, upload & O_NOFOLLOW verified file access
│   ├── folder-service.js      # Allowed browse roots & folder picker service
│   ├── image-service.js       # O_NOFOLLOW verified local image reader
│   ├── live-session-service.js# Incremental CLI rollout JSONL parser (turns, tools, tokens, aborts)
│   ├── password-store.ts      # Salted scrypt LAN credential persistence
│   ├── profile-service.ts     # Localhost-only Codex account profile & avatar proxy
│   ├── pty-worker.mjs         # Node.js PTY worker for interactive xterm.js sessions
│   ├── review-service.js      # Git unified diff Undo / Reapply executor
│   ├── review-state.js        # Server-owned turn diff state machine
│   ├── server-security.js     # RPC allowlist, asset allowlist, session HMAC & login rate limiter
│   ├── terminal-service.js    # PTY session lifecycle & resize validation
│   └── workspace-context.js   # Workspace folder & Git branch detector
├── public/                    # Modular browser frontend
│   ├── index.html             # 3-column Pi Web-style application shell
│   ├── style.css              # Light/dark theme tokens, adaptive push grid & component styles
│   ├── app.js                 # Main client controller
│   ├── usage.js               # Token usage & Codex 5h/Weekly quota normalization & formatting
│   ├── session-tools.js       # Per-session drafts, UserInput builder & Markdown/JSON export
│   ├── theme.js               # System / Light / Dark theme preference manager
│   ├── ui-core.js             # Turn windowing, model filtering & @ mention autocomplete logic
│   ├── codex-surfaces.js      # Approval models, unified/split diff parser & activity summaries
│   ├── rendering.js           # Safe Markdown (DOMPurify + Marked) & KaTeX math renderer
│   └── i18n.js                # English / Simplified Chinese localization
├── tests/                     # 24 unit test suites + 31 Playwright E2E browser suites + integration tests
├── CHANGELOG.md               # Keep-a-Changelog release history
├── RELEASE_REPORT.md          # Engineering & security release report
├── LICENSE                    # MIT License (preserving upstream & secondary development notices)
└── THIRD_PARTY_NOTICES.md     # Attribution for lezi-fun/codex-webui and agegr/pi-web
```

---

## 4. Verification Summary

- **Static Bundle Check (`bun run check`)**: Passed (`server.ts`, `dev.ts`, `public/app.js`).
- **Unit Tests (`bun run test:unit`)**: **24 test files, 137 passed, 0 failed**.
- **Browser End-to-End Tests (`bun run test:browser`)**: **31 Playwright E2E suites passed, 0 failed** (covering desktop/mobile layouts, themes, i18n, LAN password setup/login, SSE fallback, terminal, diff review, file workspace, `@` mentions, notification compatibility, and runtime feedback).
