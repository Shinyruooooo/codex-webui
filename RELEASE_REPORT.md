# Codex PiWeb UI v0.9.1 — Release Notes

- **Version:** `0.9.1`
- **Date:** 2026-10-29
- **Base release:** `v0.9.0`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.9.1`

## Highlights / 本次更新

### Reliable sign-in state — 登录状态判断修正

- v0.9.0 answered the sign-in state with the app-server's `account/read`. That call can block on workspace routing discovery, so on a host with a slow or proxied connection to ChatGPT the status request hung and reported an unsigned account even though a valid credential was present.
- The status is now read from the Codex credential store the bridge writes itself. It answers in milliseconds and matches what `codex login status` reports. Measured on the release host: `GET /api/login/status` returned `{"signedIn":true,"accountType":"chatgpt"}` in 13 ms, against a call that previously timed out.
- Signing out also closes a sign-in that was still open, so the sign-in entry stays available after a logout.

## Verification / 验证结果

| Check | Result |
| --- | --- |
| `bun run test:unit` | Passed: 231 tests across 33 files, 0 failed |
| `bun run check` | Passed: server, development entry and browser bundle compile |
| `bun test tests/account-login.integration.test.ts` | Passed: 6 tests, 0 failed — against a mock app-server: the device code and verification page reach the browser, the pending sign-in is cleared when Codex reports completion, the account becomes signed in and signed out again, the browser RPC surface stays narrow (`account/read`, `account/usage/read`, `config/read` are rejected), and a browser-chosen login type is ignored |
| `bun test tests/account-login-ui.test.ts` | Passed: 4 tests, 0 failed — the dialog, the profile entry, the client calls and the translations exist |
| `bun test tests/server-security.test.ts` | Passed: the browser RPC allowlist covers the sign-in methods and still rejects account reads |
| `bun test tests/custom-provider.integration.test.ts` | Passed: 14 tests, 0 failed — no regression in the provider flows |
| `bun test tests/global-provider.integration.test.ts` | Passed: 3 tests, 0 failed |
| Live `account/login/start` against the real Codex `0.164.0-alpha.12` and `auth.openai.com` | Passed: returned a device code and `https://auth.openai.com/codex/device`; `/api/login/status` then reported the pending sign-in; `account/login/cancel` reached the app-server |
| `git diff --check` | Passed |

### Verification limits / 验证边界

- **The browser end-to-end suites did not run on this machine.** Chromium fails to launch with `libatk-1.0.so.0: cannot open shared object file`, and the machine has no passwordless `sudo` to install the missing system library. The dialog was therefore verified through its DOM structure, its client calls and the mock app-server, not through a rendered browser.
- **No sign-in was completed.** Completing the device-code flow requires entering the code on the ChatGPT page by hand. The credential write, the account switch and the bridge restart after a successful sign-in are therefore implemented from the documented protocol but were not exercised end to end; the mock app-server covers the notification, the pending-state cleanup and the restart.
- The credential store of the host was never touched during the verification: the live probe ran against an isolated `CODEX_HOME` with a copy of the credentials.
- `tests/app-server.integration.test.ts` has two failing cases in this environment, and both fail identically on the unmodified `v0.7.1` tree; they are unrelated to this release.

## Scope and upgrade notes / 范围与升级说明

- This release adds the ChatGPT sign-in flow. The provider routing, the model picker, the authentication model of the WebUI itself, the working-directory behaviour, the conversation retry action and the inline image attachments are unchanged.
- Update the source and dependencies, then restart the WebUI so the new sign-in entry is served, and reload the browser. Finish active Codex turns before restarting the service.
- Publishing a Git tag or Release does not restart a running service, and no conversation, project or provider data is migrated or rewritten.
- Local screenshots, credentials, generated bundles and browser runtime libraries are excluded from the release commit.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
