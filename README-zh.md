# Codex PiWeb UI

[English](./README.md)

面向 Codex CLI 的浏览器工作台，将对话、项目文件、终端和 Skills 放在同一个界面中。连接本机 `codex app-server`，支持本地和可信局域网使用。

## 功能

- 三栏工作台：会话列表、项目文件树，以及按需打开的预览、终端和 Diff 面板。
- 流式回答、工具活动、命令与文件修改审批，支持选择模型和推理强度。
- 会话重命名、草稿保存、上下文压缩、Markdown / JSON 导出及运行中、未读完成状态。
- 文件预览、上传、拖拽附件和 `@` 文件引用。
- 官方 / 个人 Skills 管理、启用开关、个人技能编辑，支持 `/技能名` 或 `$技能名` 选择调用。
- 展示耗时，以及 Codex 返回的 Token、上下文使用量和账号额度。
- 中英文界面、跟随系统 / 浅色 / 深色主题、自适应布局及局域网密码登录。

## 安装

需要 [Bun](https://bun.sh/) 1.3+、Node.js 20+、Git，以及已登录的 Codex CLI。推荐 Linux；Windows 尚未完整测试。当前验证的 Codex CLI 版本为 `0.162.1`。

如果尚未安装和登录 Codex：

```bash
npm install -g @openai/codex
codex login
```

安装并启动 WebUI：

```bash
git clone https://github.com/Shinyruooooo/codex-webui.git
cd codex-webui
bun install
bun run start
```

打开 **http://127.0.0.1:8899**。此启动方式会自动构建前端，无需单独打包。

## 使用

1. 选择项目文件夹，新建或打开会话。
2. 选择模型与推理强度后发送消息；执行命令或修改文件前，认真确认审批内容。
3. 在文件页预览、上传文件，或在输入框输入 `@` 引用文件。
4. 在 Skills 页查看和启用技能，通过 `/` 或 `$` 补全选择要调用的技能。
5. 按需打开终端或 Diff 面板；会话操作菜单可重命名、导出或压缩上下文。

个人技能编辑、删除目前需要 Linux。精选技能安装依赖本机已有的 Codex 缓存，不会联网下载目录；外部技能源文件只读。

### 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8899` | 监听端口 |
| `CODEX_WEBUI_CWD` | 仓库目录 | 初始项目目录 |
| `CODEX_WEBUI_REVIEW_ROOT` | 初始项目目录 | 允许 Diff 撤销 / 重做的 Git 根目录 |
| `CODEX_WEBUI_PASSWORD` | 未设置 | 局域网浏览器登录密码 |

例如，使用 `PORT=9000 bun run start` 修改端口。更多配置见 [.env.example](./.env.example)，使用前请将示例路径改为实际路径。

### 局域网访问

```bash
HOST=0.0.0.0 CODEX_WEBUI_PASSWORD='replace-with-a-long-random-password' bun run start
```

通过 `http://<服务器IP>:8899` 访问并输入密码。本机 localhost 访问不显示登录页。仅在可信网络中使用，不要直接暴露到公网。

重启服务前请先结束正在运行的会话，避免中断其 app-server 任务。

开发模式使用 `bun run dev`。测试与贡献说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全说明见 [SECURITY.md](./SECURITY.md)。

## 致谢

- [lezi-fun/codex-webui](https://github.com/lezi-fun/codex-webui)：本项目基于其代码继续开发。
- [agegr/pi-web](https://github.com/agegr/pi-web)：工作台布局与交互参考。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：Skills 界面设计参考。

## 许可证

项目源码采用 [MIT License](./LICENSE)，保留上游版权声明。第三方组件及视觉资源保留各自的许可证与权利，详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

本项目由社区独立维护，并非 OpenAI 官方产品。
