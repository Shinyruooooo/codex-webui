# Codex PiWeb UI v1.0.0 — Release Notes

- **Version:** `1.0.0`
- **Date:** 2026-10-30
- **Base release:** `v0.9.1`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v1.0.0`

v1.0.0 is the first major version: it closes the security findings from the full-project audit (XSS, LAN password-setup hijack, sensitive-file exposure, RPC parameter injection), ships the headline session-forking and archive features that close the biggest gap to the Pi Web reference, hardens the bridge against crash loops, and adds CI so every push and PR is verified.

## Highlights / 本次更新

### Session forking and archive — 会话分叉与归档

- **Fork from here**: hovering a user message now offers a fork action that creates an independent session containing everything up to and including that message (app-server `thread/fork` with `lastTurnId`). The conversation menu's **Duplicate session** forks a whole thread. The fork opens immediately and inherits the source configuration.
- **Archive**: **Archive thread** hides a session from the sidebar (`thread/archive`). Archived sessions appear in a collapsible **Archived** group at the bottom of the sidebar, where they can be restored (`thread/unarchive`) or permanently deleted. Because the app-server hides archived threads from `thread/list`, the restore list is kept in browser storage and is clearly labeled as such.

### Security hardening — 安全加固

- **Markdown XSS closed.** The frontend now actually loads the declared DOMPurify dependency and sanitizes every rendered Markdown surface with it; the previous regex fallback could be bypassed with entity-encoded `javascript:` URLs. The no-DOM fallback decodes entities before scheme checks.
- **LAN password setup can no longer be hijacked by a non-browser client.** `Origin`-less requests (curl, scripts) are rejected; only same-origin browser requests or loopback can claim the initial password.
- **Sensitive files are out of reach.** Preview, download, image and upload endpoints reject paths touching `.ssh` / `.aws` / `.gnupg` / `.codex`, `.env*` files, and private-key material, and refuse dot-prefixed upload names. Verified against `~/.codex/auth.json` and `~/.ssh/id_rsa`.
- **Browser RPC surface narrowed.** Unknown `config` keys on `thread/start`/`turn/start` are stripped (only `model`, `model_provider`, `approvalPolicy`, `sandbox` pass), and `skills/config/write` carries only `path` and `enabled`.

### Reliability and polish — 稳定性与体验

- The bridge restarts with exponential backoff (max 30 s) after an app-server crash instead of a 1-second respawn loop.
- Composer autocomplete no longer swallows Enter/Tab on empty menus; the WebSocket fallback timer clears on connect; drafts and `@` search are debounced with stale-response cancellation; the terminal follows the app theme; runtime maps are bounded; global shortcuts ignore text inputs.
- A CI workflow runs the unit suite, compile check and whitespace checks on every push and PR.

## Verification / 验证结果

All checks run on the release host (Bun 1.4.3, Node 24.22.0, Codex CLI 0.164.0-alpha.12, Linux x64).

| Check | Result |
| --- | --- |
| `bun run test:unit` | Passed: 247 tests across 33 files, 0 failed |
| `bun run check` | Passed: server, dev entry and browser bundle compile |
| `bun test tests/app-server.integration.test.ts` | Passed: 5 tests, 0 failed — against the real Codex app-server, including the previously host-dependent `thread/list` case (now self-seeding via a real turn) |
| `bun test tests/custom-provider.integration.test.ts tests/global-provider.integration.test.ts tests/account-login.integration.test.ts` | Passed: 23 tests, 0 failed — no regression in provider or sign-in flows |
| Live WS gateway probe (isolated store, LAN address) | `thread/fork` → new session (cleaned up via `thread/delete`); `thread/archive` / `thread/unarchive` → ok; `thread/started` dedup verified in unit tests |
| Password-setup probe | same-origin → 200, no-origin / cross-origin / forwarded → 403 |
| Sensitive-path probe | `~/.codex/auth.json`, `~/.ssh/id_rsa`, `~/.codex/../.codex/auth.json`, `~/project/.env` → rejected; ordinary files unaffected |
| `bun run test:unit` (XSS cases) | entity-encoded `javascript:`/`vbscript:` URLs (`&#106;avascript:`, `java&#115;cript:`, `java&Tab;script:`) stripped in both DOMPurify and fallback paths |
| `git diff --check` | Passed |

### Verification limits / 验证边界

- **Browser e2e suites did not run on this machine** (Chromium fails to launch: missing `libatk-1.0.so.0`, no passwordless sudo). UI changes were verified through unit tests (jsdom), compile checks and the live WS gateway probes, not through a rendered browser.
- **Archive bookkeeping is browser-local.** The app-server offers no archived-thread listing in this version, so the restore list lives in `localStorage`; clearing site data loses it (sessions remain recoverable via `codex unarchive <id>`).
- The integration suite leaves one persistent test session in the host's Codex session store (the app-server exposes no delete for the fixture turn's thread); it is inert history and does not affect runtime.
- `bun test` without arguments also collects integration tests and one live-service test; use the npm scripts (`test:unit`, `test:integration`) as CI does.

## Scope and upgrade notes / 范围与升级说明

- Fork and archive require Codex CLI ≥ 0.164 (protocol `thread/fork`, `thread/archive`, `thread/unarchive`). Older app-servers reject those RPCs; the UI surfaces the server error as a toast.
- Update the source and dependencies, restart the WebUI, and reload the browser. Finish active Codex turns before restarting the service.
- Publishing a Git tag or Release does not restart a running service; no conversation, project or provider data is migrated or rewritten.
- Local screenshots, credentials, generated bundles and browser runtime libraries are excluded from the release commit.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
