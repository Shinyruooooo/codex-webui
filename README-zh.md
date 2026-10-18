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
2. 选择模型与推理强度后发送消息；执行命令或修改文件前，认真确认审批内容。可在设置中接入兼容 Responses 协议的第三方模型提供商（如智谱 GLM、DeepSeek）。
3. 在文件页预览、上传文件，或在输入框输入 `@` 引用文件。
4. 在 Skills 页查看和启用技能，通过 `/` 或 `$` 补全选择要调用的技能。
5. 按需打开终端或 Diff 面板；会话操作菜单可重命名、导出或压缩上下文。
6. 拖动右侧栏的左边界调整宽度，浏览器会记住设置；双击边界恢复默认。也可聚焦分隔条后用左右方向键调整，按住 Shift 可加大步长。
7. 终端顶部显示连接状态。若持续空白，点 **ⓘ 终端诊断**并复制连接/显示信息；其中不包含命令、输出或凭据。**重新连接终端**会先询问确认，因为它会结束该终端会话及关联程序，但不会重启 WebUI 的 Codex 服务。

个人技能编辑、删除目前需要 Linux。精选技能安装依赖本机已有的 Codex 缓存，不会联网下载目录；外部技能源文件只读。

### 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8899` | 监听端口 |
| `CODEX_WEBUI_CWD` | 仓库目录 | 初始项目目录 |
| `CODEX_WEBUI_REVIEW_ROOT` | 初始项目目录 | 允许 Diff 撤销 / 重做的 Git 根目录 |
| `CODEX_WEBUI_PASSWORD` | 未设置 | 局域网浏览器登录密码 |
| `CODEX_WEBUI_MODELS_JSON` | `$CODEX_HOME/codex-webui-models.json` | 自定义模型提供商配置文件 |

例如，使用 `PORT=9000 bun run start` 修改端口。更多配置见 [.env.example](./.env.example)，使用前请将示例路径改为实际路径。

### 自定义模型提供商

Codex 只能接入实现了 OpenAI **Responses API** 的端点（`wire_api = "responses"`，仅支持 Chat Completions 的网关不可用）。智谱 GLM Coding Plan（`https://api.z.ai/api/v1` 或 `https://open.bigmodel.cn/api/v1`）、DeepSeek（`https://api.deepseek.com`）等均可直接接入。

在 **设置 → 模型提供商（Model providers）** 中管理（也可直接编辑下述 JSON 文件后重启服务）：

1. 点击服务商小卡片（或**添加提供商**），填写 API 密钥即可。已内置**智谱 GLM Coding Plan（国内）**、**Z.AI Coding Plan（国际）**和 **DeepSeek**，自动填写端点和模型。卡片显示已配置及开启状态；**自定义端点**保留手动配置。
2. 如需修改，展开**高级配置**可编辑 ID、显示名、Base URL 与模型。选择**自定义端点**仍可使用原来的手动配置。模型每行一个：`id`、`id | 显示名` 或 `id | 显示名 | low,medium,high`。
3. 保存后 Codex 桥接自动重启（会打断正在进行的任务），自定义模型出现在模型菜单；新建对话自动绑定提供商。切换提供商需要新建对话。

GLM 请使用对应地区的 **Coding Plan 套餐密钥**，不是标准 API 密钥。国内和国际预设更新同一个 `zai` 提供商，请选择与密钥对应的地区；更改端点时必须重新填入密钥，避免旧密钥发往不同服务。DeepSeek 默认模型为 `deepseek-flash`。预设依据厂商 Codex 文档维护，不会导入 Pi 的 Chat/Anthropic 专用端点或任何密钥。保存只做配置校验，不代表真实账户鉴权或计费模型调用已经通过。

**模型开关与刷新**

- 服务商开关批量开启/关闭整组模型；展开**模型**可单独控制。开关持久化保存，关闭的模型从选择器中移除，WebUI 桥接也会阻止其新调用；密钥仍保留，不打断正在运行的任务，也不修改 Pi 或单独运行的 Codex CLI 配置。
- **刷新模型**用已存密钥查询该端点的 `/models` 目录；**刷新模型目录**按顺序刷新全部已配置服务商。保留现有元数据和开关选择，不删除手工模型，新增发现默认**关闭**，请确认 Responses 兼容性后开启。`/models` 列表本身并不能证明支持 Responses 或工具调用。
- 匹配预设的端点若返回 404/405/501，界面会明确标记使用**内置目录**回退；鉴权、网络等错误保留原配置。请求限制为 10 秒和 512 KiB，拒绝跟随重定向，避免密钥转发到其他端点。每个服务商最多保存 50 个模型。
- 开关、目录刷新不重启桥接；新增/删除连接或修改端点、密钥、服务商名称时才重启。旧配置未写 `enabled` 时默认开启。若编辑期间配置已更新，保存旧快照会返回 409，请重新打开编辑器，避免覆盖新的模型目录或开关；与 Codex 内置模型重名的自定义 ID 会被拒绝或跳过，不劫持内置模型路由。

配置文件默认为 `$CODEX_HOME/codex-webui-models.json`（权限 0600），可用 `CODEX_WEBUI_MODELS_JSON` 覆盖路径。API 密钥仅通过环境变量注入 app-server，不会写入 `config.toml`；密钥也可写成 `$VAR` 引用环境变量。示例：

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
