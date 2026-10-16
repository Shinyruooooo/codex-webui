# Changelog

All notable changes to **Codex PiWeb UI** (`codex-piweb-ui`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.5.0] - 2026-10-16

### Added
- DSH-inspired Skills sidebar with Official / Personal groups, search, read-only instruction inspector, and native Codex enable/disable controls.
- Personal skill creation, Markdown editing, and confirmed deletion under `$CODEX_HOME/skills/<id>` only; system/project/external skill files are read-only.
- Offline installation of locally cached `openai/skills` curated bundles without executing their scripts, preserving resources and refusing unsafe paths.
- `/skill-name` and `$skill-name` autocomplete and prompt chips serialized as native `UserInput.skill`; per-thread drafts retain selected skills.
- Opt-in extra skill roots through `CODEX_WEBUI_SKILL_EXTRA_ROOTS`; no implicit import or modification of Pi skills.
- Disposable-HOME integration coverage for real native skill discovery/configuration and browser management workflows without model inference.

### Fixed
- Installed skill cards show only the enable/disable switch; removed the adjacent Use text button. Inspector and composer skill invocation remain available.
- Long chat titles stay on one ellipsized line within the 46px header, including iPad split-window widths. Title styling now targets `#threadTitle` instead of a structural first-child selector that stopped matching after the sidebar toggle moved into the heading. Project paths shrink within a bounded width and header controls remain accessible.

## [0.4.0] - 2026-10-15

### Added
- **Compact Icon-Only Runtime Status & Token Bar**:
  - Replaced text-heavy runtime status in `#runtimeFooter` with a compact Pi Web-style icon indicator (`#runtimeStatusIcon` with screen-reader-accessible `#runtimeStatus`), showing idle dot, spinning `loaderCircle` while active, `shield` during approval, green `check` on completion, and red `triangleAlert` on failure.
  - Added `formatCompactTokenCount()` in `public/usage.js` to display concise `↑input ↓output · context% · 5h: XX% · Weekly: YY%` summaries while preserving full token and quota details in the expandable popover.
- **Pi Web-Style Sidebar Session Status Indicators**:
  - Added spinning indicator (`.thread-status-spinner`) for active/running sessions, amber dot for sessions awaiting approval, and cyan unread completion dot (`.thread-status-dot.is-completed`) for background sessions that finish while viewing another chat.
  - Added collapsed project-group status dot (`.sidebar-project-dot`) when a collapsed group contains active, approval-pending, or unread-completed sessions.
  - Enriched `thread/list`, `thread/read`, and `thread/resume` responses in `server.ts` with incremental `LiveSessionStore` rollout status (`liveActive`, `liveLastTurnId`, `liveLastTurnStatus`) so background CLI and WebUI sessions update sidebar status without requiring opening the thread first.
- **Security Hardening**:
  - Added server-side `cwd` boundary validation (`sanitizeBrowserRpcParams` in `server.ts`) for browser RPC calls (`thread/start`, `turn/start`, `permissionProfile/list`, etc.) against `browseRoots`.
  - Added `openVerifiedLocalFile` (`server/file-service.js`) and `readVerifiedLocalImage` (`server/image-service.js`) using `O_NOFOLLOW` + `fstat` inode/device verification and `createReadStream("", { fd })` to eliminate TOCTOU symlink race windows during file downloads and image reads.
  - Added per-IP login failure rate limiting (`createLoginRateLimiter` in `server/server-security.js`, wired to `POST /api/auth/login` with HTTP `429` + `Retry-After`).

### Changed
- **Manual & Adaptive Push Sidebar Layout**:
  - Removed automatic sidebar closing on thread selection or terminal open; `#sidebar` is now toggled manually via `#toggleSidebar` (or `Ctrl/Cmd+B`).
  - Removed `.mobile-device` fixed overlay drawer behavior on wide touch screens (e.g. iPad / touch laptops) so the left sidebar uses the same CSS Grid push layout as the right panel without covering the conversation.
- **Stable Sidebar Project & Session Ordering**:
  - Locked project-group ordering (`sidebarProjectOrder`) and existing thread ordering after initial load, and preserved `#threadList.scrollTop` across re-renders so clicking between sessions never reorders groups or jumps scroll position.
- **Composer Cleanup**:
  - Removed the redundant `#contextUsage` SVG mini-ring next to `#sendButton` in favor of the compact runtime footer summary.
- **Version Unification**:
  - Unified `package.json`, `initialize` `clientInfo`, and `GET /api/health` version reporting to `0.4.0`.

### Fixed
- **Stuck "Running" State on Interrupted Rollouts**:
  - Handled `event_msg` `turn_aborted` in `server/live-session-service.js` (`applyRolloutEvent`), marking aborted/interrupted turns as inactive (`active: false`, `status: "interrupted"` or `"failed"`) so sessions interrupted by service restarts or Ctrl+C no longer appear permanently running.
- **Unread Completion Dot Dismissal**:
  - Scoped unread completion dots strictly to background completions and cleared `unreadCompletedThreads` immediately when opening a thread.
- **Task Notification Toggle Feedback**:
  - Updated `#settingsTaskNotifyToggle` / `#settingsTaskNotifyRow` so clicking the toggle on insecure HTTP or browsers without the `Notification` API displays an explicit toast and description explaining the HTTPS / `localhost` requirement instead of silently doing nothing.
- **LaTeX Math Delimiter Support (`\(...\)` & `\[...\]`)**:
  - Updated `renderMath()` in `public/rendering.js` to support standard LaTeX inline (`\(...\)`) and display (`\[...\]`) math delimiters emitted by Codex models, in addition to `$...$` and `$$...$$`, preventing Markdown from stripping backslashes in formulas.
- **Process & Workspace Root Resilience**:
  - Added `child.on("error")` handling and fallback `spawnCwd` validation in `startCodex()` (`server.ts`) so missing binaries or invalid working directories trigger clean disconnect states and backoff retries instead of crashing the server process.
  - Included `defaultCwd` and `reviewRoots` in `browseRoots` so custom `CODEX_WEBUI_CWD` paths outside `$HOME` work consistently across file tree, search, upload, and workspace context APIs.
  - Updated `tests/app-server.integration.test.ts` to select a supported model dynamically from `model/list`.

---

## [0.3.0] - 2026-10-15

### Added
- **Pi Web-Aligned 3-Column Workspace**:
  - Added icon-only left sidebar switcher for **Sessions** (`#sidebarTabSessions`) and **Files** (`#sidebarTabFiles`), plus a direct **Terminal** trigger (`#sidebarTerminalButton`).
  - Added `/api/files/tree`, `/api/files/preview`, and `/api/files/upload` (25 MB limit, `O_NOFOLLOW` + inode verification, non-overwriting unique filenames, `.git` protection).
  - Added right-side **File preview** panel supporting Markdown rendering, syntax/text preview, and image preview.
- **Session Tools & `@` File Mentions**:
  - Added `public/session-tools.js` for per-session draft persistence (`readThreadDraft` / `writeThreadDraft`), structured `UserInput` (`text`, `mention`, `localImage`), and Markdown/JSON conversation export.
  - Added thread rename (`thread/name/set`), context compaction (`thread/compact/start`), and IME composition `Enter` protection.
  - Aligned `@` file mention UX with Pi Web (immediate top-level file/folder listing on `@`, `@folder/` trailing-slash drilldown, quoted paths with spaces, and hover `@` mention button in the file tree).
- **Runtime Observability & Quota Display**:
  - Added `public/usage.js` and `#runtimeFooter` for real-time phase tracking, elapsed timer, CLI rollout `token_count` synchronization, and Codex `account/rateLimits/read` (`5h` and `Weekly` remaining quota + reset countdowns).
- **Theme & Settings Cleanup**:
  - Added `public/theme.js` (`system` / `light` / `dark`) and removed 11 static placeholder settings pages, keeping `General`, `Appearance`, `Configuration`, `Profile`, and `Keyboard shortcuts`.
- **Performance & Multi-Device Reliability**:
  - Added `ETag` + gzip static asset caching in `server.ts`, decoupled `loadInitial()` with `Promise.allSettled` and RPC timeouts, and guarded `Notification` API calls for iPad Safari compatibility.
- **Repository Reorganization**:
  - Moved 13 backend service modules into `server/` and added `THIRD_PARTY_NOTICES.md`.

---

## [0.2.0] -Upstream Baseline (`lezi-fun/codex-webui`)

- Initial local/LAN WebUI for `codex app-server --stdio` by `lezi-fun`, featuring WebSocket/SSE bridge, native conversation timeline, command/file/permission approvals, unified/split diff review with Git Undo/Reapply, PTY terminal worker, and LAN `scrypt` password authentication.
