# Changelog

All notable changes to **Codex PiWeb UI** (`codex-piweb-ui`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [1.0.0] - 2026-10-30

### Added
- **Session forking**: hover any user message and use **Fork from here** to create an independent session that keeps everything up to and including that message; the conversation menu's **Duplicate session** forks the whole thread. Forked sessions open immediately and carry their source's configuration. Powered by the app-server `thread/fork` API.
- **Session archive**: **Archive thread** hides a session from the list (`thread/archive`); archived sessions are listed in a collapsible **Archived** group at the bottom of the sidebar and can be restored (`thread/unarchive`) or deleted from there. Restoration bookkeeping is kept in the browser, since the app-server hides archived threads from `thread/list`.
- A CI workflow (`.github/workflows/ci.yml`) runs the unit suite, the compile check and `git diff --check` on every push to `dev`/`main` and on pull requests.
- A Docker section in the READMEs documents the compose variables (`CODEX_BIN`, `CODEX_WEBUI_REVIEW_ROOT`, projectless mode); `.env.example` now documents `CODEX_WEBUI_PROJECTLESS` and `CODEX_WEBUI_NODE`, and the configuration tables list `CODEX_WEBUI_ACCESS_TOKEN` and the `CODEX_WEBUI_NTFY_TOPIC` / `CODEX_WEBUI_NTFY_URL` completion-push pair.

### Fixed
- The sign-in dialog copies the device code with the fallback that also works on plain HTTP, where the native clipboard API is unavailable, and the copy button now reads "Copied" after a successful copy.
- A finished sign-in now updates the interface even when the completion notification is missed. The open sign-in polls the sign-in state, so a suspended browser tab or a dropped bridge connection no longer leaves the dialog waiting with "not signed in". The bridge restarts after the notification was sent, so the browser sees the result before the restart.
- **XSS in Markdown rendering**: the interface now loads the declared DOMPurify dependency and sanitizes all rendered Markdown with it. Previously the sanitizer silently fell back to a regex filter that entity-encoded `javascript:` URLs (for example `&#106;avascript:`) could bypass in model output, file previews and skill descriptions. The no-DOM fallback now decodes entities before checking URL schemes.
- **LAN password-setup hijack**: `/api/auth/setup` accepted requests without an `Origin` header from any LAN client, so a non-browser client could claim the initial password before the owner. Setup now requires a same-origin request or a loopback connection.
- **Sensitive file exposure**: the file preview, download, image and upload endpoints resolve paths inside the whole home directory, which allowed reading `~/.codex/auth.json` or `~/.ssh/id_rsa` and uploading into `~/.ssh`. Paths containing `.ssh`/`.aws`/`.gnupg`/`.codex`, `.env*` files, and private-key material (`id_rsa*`, `*.pem`, `*.key`, `*.p12`) are now rejected for reads and writes, and dot-prefixed upload filenames are refused.
- **Browser RPC parameter injection**: `thread/start` and `turn/start` now strip unknown `config` keys (only `model`, `model_provider`, `approvalPolicy` and `sandbox` pass through), and `skills/config/write` carries only `path` and `enabled`.
- Composer autocomplete no longer swallows Enter/Tab when the menu has no selectable items, so messages send normally after `@` or `/`.
- The WebSocket connect-fallback timer is cleared on `open`, so in-flight requests are no longer rejected when the first bridge message is slow.
- The terminal follows the selected light/dark theme instead of freezing on the system preference at creation time.
- Composer draft saves and `@` file search are debounced, and stale `@` search responses are cancelled instead of racing.
- Session-runtime maps (turn payloads, statuses, token usage, inline images) are bounded and cleaned when switching conversations.
- Global shortcuts (⌘K/⌘B/⌘J) no longer fire while typing in inputs, and the shortcuts page matches the actual ⌘J behavior (open terminal).
- Model-provider and folder-browsing responses from an older request can no longer overwrite newer state.
- The app-server bridge restarts with exponential backoff (up to 30 s) after a crash instead of respawning every second.
- `thread/started` notifications no longer duplicate a session that local code already inserted.
- Integration test `loads models and threads from the real Codex app-server` no longer depends on pre-existing host sessions: it starts a real turn and asserts the thread appears in `thread/list`.

### Changed
- Setup responses no longer rewrite the session secret when the password file already exists, keeping environment-provided credentials authoritative.
- The bare `/tmp` directory is no longer an allowed root for file and image access; the per-user temp dir remains available.
- Docker image/container names in `docker-compose.yml` use `codex-webui` instead of the upstream `codex-webui-lezi-fun`; `.dockerignore` excludes local runtime state.
- The security-advisory link in the issue template points to this repository instead of the upstream fork.
- Documented Codex CLI version updated to 0.164.0.

### Notes
- Archived-session bookkeeping is browser-local. Clearing site data loses the list of archived sessions; they remain recoverable with `codex unarchive <id>`.

## [0.9.1] - 2026-10-29

### Fixed
- The sign-in state is now answered from the Codex credential store instead of `account/read`, which can block on workspace routing discovery. The status endpoint returns in milliseconds and no longer reports an unsigned account while a valid ChatGPT credential is present.
- Signing out now closes a sign-in that was still open, so the sign-in entry stays available afterwards.

## [0.9.0] - 2026-10-29

### Added
- Sign in with a ChatGPT account from the WebUI: **Settings → Profile → Log in with ChatGPT** starts a device-code sign-in through the Codex bridge, shows the one-time code and the verification page, and reports the result when Codex completes it. The flow works on a headless server and from any browser, so a CLI sign-in is no longer required first. The sign-in writes the same credential store as `codex login`, and the bridge restarts afterwards so the new account is used immediately.

## [0.8.0] - 2026-10-29

### Added
- A star next to each model in the model picker saves it as the default model for new conversations, matching Pi Web. The default is stored per browser and applies to new chats only; each conversation keeps its own model.
- The model picker now groups models by provider, with a provider heading per group, matching Pi Web.

### Changed
- Providers can now be switched inside an existing conversation: every turn sends the `modelProvider` that owns the selected model, so switching a model between providers no longer requires a new chat. Codex's default provider is read from its configuration, which lets an aliased default provider (`model_provider = "chatgpt-http"`) keep serving the built-in catalog.

## [0.7.1] - 2026-10-22

### Added
- MiniMax (China) provider preset for the OpenAI Responses endpoint, covering the MiniMax-M3.1-Flash and MiniMax-M3 coding models with their reasoning levels and image input.

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
