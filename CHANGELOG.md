# Changelog

All notable changes to **Codex PiWeb UI** (`codex-piweb-ui`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.8.0] - 2026-10-21

### Removed
- Removed the built-in interactive terminal: sidebar/file-toolbar and panel entries, keyboard shortcut, reconnect/diagnostics UI, WebSocket transport, PTY worker and the legacy bottom panel. The removed `/terminal` endpoint now rejects connections; the authenticated `/ws` chat bridge is unchanged.
- Removed `@xterm/xterm`, `@xterm/addon-fit`, `node-pty` and their dedicated tests, CSS and Docker native-build steps. Codex command execution, command output, approval controls, file previews and the resizable side panel remain available.

### Changed
- Added authenticated Chromium/WebKit regression coverage for terminal removal and preserved chat/file/panel behavior. No macOS/Safari connection root cause or fix is claimed by this removal.

## [0.7.0] - 2026-10-20

### Added
- Failed conversation bubbles now have a retry button that resends that message, including its original text and image attachments.
- The working directory is a first-class, URL-addressable choice: `?cwd=` restores it on load, the New chat button shows the directory a new task will run in, the empty state displays it with a shortcut to change it, and `GET /api/cwd/validate` validates a candidate directory.

### Changed
- Images pasted or attached in the composer are kept in the message as inline data, matching Pi Web, instead of being written into the project directory. Project file uploads still go to the working directory.
- Opening a history thread no longer changes the project directory used for new tasks, and switching the working directory no longer discards the open conversation or its draft.

## [0.6.1] - 2026-10-20

### Added
- Pi Web-style copy actions for user/assistant message text and fenced code blocks, with success feedback, keyboard/touch access and an HTTP-compatible clipboard fallback. Streaming/replayed messages keep one up-to-date control; copying never submits a prompt or executes code.
- The right-side panel can be resized by dragging its left edge or using separator keyboard controls; browser-local width preferences survive reloads, double-click restores the default, and viewport limits keep the chat usable. Terminal rows/columns follow panel resizing without replacing the shell.
- Terminal connection/output-waiting status, an explicitly confirmed reconnect action, and a copyable diagnostics dialog containing only transport/rendering metadata—not commands, terminal output or credentials. Added authenticated Chromium/WebKit coverage for terminal input, reconnect, diagnostics privacy and resizing at desktop, split-window and mobile widths.

### Fixed
- Long unbroken strings such as public keys, paths and URLs now wrap inside user message bubbles without truncating the source. Code remains formatted in bounded, horizontally scrollable blocks.
- Reopening an already-connected terminal on narrow/overlay layouts now keeps keyboard focus in the terminal instead of moving it to the panel close button. Added real-PTY first-open/reopen command-input coverage at desktop, split-window and mobile widths.

### Changed
- The release workflow supports manually publishing an existing version tag when its original push event has no run; it verifies the exact tagged source and notes without moving the tag.

## [0.6.0] - 2026-10-18

### Added
- Pi Web-style provider cards with configured/enabled status, a group switch, and individual model switches. Disabled models are hidden from the picker and rejected for new bridge inference while credentials and in-flight turns remain intact; visibility and catalog changes no longer restart the app-server.
- Per-provider and all-provider model refresh: bounded authenticated `/models` discovery, safe preset fallback when unsupported, preservation of existing metadata/choices, and new models off by default. Errors leave settings unchanged, redirects are rejected, and concurrent updates are serialized with HTTP 409 conflicts.
- Provider presets for GLM Coding Plan (China), Z.AI Coding Plan (international), and DeepSeek: select an endpoint and enter only an API key. The existing manual fields remain available under Advanced configuration, with vendor documentation links. Presets follow official Responses API documentation and do not import Pi credentials or Chat/Anthropic endpoints.
- `test:providers` runs provider unit, real app-server/mock-endpoint integration, and browser smoke tests (including light/dark button contrast, mobile Chinese layout, key-only setup, mutation races, and model/effort preservation).
- Custom model providers: manage OpenAI Responses-compatible third-party endpoints (for example Z.AI GLM Coding Plan or DeepSeek) in Settings → Model providers. Providers are injected into the spawned `codex app-server` with API keys passed through per-provider environment variables, custom models appear in the model picker, and new chats bind to the selected provider automatically. The provider store lives at `$CODEX_HOME/codex-webui-models.json` (override with `CODEX_WEBUI_MODELS_JSON`) and is editable at runtime; connection changes restart the bridge, while model switches and catalog changes do not.
- New provider configuration/discovery tests, a real app-server/mock-endpoint integration suite and a settings surface browser regression suite.
- A tag-triggered GitHub Release workflow with version/notes validation, pinned checkout action and repository-scoped authentication; no personal API token is required on the release host.

### Changed
- Removed the redundant provider-preset dropdown from the setup form. Provider cards select the preset directly; the form shows its name, API key and optional advanced settings without a second selector.

### Fixed
- Session history now explicitly requests all model providers from `thread/list` when no provider filter is supplied. This prevents Z.AI and other non-default-provider sessions from disappearing from the sidebar, while preserving explicit filters, pagination and archive semantics; history remains visible after a provider is disabled or removed.
- Provider edits reject stale revision snapshots instead of undoing model switches or discoveries. Metadata-only saves refresh the initiating tab's picker immediately. Native provider identities and compaction requests obey visibility gates. Built-in model-ID conflicts are filtered before directory capacity limits; startup-loaded, hand-edited stores are also verified before custom routing so conflicting entries cannot hijack or disable native model selection.
- The provider Save button uses an opaque theme foreground; its label is readable in light and dark themes instead of appearing as a blank rectangle. Long provider help text now wraps within the existing layout.
- Provider key environment names use collision-free ID encoding; changing an endpoint requires a fresh key. Pending provider mutations cannot replace a new editor, and catalog refreshes preserve the active chat's model and reasoning effort.
- `tests/app-server.integration.test.ts` no longer depends on the exact "outside the allowed roots" wording (current Codex reports "outside allowed roots").

## [0.5.2] - 2026-10-18

### Added
- Conversation settings are now stored per conversation, so model, reasoning effort and permission mode are restored independently when switching sessions.
- Conversation history opens with the newest turn and loads older turns automatically as the user scrolls upward.

### Changed
- Conversation loading now requests lightweight thread metadata before fetching the visible turn page, reducing initial history payloads for long sessions.
- Removed the review panel from the application surface.

### Fixed
- Approval cards can expand beyond the composer boundary on narrow screens, so authorization actions remain fully visible.

## [0.5.1] - 2026-10-17

### Changed
- Runtime quota details now close on the next click anywhere on the page.
- The left Files sidebar now shows hidden workspace files and folders such as `.env` and `.gitignore`.
- Simplified both READMEs around features, installation and usage, removed screenshots and image badges, and shortened acknowledgments while preserving upstream and third-party license notices.

### Fixed
- Curated skill bundles preserve executable bits when installed under the server's restrictive `umask`, while other file permissions remain protected.
- Added browser coverage for hidden workspace file entries.

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
