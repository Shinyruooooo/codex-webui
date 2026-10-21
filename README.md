# Codex PiWeb UI

[简体中文](./README-zh.md)

A browser workspace for Codex CLI, with conversations, project files, and Skills in one place. It connects to the local `codex app-server` and can be used locally or on a trusted LAN.

## Features

- Three-column workspace with conversations, a file tree, and an on-demand preview / diff panel.
- Codex runs the commands itself and reports them as command activity in the conversation; the WebUI does not embed a shell of its own.
- Streaming responses, tool activity, command and file-change approvals, model / reasoning-effort selection, and custom Responses-compatible model providers.
- Session rename, drafts, context compaction, Markdown / JSON export, and running / unread-completion indicators.
- File previews, uploads, drag-and-drop attachments, and `@` file references.
- Official / Personal Skills, enable switches, personal skill editing, and `/skill-name` or `$skill-name` selection.
- Elapsed time, token and context usage, and account quota when reported by Codex.
- English / Chinese UI, system / light / dark themes, responsive layouts, and password-protected LAN access.

## Install

Requirements: [Bun](https://bun.sh/) 1.3+, Git, and an authenticated Codex CLI. Linux is recommended; Windows has not been fully tested. Tested with Codex CLI `0.162.1`.

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
3. Use Files to preview or upload files; type `@` to reference a file in your message. Images pasted or attached in the composer stay in the message and are not written into the project folder.
4. The working directory is shown above the composer and in the New chat tooltip; change it from the empty state, the **Projects** button, or a `?cwd=` URL.
5. Use Skills to enable or inspect a skill; select it from `/` or `$` autocomplete to attach it to a message.
6. Open the diff panel when needed. Conversation actions include rename, export, and context compaction.
7. Drag the right panel's left edge to change its width; the browser remembers it. Double-click the divider to reset, or focus it and use Left/Right arrow keys (Shift for larger steps).
8. Hover over a user or assistant message to copy its source text/Markdown (controls remain visible on touch devices). Each code block has a top-right copy button for code only, without Markdown fences. Indentation and line breaks are preserved; nothing is executed. If the browser blocks both clipboard methods, select the text and copy manually.

Commands are executed by Codex itself. Use the approval mode in the composer to control when a command or a file change needs your confirmation; the WebUI does not provide a built-in shell.

Personal skill editing/deletion currently requires Linux. Curated Skills installation uses an existing local Codex cache; it does not download a catalog. External skill sources are read-only.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8899` | Listen port |
| `CODEX_WEBUI_CWD` | Repository directory | Initial project directory |
| `CODEX_WEBUI_REVIEW_ROOT` | Initial project directory | Git root allowed for diff Undo/Reapply |
| `CODEX_WEBUI_PASSWORD` | Unset | LAN browser login password |
| `CODEX_WEBUI_MODELS_JSON` | `$CODEX_HOME/codex-webui-models.json` | Custom model provider store |

For example, change the port with `PORT=9000 bun run start`. More options are listed in [.env.example](./.env.example); replace example paths before using them.

### Custom model providers

Codex only talks to endpoints that implement the OpenAI **Responses API** (`wire_api = "responses"`; Chat Completions-only gateways are not supported). Providers such as the Z.AI GLM Coding Plan (`https://api.z.ai/api/v1` or `https://open.bigmodel.cn/api/v1`) and DeepSeek (`https://api.deepseek.com`) work directly.

Manage providers under **Settings → Model providers** (or edit the JSON store below and restart the service):

1. Click a provider card (or **Add provider**) and enter its API key. The endpoint and model are prefilled: **GLM Coding Plan (China)**, **Z.AI Coding Plan (International)**, or **DeepSeek**. Cards show configured/enabled status; **Custom endpoint** keeps the manual setup.
2. Optional: expand **Advanced configuration** to edit the prefilled ID, name, URL and model list. **Custom endpoint** keeps the original manual form. Models use one line each: `id`, `id | Display name`, or `id | Display name | low,medium,high`.
3. Save. The Codex bridge restarts (interrupting running turns), custom models appear in the model picker, and new chats send `modelProvider` automatically. Switching provider requires a new chat.

The GLM presets use their region-specific **Coding Plan** keys, not standard model API keys. Both regions intentionally update one `zai` provider; choose the region matching your key. Changing an endpoint requires a new key to avoid sending an old credential to a different service. DeepSeek defaults to `deepseek-flash`. Presets are a local, vendor-documented catalog, not an import of Pi's Chat/Anthropic-only providers or credentials. Provider setup saves the configuration; it does not validate a paid account or make a live inference request.

**Model switches and refresh**

- Provider switches enable/disable the whole model group; expand **Models** to control individual models. These settings are persisted, remove disabled models from the picker, and block new inference through the WebUI bridge. They keep credentials and do not interrupt running turns or alter Pi / standalone Codex CLI settings.
- **Refresh models** fetches the configured endpoint's `/models` directory with its stored key; **Refresh model catalogs** refreshes configured providers sequentially. Existing metadata and choices are preserved, manual models are not deleted, and new discoveries default to **off** until you confirm Responses compatibility. A `/models` listing alone does not prove tool-use/Responses support.
- For matching presets whose endpoint returns 404/405/501 for discovery, the UI explicitly reports a **built-in catalog** fallback. Authentication/network errors keep the previous configuration unchanged. Requests are bounded to 10 seconds and 512 KiB; redirects are rejected so the key cannot follow another endpoint. Each provider stores up to 50 models.
- Refresh and switches do not restart the bridge. Adding/removing a connection or changing its URL, key or provider name does. Old stores without `enabled` fields remain enabled by default. If settings changed while an editor was open, saving the old snapshot returns 409; reopen it to avoid overwriting fresh models or switches. Custom IDs that collide with built-in Codex models are rejected/skipped rather than changing native model routing.

The store defaults to `$CODEX_HOME/codex-webui-models.json` (mode 0600); override the path with `CODEX_WEBUI_MODELS_JSON`. API keys are injected into the app-server through environment variables and never written to `config.toml`. A key may reference an environment variable as `$VAR` instead of a literal. Example:

```json
{
  "version": 1,
  "providers": [
    {
      "id": "zai",
      "name": "Z.AI GLM",
      "baseUrl": "https://api.z.ai/api/v1",
      "apiKey": "$ZAI_API_KEY",
      "models": [{ "id": "glm-5.3", "displayName": "GLM-5.3", "efforts": ["low", "medium", "high"] }]
    }
  ]
}
```

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
