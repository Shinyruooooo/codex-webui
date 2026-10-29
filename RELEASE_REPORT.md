# Codex PiWeb UI v0.9.0 — Release Notes

- **Version:** `0.9.0`
- **Date:** 2026-10-29
- **Base release:** `v0.8.0`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.9.0`

## Highlights / 本次更新

### Sign in with ChatGPT from the WebUI — 在 WebUI 内登录 ChatGPT

- The Codex bridge can start a ChatGPT **device-code sign-in**, so a CLI sign-in is no longer a prerequisite. **Settings → Profile → Log in with ChatGPT** shows a one-time code and the verification page, and reports the result when Codex completes the sign-in.
- The device-code flow was chosen deliberately: the browser OAuth flow of the app-server binds its callback to `http://127.0.0.1:1455/auth/callback`, which cannot work for a WebUI that is reached from another machine. The device code completes on the server side and therefore works on a headless host and from any browser.
- The sign-in writes the same credential store as `codex login`, so the CLI picks up the same account afterwards. The bridge is restarted once the sign-in succeeds, so the new credentials are used immediately; running turns are interrupted, as with a provider change.
- **Only the device-code flow is reachable from the browser.** The server pins the login type, an API key or token never travels through the browser RPC surface, and the code plus the verification page are the only values the browser receives. `account/read` and `account/usage/read` stay unavailable to browser clients.
- Signing in replaces the account this service uses. The WebUI password remains the access boundary for that account; the account identity itself is still served on localhost only.

## Verification / 验证结果

| Check | Result |
| --- | --- |
| `bun run test:unit` | Passed: 231 tests across 33 files, 0 failed |
| `bun run check` | Passed: server, development entry and browser bundle compile |
| `bun test tests/account-login.integration.test.ts` | Passed: 5 tests, 0 failed — against a mock app-server: the device code and verification page reach the browser, the pending sign-in is cleared when Codex reports completion, the account becomes signed in, the browser RPC surface stays narrow (`account/read`, `account/usage/read`, `config/read` are rejected), and a browser-chosen login type is ignored |
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
