# Codex PiWeb UI v0.7.0 — Release Notes

- **Version:** `0.7.0`
- **Date:** 2026-10-20
- **Base release:** `v0.6.1`
- **Repository:** https://github.com/Shinyruooooo/codex-webui
- **Stable branch:** `main`; ongoing development remains on `dev`.
- **Release tag:** `v0.7.0`

## Highlights / 本次更新

### Message retry — 失败消息就地重试

- A failed conversation bubble now carries a compact refresh control next to the bubble. Clicking it resends that message only, reusing its original text and image attachments, instead of replaying the whole conversation.
- The control is a small icon rather than a labelled row, so it no longer wraps or competes with the message. The failure reason stays available as a hover tooltip, and the control is disabled while a response is running or a submission is in flight.
- Retry covers both a turn that Codex reports as failed and a send that never reached Codex. The failed bubble is kept in place so the retry target stays visible; retrying a bubble whose send never landed replaces it with a fresh one.
- The working directory of a failed turn is not silently reused for unrelated work: the retry resends the original payload, including any images that were attached to it.

### Inline conversation images — 对话图片不再落盘

- Images pasted, dropped or attached in the composer are now kept inside the message as inline data, matching Pi Web, instead of being written into the project directory.
- The Codex app-server protocol accepts an inline image reference, which was verified against the locally installed `codex-cli 0.163.0` before the change; `localImage` paths remain supported for previously stored threads and for project file uploads.
- Large screenshots are downscaled in the browser before sending (longest edge 1024 px, JPEG quality 0.85, GIFs left untouched), and at most 10 images can be attached to one message.
- Image bytes are deliberately excluded from the per-session draft store, so a draft is not silently inflated by a multi-megabyte data URL. Attachments are previewed as thumbnails in the composer and rendered inline in the message bubble.
- The **Files** panel upload still writes into the working directory; only conversation attachments changed.

### Working directory as an explicit choice — 工作目录显式可选

- Opening a history thread no longer changes the project directory used for new tasks. Previously, viewing any thread rewrote the sidebar project and the next new task silently ran in that thread's directory.
- Switching the working directory no longer discards the open conversation or its draft. The picker now only changes the directory, and reports whether the change applies to the current task or to new tasks.
- The directory is a single source of truth: the display text is no longer parsed back into a path for the composer, file panel, terminal, permission profiles, draft keys or the Codex request.
- The directory is addressable: `?cwd=` restores it on load, and switching directories keeps the URL in sync, so a link or a second tab can point at a specific project.
- The New chat button shows the directory a new task will run in, and the empty state displays the current directory with a shortcut to change it.
- `GET /api/cwd/validate` validates a candidate directory against the same allowed roots used for browsing and for Codex requests.

### Smaller message controls — 消息控件收紧

- The message and code copy buttons were reduced to a 12 px glyph in a 20 px hit area, and the code-block toolbar to a 22 px strip, so message controls no longer outweigh the message itself.

## Verification / 验证结果

| Check | Result |
| --- | --- |
| `bun run check` | Passed: server, development entry and browser bundle compile |
| `bun run build` | Passed: generated browser bundle and `dist/server.js` |
| `git diff --check` | Passed |
| `bun run test:unit` | Passed: 223 tests across 32 files, 0 failed |
| Inline image protocol probe | Passed: `codex app-server` accepted `{"type":"image","url":"data:image/png;base64,…"}` and started a turn; `imageUrl` was rejected by the schema |
| `GET /api/cwd/validate` | Passed against a live server: valid directory accepted, non-existent and out-of-root paths rejected |
| Bundled frontend inspection | Passed: the rebuilt bundle contains the new working-directory, retry and inline-image logic, and the previous directory-switch/new-task coupling is gone |
| Release metadata/workflow validation | Passed: the version guard for `v0.7.0` and the release notes format |

### Verification limits / 验证边界

- **The browser end-to-end suites were not run for this release.** This machine lacks the Chromium shared libraries (`libatk-1.0.so.0` and others) and has no passwordless `sudo`, so Playwright cannot launch. The affected assertions in `tests/workspace-files-and-actions.e2e.mjs` were rewritten for the new semantics — switching the directory keeps the open draft, the destination project's draft is not overwritten, and the URL matches the directory — but they were **not executed in a browser**. Please run `bun run test:browser` and `bun run test:e2e` on a machine with the browser dependencies before relying on them.
- The retry and inline-image behaviour was verified at the unit level and against the real `codex app-server` protocol, not through a full browser session.
- Inline image bytes are not persisted across a page reload; a draft keeps its text and file references, but an unsent inline image has to be re-attached. This matches Pi Web's behaviour for pasted images.
- The working directory of a thread is owned by Codex and is not rewritten by this release; only the directory used for **new** tasks is affected.

## Upgrade notes / 升级注意事项

- Update source/dependencies as usual and use `bun run start`, or generate bundled files with `bun run build`.
- Publishing branches, a tag or a Release does not itself restart a managed service. Finish active Codex turns before restarting it; finish or detach terminal programs before reloading the browser or reconnecting a terminal.
- Existing conversations, project files and provider stores are not migrated or rewritten by this patch. The stored project selection stays in browser-local storage and is now mirrored into the `?cwd=` URL parameter.
- The `?cwd=` parameter is validated against the allowed browse roots; an unknown or out-of-root path falls back to the stored selection instead of failing the load.
- Local credentials, the uploaded screenshot, logs, browser runtime libraries and generated bundles are excluded from the Git release commit.

See [CHANGELOG.md](./CHANGELOG.md), [README.md](./README.md), [README-zh.md](./README-zh.md), [CONTRIBUTING.md](./CONTRIBUTING.md) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
