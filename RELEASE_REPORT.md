# Codex PiWeb UI v0.5.1 — Release Report

- **Version:** `0.5.1`
- **Date:** 2026-10-17
- **Base release:** `v0.5.0`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.5.1`. Previous release tags are not moved or overwritten.

## Highlights / 本次更新

### Workspace browsing — 工作区文件浏览

- The left Files sidebar now requests and displays hidden workspace files and folders, including `.env` and `.gitignore`.
- Added browser coverage for hidden file entries while keeping `.git` excluded by the existing repository safety rule.

### Runtime quota interaction — 额度详情交互

- The quota details popover closes on the next click anywhere on the page, including clicking its original summary position.

### Skill bundle permissions — 技能包权限

- Curated skill installations preserve executable bits under the server's restrictive `umask` without widening other file permissions.

### Skills management — 官方与个人技能管理

A DSH-inspired Skills icon sits beside Chats / Files. It is also accessible through **Settings → General → Manage skills**.

- **Official:** Inspect system skills, enable/disable them through Codex, and install complete curated bundles from the existing local `openai/skills` cache. Installed curated skills remain in the Official group while their contents match that cache.
- **Personal:** Create, edit and delete personal bundles directly under `$CODEX_HOME/skills/<id>/SKILL.md`. System, project, admin and external skill source files are read-only.
- **Concise controls:** Installed skill cards show only the enable/disable switch; the adjacent Use text button was removed. Use in prompt remains available in the inspector.
- **Native invocation:** `/<skill-name>` and `$<skill-name>` autocomplete attach a skill chip. Messages use Codex's native `{ type: "skill", name, path }` input, including skill-only submissions. Drafts preserve selections per conversation.
- **Explicit extra directories:** `CODEX_WEBUI_SKILL_EXTRA_ROOTS` accepts comma-separated directories. Pi/DSH directories are not imported automatically; explicitly mounted source files remain read-only.
- **Truthful state:** Discovery and enablement come from `skills/list` / `skills/config/write`. Invalid YAML and catalog failures are reported, not replaced with fabricated enabled entries.

### Header fix — iPad 分屏长标题修复

Long Chinese titles, attachment filenames and unbroken text now remain on a single ellipsized line within the 46px header. The project path has a bounded width; sidebar and conversation-action buttons remain accessible. The regression test covers 36 combinations across 320–1280px widths and sidebar states.

### Safety and reliability

- Personal writes use strict skill IDs, validated YAML frontmatter, exclusive temporary files and atomic replacement. Metadata changes preserve optional fields and instruction text.
- Linux directory-descriptor anchoring prevents parent-path symlink swaps from redirecting Skills file mutations. Directory identity is checked before recursive deletion; unsafe links and special files are rejected.
- Curated installation is offline and does not execute scripts. It preserves raw binary assets and safe executable bits, enforces file/byte limits, and refuses existing destinations.
- Native enablement writes require exact catalog membership and a safe Codex configuration destination, rechecked after asynchronous discovery. Protected `~/.pi` destinations are rejected.
- The inspector stays in sync after disable/re-enable and returns focus to the composer when a tablet-width overlay's Use action is selected.
- The Markdown browser-smoke fixture is isolated from asynchronous conversation hydration, avoiding a test-only race during workspace changes.

## Verification / 验证结果

The following checks were executed for this release:

| Check | Result |
| --- | --- |
| `bun run test:unit` | **149 passed, 0 failed**, across 25 files |
| `bun run check` | Passed: server, development entry and browser bundle compile |
| `bun run build` | Passed: browser bundle and `dist/server.js` generated |
| `bun run test:browser` | Not run: the current environment has no Playwright Chromium executable |
| Version consistency | `package.json`, app-server client info and `/api/health` use `0.5.1` |
| `git diff --check` | Passed |

The Skills E2E suite uses a disposable `HOME` / `CODEX_HOME` and the real local Codex skills discovery/configuration APIs. Only conversation/model responses are mocked; no paid model inference is performed. It covers create/edit/delete, persistent enablement, read-only external skills, offline curated installation, native skill input, and tablet focus restoration. Unit fixtures cover invalid YAML, symlinks, hard links, directory replacement, binary resources and executable permissions.

**Not verified in this release run:** browser E2E because the Playwright Chromium executable is unavailable, authenticated real-model inference (`test:integration`), Apple Safari/WebKit execution, and Skills file mutations on non-Linux systems. Browser checks do not constitute native iPad Safari certification.

## Upgrade notes / 升级注意事项

- Standard installation remains `bun install` followed by `bun run start`; `bun run build` is available for bundled deployment.
- Stop or finish active turns before restarting a managed WebUI service: it owns the `codex app-server --stdio` child, so restarting it can interrupt turns.
- No existing skill is installed, deleted or imported merely by opening the manager. Extra roots must be selected explicitly through the environment.
- Skills file mutations currently require Linux `/proc/self/fd` descriptor support. Unsupported platforms refuse mutation rather than fall back to unsafe pathname operations.
- The curated catalog requires an already populated Codex local cache and its metadata; this release does not download missing catalogs. A local OpenAI origin hint is **not** a cryptographic signature or security audit. Inspect instructions/scripts before use.
- This remains a trusted single-user developer tool, not a multi-tenant sandbox or public Internet service.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). The MIT base-project notices remain preserved.
