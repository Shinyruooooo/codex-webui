# Codex PiWeb UI

[简体中文](./README-zh.md)

A browser workspace for Codex CLI, with conversations, project files, a terminal, and Skills in one place. It connects to the local `codex app-server` and can be used locally or on a trusted LAN.

## Features

- Three-column workspace with conversations, a file tree, and an on-demand preview / terminal / diff panel.
- Streaming responses, tool activity, command and file-change approvals, and model / reasoning-effort selection.
- Session rename, drafts, context compaction, Markdown / JSON export, and running / unread-completion indicators.
- File previews, uploads, drag-and-drop attachments, and `@` file references.
- Official / Personal Skills, enable switches, personal skill editing, and `/skill-name` or `$skill-name` selection.
- Elapsed time, token and context usage, and account quota when reported by Codex.
- English / Chinese UI, system / light / dark themes, responsive layouts, and password-protected LAN access.

## Install

Requirements: [Bun](https://bun.sh/) 1.3+, Node.js 20+, Git, and an authenticated Codex CLI. Linux is recommended; Windows has not been fully tested. Tested with Codex CLI `0.162.1`.

Install and sign in to Codex if needed:

```bash
npm install -g @openai/codex
codex login
```

Install and start the WebUI:

```bash
git clone https://github.com/Shinyruooooo/codex-webui.git
cd codex-webui
bun install
bun run start
```

Open **http://127.0.0.1:8899**. No separate frontend build is needed for this command.

## Use

1. Select a project folder and create or open a conversation.
2. Choose a model and reasoning effort, then send a message. Review approval requests before allowing commands or file changes.
3. Use Files to preview or upload files; type `@` to reference a file in your message.
4. Use Skills to enable or inspect a skill; select it from `/` or `$` autocomplete to attach it to a message.
5. Open the terminal or diff panel when needed. Conversation actions include rename, export, and context compaction.

Personal skill editing/deletion currently requires Linux. Curated Skills installation uses an existing local Codex cache; it does not download a catalog. External skill sources are read-only.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8899` | Listen port |
| `CODEX_WEBUI_CWD` | Repository directory | Initial project directory |
| `CODEX_WEBUI_REVIEW_ROOT` | Initial project directory | Git root allowed for diff Undo/Reapply |
| `CODEX_WEBUI_PASSWORD` | Unset | LAN browser login password |

For example, change the port with `PORT=9000 bun run start`. More options are listed in [.env.example](./.env.example); replace example paths before using them.

### LAN access

```bash
HOST=0.0.0.0 CODEX_WEBUI_PASSWORD='replace-with-a-long-random-password' bun run start
```

Open `http://<server-ip>:8899` and enter the password. Direct localhost access bypasses the login screen. Use a trusted network only; do not expose this service directly to the public Internet.

Finish active conversations before restarting the service: restarting its app-server can interrupt running turns.

For development, use `bun run dev`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for tests and contribution guidelines, and [SECURITY.md](./SECURITY.md) for security information.

## Acknowledgments

- [lezi-fun/codex-webui](https://github.com/lezi-fun/codex-webui): the upstream codebase on which this project is built.
- [agegr/pi-web](https://github.com/agegr/pi-web): workspace layout and interaction inspiration.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): Skills interface inspiration.

## License

Source code is licensed under [MIT](./LICENSE), with the upstream copyright notice preserved. Third-party components and visual assets retain their own licenses and rights; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

This is an independent community project, not an official OpenAI product.
