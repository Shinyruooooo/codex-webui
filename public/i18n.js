export const LOCALE_STORAGE_KEY = "codex-webui-locale";
export const LOCALE_PREFERENCES = Object.freeze(["system", "zh-CN", "en"]);

const ZH_CN = Object.create(null);

Object.assign(ZH_CN, {
  "Log in": "登录",
  "Log out": "退出登录",
  "Password": "密码",
  "Confirm password": "确认密码",
  "Set a LAN password": "设置局域网密码",
  "New password": "新密码",
  "Set password": "设置密码",
  "Setting password…": "正在设置密码…",
  "Logging in…": "正在登录…",
  "Password must be at least 12 characters": "密码至少需要 12 个字符",
  "Passwords do not match": "两次输入的密码不一致",
  "A password was already set. Log in to continue.": "密码已设置，请登录后继续。",
  "Unable to set the password": "无法设置密码",
  "Unable to log in": "无法登录",
  "Codex WebUI login": "Codex WebUI 登录",
  "Codex WebUI password setup": "Codex WebUI 密码设置",
  "New task": "新任务",
  "New chat": "新对话",
  "New tab": "新标签页",
  "Search": "搜索",
  "Search chats": "搜索对话",
  "Close search": "关闭搜索",
  "Projects": "项目",
  "Project": "项目",
  "New session in {path}": "将在 {path} 下新建会话",
  "Choose project": "选择项目目录",
  "Working in {path}": "工作目录：{path}",
  "Change": "更换",
  "Working directory changed to {path}": "工作目录已切换到 {path}",
  "New tasks will use {path}": "新任务将在 {path} 下运行",
  "Select a project folder to upload files.": "请先选择项目目录再上传文件。",
  "Tasks": "任务",
  "Connecting": "正在连接",
  "Connecting to Codex": "正在连接 Codex",
  "Connecting to Codex…": "正在连接 Codex…",
  "Codex connected": "Codex 已连接",
  "Settings": "设置",
  "Profile": "个人资料",
  "Usage": "用量",
  "Keyboard shortcuts": "键盘快捷键",
  "Help": "帮助",
  "Open profile menu": "打开个人资料菜单",
  "Open settings": "打开设置",
  "Toggle sidebar": "切换侧边栏",
  "Toggle bottom panel": "切换底部面板",
  "Toggle terminal panel": "切换终端面板",
  "Toggle summary": "切换摘要",
  "Toggle side panel": "切换右侧面板",
  "What can I help?": "我能帮你做些什么？",
  "Do anything": "交给 Codex 处理",
  "Task prompt": "任务输入",
  "Composer suggestions": "输入建议",
  "Attached context": "已附加的上下文",
  "Attach files and folders": "附加文件和文件夹",
  "Start dictation": "开始听写",
  "Send message": "发送消息",
  "Steer": "插入消息",
  "Stop": "停止",
  "Change permissions": "更改权限",
  "Ask for approval": "请求审批",
  "How should Codex actions be approved?": "Codex 的操作应如何审批？",
  "Context usage": "上下文用量",
  "Reasoning effort": "思考强度",
  "Loading models…": "正在加载模型…",
  "Retrying Codex connection…": "正在重试连接 Codex…",
  "None": "无",
  "Minimal": "最低",
  "Low": "低",
  "Medium": "中",
  "High": "高",
  "Extra High": "极高",
  "Max": "最大",
  "Ultra": "超高",
  "Review": "审阅",
  "Terminal": "终端",
  "Browser": "浏览器",
  "Files": "文件",
  "Side task": "子任务",
  "Side tasks": "子任务",
  "Summary": "摘要",
  "Environment": "环境",
  "Scheduled": "计划任务",
  "Computer Use": "电脑操作",
  "Computer use": "电脑操作",
  "Plan": "计划",
  "Sources": "来源",
  "Local workspace": "本地工作区",
  "Remote workspace": "远程工作区",
  "No project": "无项目",
  "No changes yet": "暂无更改",
  "Changes made by Codex will appear here.": "Codex 所做的更改会显示在这里。",
  "Switch to split diff": "切换到并排差异",
  "Switch to unified diff": "切换到统一差异",
  "Toggle word wrap": "切换自动换行",
  "Enable word wrap": "启用自动换行",
  "Disable word wrap": "关闭自动换行",
  "Collapse all diffs": "折叠所有差异",
  "Expand all diffs": "展开所有差异",
  "Undo changes": "撤销更改",
  "Reapply changes": "重新应用更改",
  "Changes reverted": "更改已撤销",
  "Changes reapplied": "更改已重新应用",
  "This task is currently running in another Codex app or CLI. Close it there, then try again.": "此任务正在另一个 Codex 应用或 CLI 中运行。请先在那里关闭或结束任务，然后重试。",
  "This task could not be found. Refresh the task list and try again.": "找不到此任务。请刷新任务列表后重试。",
  "Delete thread": "删除任务",
  "Delete thread “{title}”": "删除任务“{title}”",
  "Delete “{title}”? This permanently deletes the thread and its descendants.": "删除“{title}”？这将永久删除此任务及其子任务。",
  "Thread deleted": "任务已删除",
  "Could not delete thread": "无法删除任务",
});

Object.assign(ZH_CN, {
  "General": "通用",
  "Appearance": "外观",
  "Configuration": "配置",
  "Personal": "个人",
  "Integrations": "集成",
  "Coding": "编程",
  "Archived": "已归档",
  "Archived chats": "已归档的对话",
  "Plugins": "插件",
  "Skills": "技能",
  "Connections": "连接",
  "Cloud preferences": "云端偏好设置",
  "Cloud environments": "云端环境",
  "Code review": "代码审阅",
  "Git": "Git",
  "Hooks": "钩子",
  "Worktrees": "工作树",
  "Back to app": "返回应用",
  "Back to settings": "返回设置",
  "Search settings": "搜索设置",
  "Search settings…": "搜索设置…",
  "Clear settings search": "清除设置搜索",
  "No results found": "未找到结果",
  "Permissions": "权限",
  "Auto-review": "代我审批",
  "Show “Approve for me” in the composer": "在输入框中显示“代我审批”",
  "Full access": "完全访问权限",
  "Show unrestricted access in the composer": "在输入框中显示不受限制的访问权限",
  "Selected mode": "所选模式",
  "Permission mode used for new turns": "新任务使用的权限模式",
  "Working folder used for new chats": "新对话使用的工作文件夹",
  "Notifications": "通知",
  "Task notifications": "任务通知",
  "Show a browser notification when a task completes": "任务完成时显示浏览器通知",
  "Task completed": "任务完成",
  "Browser notifications are blocked": "浏览器通知已被阻止",
  "Browser notifications are unavailable in this browser or connection": "当前浏览器或连接不支持系统通知",
  "Browser notifications are unavailable in this browser or connection (requires HTTPS or localhost)": "当前浏览器或连接不支持系统通知（需要 HTTPS 或本机 localhost 访问）",
  "Task notifications enabled": "已开启任务完成通知",
  "Task notifications disabled": "已关闭任务完成通知",
  "Running": "运行中",
  "Theme": "主题",
  "Colors used by the interface": "界面使用的配色",
  "Light": "浅色",
  "Dark": "深色",
  "System": "系统",
  "Language": "语言",
  "Interface language": "界面语言",
  "System default": "跟随系统",
  "Interface scale": "界面缩放",
  "Default": "默认",
  "Model": "模型",
  "Approval": "审批",
  "Web search": "网页搜索",
  "Automatic": "自动",
  "Installed plugins": "已安装的插件",
  "Plugin sources": "插件来源",
  "Installed skills": "已安装的技能",
  "Not configured": "未配置",
  "Browser access": "浏览器访问",
  "Network access": "网络访问",
  "Inherited from permissions": "继承自权限设置",
  "Connected services": "已连接的服务",
  "Diff view": "差异视图",
  "Unified": "统一",
  "Branch format": "分支格式",
  "Environments": "环境",
  "Review instructions": "审阅说明",
  "Git integration": "Git 集成",
  "Configured hooks": "已配置的钩子",
  "Worktree behavior": "工作树行为",
  "Turn on Full Access?": "启用完全访问权限？",
  "Codex will be able to run commands, use the internet, and create and edit files anywhere on this computer without your permission.": "Codex 无需再次获得许可，即可运行命令、使用互联网，并在这台电脑的任意位置创建和编辑文件。",
  "Files and folders": "文件和文件夹",
  "Read, create, modify, upload, or delete files anywhere on this computer": "读取、创建、修改、上传或删除这台电脑任意位置的文件",
  "Terminal commands": "终端命令",
  "Run commands, install software, and change system settings": "运行命令、安装软件和更改系统设置",
  "Internet and connected apps": "互联网和已连接的应用",
  "Access websites, send data, and use enabled plugins": "访问网站、发送数据并使用已启用的插件",
  "Cancel": "取消",
  "Close": "关闭",
  "Resize side panel": "调整右侧栏宽度",
  "Resize summary panel": "调整摘要栏宽度",
  "Drag to resize; double-click to reset": "拖动调整宽度，双击恢复默认",
  "Reconnect terminal": "重新连接终端",
  "Terminal diagnostics": "终端诊断",
  "Copy diagnostics": "复制诊断信息",
  "Copy message": "复制消息",
  "Retry message": "重试这条消息",
  "This message failed": "这条消息失败了",
  "Wait for the current response to finish.": "请等当前回复结束。",
  "Cannot retry this message": "无法重试这条消息",
  "You can attach up to {count} images": "最多只能附加 {count} 张图片",
  "Unsupported image type": "不支持的图片类型",
  "Failed to read image": "无法读取图片",
  "Copy code": "复制代码",
  "Copied": "已复制",
  "Copy failed. Select the text and copy it manually.": "复制失败，请选中文本后手动复制。",
  "Diagnostics copied": "诊断信息已复制",
  "Select and copy the diagnostics below": "请选中并复制下方诊断信息",
  "Only connection and rendering details; no commands, terminal output or credentials.": "仅包含连接与显示状态，不包含命令、终端输出或凭据。",
  "Terminal not connected": "终端未连接",
  "Connecting terminal…": "正在连接终端…",
  "Terminal connected": "终端已连接",
  "Connected; waiting for shell output": "已连接，等待终端输出",
  "Terminal disconnected": "终端连接已断开",
  "Terminal connection or display error": "终端连接或显示错误",
  "Reconnect this terminal? This ends the current terminal session and attached programs, but does not restart the WebUI Codex service.": "重新连接终端？这会结束当前终端会话及其关联程序，但不会重启 WebUI 的 Codex 服务。",

  "Model providers": "模型提供商",
  "Custom model providers": "自定义模型提供商",
  "Provider preset": "服务商预设",
  "Provider presets": "服务商预设",
  "Configured providers": "已配置的服务商",
  "Configure a Responses endpoint": "配置兼容 Responses 的端点",
  "Configured": "已配置",
  "Enabled": "已开启",
  "Disabled": "已关闭",
  "Partially enabled": "部分开启",
  "Enable all models": "开启全部模型",
  "Enable model": "开启模型",
  "Models enabled": "个模型已开启",
  "Refresh models": "刷新模型",
  "Refresh model catalogs": "刷新模型目录",
  "Choose a preset and enter your API key. Connection changes restart the bridge; model switches and refresh do not.": "选择预设并填写密钥即可。修改连接会重启桥接；模型开关和刷新不会。",
  "Switches control the model picker, not credentials. Turning models off keeps the keys and does not interrupt running turns.": "开关控制模型是否出现在选择器中，不删除密钥；关闭不会打断正在进行的任务。",
  "Model selection updated": "模型启用范围已更新",
  "Model catalog refreshed": "模型目录已刷新",
  "Model catalogs refreshed": "模型目录刷新完成",
  "Provider catalog refreshed": "已从服务商刷新目录",
  "Built-in catalog refreshed": "已刷新内置目录",
  "New models (disabled by default)": "个新增模型（默认关闭）",
  "Cannot update model catalog": "无法更新模型目录",
  "Provider model discovery requires a configured API key.": "刷新模型目录需要先配置 API 密钥。",
  "Provider model discovery request failed.": "服务商模型目录请求失败，原有模型配置保持不变。",
  "Provider returned an invalid or empty model catalog.": "服务商返回的模型目录无效或为空，原有配置保持不变。",
  "Provider model catalog exceeded the 512 KiB limit.": "服务商模型目录超过 512 KiB 安全上限，原有配置保持不变。",
  "Provider model discovery timed out.": "刷新服务商模型目录超时，原有配置保持不变。",
  "The provider does not expose a model catalog; using its built-in preset models.": "该端点未提供模型发现接口，已使用内置预设目录。",
  "The provider model limit is 50; additional discovered models were not added.": "每个服务商最多保存 50 个模型，超出的新模型未添加。",
  "The provider does not expose a model catalog; using its built-in preset models. The provider model limit is 50; additional discovered models were not added.": "该端点未提供模型发现接口，已使用内置预设目录；超过 50 个模型上限的部分未添加。",
  "Another provider update is in progress. Try again shortly.": "另一项服务商配置更新正在进行，请稍后再试。",
  "Provider configuration changed. Reopen the editor before saving.": "配置已发生变化，请重新打开编辑器后再保存，避免覆盖模型开关或刷新结果。",
  "Cannot verify the built-in model catalog. Try again shortly.": "暂时无法核对内置模型目录，请稍后重试。",
  "Custom model IDs must not conflict with built-in Codex models.": "自定义模型 ID 不能与 Codex 内置模型重名。",
  "Models conflicting with built-in Codex IDs were skipped.": "已跳过与 Codex 内置模型重名的条目。",
  "Cannot determine this chat's model before compaction.": "暂时无法确定此对话使用的模型，请重新打开对话后再压缩。",
  "This provider is disabled. Enable it in Model providers before starting a new turn.": "此服务商已关闭，请先在模型提供商设置中开启。",
  "This model is disabled. Enable it in Model providers before starting a new turn.": "此模型已关闭，请先在模型提供商设置中开启。",
  "Select a model before starting this turn.": "开始此轮对话前请先选择模型。",
  "Custom endpoint": "自定义端点",
  "Advanced configuration": "高级配置",
  "Provider documentation": "服务商文档",
  "Choose a preset and enter your API key. Endpoint and models are filled in automatically.": "选择服务商预设后，只需填写 API 密钥。端点和模型会自动配置。",
  "Configure your own Responses-compatible endpoint below.": "在下方配置自己的 Responses 兼容端点。",
  "Choose a preset and enter your API key. Saving restarts the Codex bridge and interrupts running turns.": "选择预设并填写 API 密钥即可。保存会重启 Codex 桥接，打断正在进行的任务。",
  "GLM Coding Plan (China)": "智谱 GLM Coding Plan（国内）",
  "Z.AI Coding Plan (International)": "Z.AI Coding Plan（国际）",
  "Use a BigModel Coding Plan key, not a standard model API key. China and international presets update the same GLM provider; choose the region matching your key.": "请使用智谱 Coding Plan 套餐密钥，而非标准 API 密钥。国内和国际预设更新同一个 GLM 提供商，请选择与密钥对应的地区。",
  "Use a Z.AI Coding Plan key for the international endpoint. China and international presets update the same GLM provider; choose the region matching your key.": "请使用 Z.AI Coding Plan 国际版密钥。国内和国际预设更新同一个 GLM 提供商，请选择与密钥对应的地区。",
  "Use a DeepSeek API key. The Responses endpoint and model are filled in automatically.": "填写 DeepSeek API 密钥即可，Responses 端点和模型会自动配置。",
  "An API key is required for this provider preset": "此服务商预设需要填写 API 密钥",
  "Enter a new API key when changing the provider endpoint": "更改服务商端点时，请重新填写对应的 API 密钥",
  "Unknown provider preset": "未知的服务商预设",
  "The model for this chat is no longer configured. Restore its provider or start a new chat.": "当前对话的模型已不在配置中。请恢复其提供商，或新建对话。",
  "Model lines have too many columns": "模型行的列数过多",
  "Responses-compatible APIs": "兼容 Responses 协议的 API",
  "Third-party endpoints that implement the OpenAI Responses API. Switching provider requires a new chat.": "实现了 OpenAI Responses 协议的第三方端点。切换提供商需要新建对话。",
  "Provider details": "提供商详情",
  "Provider ID": "提供商 ID",
  "Display name": "显示名称",
  "Base URL": "Base URL",
  "API key": "API 密钥",
  "Models": "模型",
  "one per line: id | display name | low,medium,high": "每行一个：id | 显示名 | low,medium,high",
  "Save provider": "保存提供商",
  "Add provider": "添加提供商",
  "Saved to the local provider store; the Codex bridge restarts to apply changes.": "保存到本地提供商配置；保存后 Codex 桥接会重启以生效。",
  "No custom providers": "暂无自定义提供商",
  "Add a Responses-compatible endpoint to use third-party models": "添加兼容 Responses 协议的端点以使用第三方模型",
  "API key missing": "缺少 API 密钥",
  "Unchanged": "保持不变",
  "Provider saved": "提供商已保存",
  "Provider saved · restarting Codex bridge…": "提供商已保存，正在重启 Codex 桥接…",
  "Provider deleted · restarting Codex bridge…": "提供商已删除，正在重启 Codex 桥接…",
  "Codex bridge did not reconnect": "Codex 桥接未能重新连接",
  "Delete provider?": "删除该提供商？",
  "Cannot load providers": "无法加载提供商",
  "Cannot save provider": "无法保存提供商",
  "Cannot delete provider": "无法删除提供商",
  "Model lines need an id": "模型行缺少模型 ID",
  "Add at least one model": "至少添加一个模型",
  "Switching provider requires a new chat": "切换提供商需要新建对话",
  "Confirm": "确认",
  "Ready": "就绪",
  "Preparing session…": "正在准备会话…",
  "Sending to Codex…": "正在发送给 Codex…",
  "Waiting for Codex…": "正在等待 Codex…",
  "Responding": "正在回复",
  "Stopping…": "正在停止…",
  "Still waiting for a Codex event…": "仍在等待 Codex 返回新进展…",
  "Tokens": "Token",
  "Context": "上下文",
  "Session usage": "会话累计用量",
  "Last reported usage": "最近一次上报用量",
  "Input tokens": "输入 Token",
  "Cached input tokens": "其中：缓存输入",
  "Output tokens": "输出 Token",
  "Reasoning output tokens": "其中：推理输出",
  "Total tokens": "合计 Token",
  "Waiting for Codex usage data": "等待 Codex 上报用量",
  "Cache is included in input; reasoning is included in output.": "缓存包含在输入中，推理包含在输出中，不重复相加。",
  "Usage updates when Codex reports it; no estimate is shown.": "仅在 Codex 上报时更新；未上报的数值显示为 —，不作估算。",
  "Conversation actions": "会话操作",
  "Rename": "重命名",
  "Rename conversation": "重命名会话",
  "Conversation renamed": "已重命名会话",
  "Could not rename conversation": "无法重命名会话",
  "Export Markdown": "导出 Markdown",
  "Export JSON": "导出 JSON",
  "Exported Markdown": "已导出 Markdown",
  "Exported JSON": "已导出 JSON",
  "Compact context": "压缩上下文",
  "Context compaction started": "已开始压缩上下文",
  "Could not compact context": "无法压缩上下文",
  "Refresh files": "刷新文件",
  "Upload files": "上传文件",
  "Switch project folder": "切换项目文件夹",
  "Select a project folder to browse files.": "选择一个项目文件夹后即可浏览文件。",
  "This folder is empty.": "当前文件夹为空。",
  "Mention in prompt": "引用到输入框",
  "Download": "下载",
  "Close preview": "关闭预览",
  "Binary file preview is not shown. Use Download to inspect it locally.": "二进制文件不显示文本预览，请点击下载在本地查看。",
  "Showing the first 256 KB.": "仅展示前 256 KB 内容。",
  "Upload failed": "上传失败",
  "Chats": "对话",
  "File preview": "文件预览",
  "No file selected": "未选择文件",
  "Browse files": "浏览文件",
  "Select a file from the left sidebar to preview it here.": "在左侧边栏选择文件即可在此预览。",
  "Open terminal": "打开终端",
  "Remaining quota": "剩余额度",
  "5h": "5小时",
  "Weekly": "周额度",
  "Quota": "额度",
  "left": "剩余",
  "used": "已用",
  "resets in": "重置剩余",
  "Reset credits": "免费重置次数",
  "1 match": "1 个匹配",
  "Browser navigation": "浏览器导航",
  "Go back": "后退",
  "Go forward": "前进",
  "Refresh page": "刷新页面",
  "Browser URL": "浏览器网址",
  "Enter URL": "输入网址",
  "Go to URL": "打开网址",
  "Open in new tab": "在新标签页打开",
  "Enter a URL to browse": "输入网址开始浏览",
  "Pages stay in their original site context. Some sites do not allow embedding.": "网页会保留原站点上下文，部分网站不允许嵌入显示。",
  "Loading page…": "正在加载页面…",
  "Page could not be embedded": "无法嵌入此页面",
  "Open externally": "在外部打开",
  "Embedded browser page": "嵌入式浏览器页面",
  "Bottom panel": "底部面板",
  "Close bottom panel": "关闭底部面板",
  "Close panel": "关闭面板",
  "Close summary": "关闭摘要",
  "Open side panel tab": "打开右侧面板标签页",
  "Task side panel": "任务右侧面板",
  "Image": "图片",
  "Image unavailable": "图片不可用",
  "Open original": "打开原图",
  "Close image viewer": "关闭图片查看器",
  "Image could not be loaded.": "无法加载图片。",
});

Object.assign(ZH_CN, {
  "Working": "正在处理",
  "Completed": "已完成",
  "Tool failed": "工具调用失败",
  "Thinking": "思考中",
  "Thought": "已思考",
  "Running command": "正在运行命令",
  "Ran command": "已运行命令",
  "Command failed": "命令运行失败",
  "Editing files": "正在编辑文件",
  "Edited a file": "已编辑 1 个文件",
  "Edited files": "已编辑文件",
  "File edit failed": "文件编辑失败",
  "Reading": "正在读取",
  "Read": "已读取",
  "Searching": "正在搜索",
  "Searched": "已搜索",
  "Listing": "正在列出",
  "Listed": "已列出",
  "Viewing images": "正在查看图片",
  "Viewed image": "已查看图片",
  "Viewed images": "已查看图片",
  "Image view failed": "图片查看失败",
  "Searching the web": "正在搜索网页",
  "Searched the web": "已搜索网页",
  "Search failed": "搜索失败",
  "Starting side task": "正在启动子任务",
  "Started side task": "已启动子任务",
  "Sending input to side task": "正在向子任务发送消息",
  "Sent input to side task": "已向子任务发送消息",
  "Resuming side task": "正在恢复子任务",
  "Resumed side task": "已恢复子任务",
  "Waiting for side tasks": "正在等待子任务",
  "Waited for side tasks": "已等待子任务",
  "Closing side task": "正在关闭子任务",
  "Closed side task": "已关闭子任务",
  "Updating side task": "正在更新子任务",
  "Updated side task": "已更新子任务",
  "Side task failed": "子任务失败",
  "Side task interrupted": "子任务已中断",
  "Side task active": "子任务正在运行",
  "Side task started": "子任务已启动",
  "Waiting for approval": "正在等待审批",
  "Worked": "处理过程",
  "Activity failed": "操作失败",
  "Read files": "已读取文件",
  "Ran commands": "已运行命令",
  "Edited files": "已编辑文件",
  "No output": "无输出",
  "Success": "成功",
  "Failed": "失败",
  "Stopped": "已停止",
  "Stopped command": "已停止命令",
  "Waiting for patch details…": "正在等待补丁详情…",
  "No patch details": "无补丁详情",
  "Plan mode": "规划模式",
  "Approve for me": "代我审批",
  "Always ask for permission before editing external files or using the internet": "编辑工作区外的文件或使用互联网前始终请求许可",
  "Only ask for actions detected as potentially unsafe": "仅在检测到可能不安全的操作时请求许可",
  "Not allowed by managed settings": "受管理设置限制，无法使用",
  "Custom": "自定义",
  "Custom (config.toml)": "自定义（config.toml）",
  "Custom permissions": "自定义权限",
  "Custom permission profile": "自定义权限配置",
  "Uses permissions defined in config.toml": "使用 config.toml 中定义的权限",
  "Unrestricted access to the internet and any file on your computer": "不受限制地访问互联网和此电脑上的任意文件",
  "API key mode": "API 密钥模式",
  "Codex account": "Codex 账户",
  "Reasoning": "思考强度",
  "Select model": "选择模型",
  "Back": "返回",
  "No matching tasks": "没有匹配的任务",
  "No subfolders": "没有子文件夹",
  "Loading folders…": "正在加载文件夹…",
  "No folder selected": "尚未选择文件夹",
  "Use this folder": "使用此文件夹",
  "Choose where new tasks should work.": "选择新任务的工作位置。",
  "None": "无",
  "Don't work in a project": "不在项目中工作",
  "Parent folder": "上一级文件夹",
  "Go": "前往",
  "Side tasks started by this chat will appear here.": "此对话启动的子任务会显示在这里。",
  "No side tasks": "没有子任务",
  "Choose or switch the local project folder available to this WebUI.": "选择或切换此 WebUI 可访问的本地项目文件夹。",
  "Choose project folder": "选择项目文件夹",
  "Open Browser from the right panel to keep it beside the chat.": "请从右侧面板打开浏览器，以便与对话并排显示。",
  "Scheduled task data requires the native desktop bridge.": "计划任务数据需要原生桌面桥接。",
  "Computer Use controls require the native desktop bridge.": "电脑操作控件需要原生桌面桥接。",
  "Plan data is not exposed by app-server.": "app-server 未提供计划数据。",
  "Side task data requires the native desktop bridge.": "子任务数据需要原生桌面桥接。",
  "Conversation source data is not exposed by app-server.": "app-server 未提供对话来源数据。",
  "Official": "官方",
  "Curated": "官方精选",
  "External": "外部挂载",
  "Installed": "已安装",
  "Install": "安装",
  "Use": "使用",
  "Use in prompt": "在对话中使用",
  "Edit": "编辑",
  "Save": "保存",
  "Delete": "删除",
  "New personal skill": "新建个人技能",
  "Refresh skills": "刷新技能",
  "Search skills…": "搜索技能…",
  "Loading skills…": "正在加载技能…",
  "No matching skills": "没有匹配的技能",
  "Installed official skills": "已安装的官方技能",
  "Official and personal skills for Codex": "管理 Codex 的官方和个人技能",
  "Manage skills": "管理技能",
  "Local OpenAI cache, not signature-verified. Review instructions and scripts before use.": "来源为本地 OpenAI 缓存，未经签名验证。使用前请检查说明和脚本。",
  "Could not load skills": "无法加载技能目录",
  "Could not update skill": "无法更新技能设置",
  "Could not read SKILL.md": "无法读取 SKILL.md",
  "Could not save skill": "无法保存技能",
  "Could not delete skill": "无法删除技能",
  "Install failed": "安装失败",
  "Install this skill? Review its instructions and scripts before use.": "安装此技能？使用前请检查其说明和脚本。",
  "Discard unsaved skill changes?": "放弃尚未保存的技能修改？",
  "Saved on disk, but Codex did not load this skill. Refresh to see parser errors.": "文件已保存，但 Codex 未加载此技能。请刷新查看解析错误。",
  "Delete personal skill “{name}” and its files?": "删除个人技能“{name}”及其全部文件？",
  "Skill ID (kebab-case)": "技能 ID（小写连字符命名）",
  "Description": "描述",
  "Skill Markdown content": "技能 Markdown 内容",
  "When Codex should use this skill and what workflow it owns": "描述 Codex 应何时使用此技能，以及它负责的流程",
  "System built-in": "系统内置技能",
  "Official curated catalog": "官方精选技能库",
  "Personal skills": "个人自建/已安装",
  "Project & external skills": "项目与外部挂载技能",
  "Skill enabled": "技能已启用",
  "Skill disabled": "技能已停用",
  "Skill saved": "技能已保存",
  "Skill installed": "技能已安装",
  "Skill deleted": "技能已删除",
  "Select a skill from the left sidebar to view or edit its instructions.": "请从左侧技能列表选择一个技能以查看或编辑其说明。",
});

const ZH_CN_PATTERNS = [
  [/^(\d+) changed files?$/, match => `${match[1]} 个文件已更改`],
  [/^Review (\d+) changed files?$/, match => `审阅 ${match[1]} 个已更改文件`],
  [/^Load earlier messages \((\d+)\)$/, match => `加载更早的消息（${match[1]}）`],
  [/^Worked for (.+)$/, match => `处理耗时 ${match[1]}`],
  [/^Reasoning: (.+)$/, match => `思考强度：${translate(match[1], "zh-CN")}`],
  [/^Model: (.+)$/, match => `模型：${match[1]}`],
  [/^Context usage: (\d+)%$/, match => `上下文用量：${match[1]}%`],
  [/^(\d+)% full$/, match => `已使用 ${match[1]}%`],
  [/^(\d+)% used \((\d+)% left\)$/, match => `已使用 ${match[1]}%（剩余 ${match[2]}%）`],
  [/^(\d+)k \/ (\d+)k tokens used$/, match => `已使用 ${match[1]}k / ${match[2]}k 令牌`],
  [/^(\d+) images$/, match => `${match[1]} 张图片`],
  [/^(\d+) side tasks?$/, match => `${match[1]} 个子任务`],
  [/^Ran (.+)$/, match => `已运行 ${match[1]}`],
  [/^Stopped (.+)$/, match => `已停止 ${match[1]}`],
  [/^Exit code (\d+)$/, match => `退出码 ${match[1]}`],
  [/^What can I help with in (.+)\?$/, match => `我能为 ${match[1]} 做些什么？`],
  [/^Remove (.+)$/, match => `移除 ${match[1]}`],
  [/^Attached (\d+) files$/, match => `已附加 ${match[1]} 个文件`],
  [/^Attached (.+)$/, match => `已附加 ${match[1]}`],
  [/^(\d+) matches$/, match => `${match[1]} 个匹配`],
];

export function resolveLocale(preference = "system", languages = []) {
  if (preference === "zh-CN") return "zh-CN";
  if (preference === "en") return "en";
  const values = Array.isArray(languages) ? languages : [languages];
  return values.some(value => /^zh(?:-|$)/i.test(String(value || ""))) ? "zh-CN" : "en";
}

function interpolate(template, values = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => key in values ? String(values[key]) : match);
}

export function translate(message, locale = "en", values = {}) {
  const source = interpolate(message, values);
  if (locale !== "zh-CN") return source;
  const direct = ZH_CN[message] || ZH_CN[source];
  if (direct) return interpolate(direct, values);
  for (const [pattern, replacement] of ZH_CN_PATTERNS) {
    const match = source.match(pattern);
    if (match) return replacement(match);
  }
  return source;
}

export function createI18n({ storage = globalThis.localStorage, languages = globalThis.navigator?.languages || [] } = {}) {
  let preference = storage?.getItem?.(LOCALE_STORAGE_KEY) || "system";
  if (!LOCALE_PREFERENCES.includes(preference)) preference = "system";
  let locale = resolveLocale(preference, languages);
  const listeners = new Set();
  const api = {
    get preference() { return preference; },
    get locale() { return locale; },
    t(message, values) { return translate(message, locale, values); },
    setPreference(next) {
      if (!LOCALE_PREFERENCES.includes(next)) return false;
      preference = next;
      locale = resolveLocale(preference, languages);
      storage?.setItem?.(LOCALE_STORAGE_KEY, preference);
      for (const listener of listeners) listener(locale, preference);
      return true;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return api;
}

const DOM_I18N_EXCLUDE = [
  "[data-i18n-ignore]",
  "[contenteditable='true']",
  ".message-text",
  ".activity-detail",
  ".activity-output",
  ".approval-reason p",
  ".approval-subtitle",
  ".autocomplete-title",
  ".review-hunks",
  ".side-task-copy small",
  ".terminal-host",
  ".thread-item",
  ".user-message",
  ".thread-name",
  ".review-file-name",
  ".change-path",
  ".folder-item",
  "code",
  "pre",
  "#accountName",
  "#accountMenuName",
  "#accountMenuSubtitle",
  "#browserUrl",
  "#folderPathInput",
  "#folderSelection",
  "#imageViewerPath",
  "#projectName",
  "#projectPath",
  "#settingsAccountName",
  "#settingsAccountMeta",
  "#summaryWorkspace",
  "#threadPath",
  "#threadTitle",
].join(",");

const TRANSLATED_ATTRIBUTES = ["aria-label", "placeholder", "title"];

function translateTextValue(value, i18n) {
  const source = String(value || "");
  const trimmed = source.trim();
  if (!trimmed) return source;
  const translated = i18n.t(trimmed);
  return translated === trimmed ? source : source.replace(trimmed, translated);
}

function isExcluded(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  if (element?.closest?.("[data-i18n-ui]")) return false;
  return Boolean(element?.closest?.(DOM_I18N_EXCLUDE));
}

export function createDomI18n(i18n, { root = globalThis.document } = {}) {
  if (!i18n || !root?.createTreeWalker) return { refresh() {}, disconnect() {} };

  const view = root.defaultView || root.ownerDocument?.defaultView || globalThis;
  const NodeFilterApi = view.NodeFilter || globalThis.NodeFilter;
  const MutationObserverApi = view.MutationObserver || globalThis.MutationObserver;
  const textState = new WeakMap();
  const attributeState = new WeakMap();

  function translateTextNode(node) {
    if (isExcluded(node)) return;
    const current = node.nodeValue || "";
    let state = textState.get(node);
    if (!state) {
      state = { source: current, last: current };
      textState.set(node, state);
    } else if (current !== state.last) {
      state.source = current;
    }
    const next = translateTextValue(state.source, i18n);
    state.last = next;
    if (current !== next) node.nodeValue = next;
  }

  function translateElementAttributes(element) {
    if (isExcluded(element)) return;
    let states = attributeState.get(element);
    if (!states) {
      states = new Map();
      attributeState.set(element, states);
    }
    for (const name of TRANSLATED_ATTRIBUTES) {
      if (!element.hasAttribute?.(name)) continue;
      const current = element.getAttribute(name) || "";
      let state = states.get(name);
      if (!state) {
        state = { source: current, last: current };
        states.set(name, state);
      } else if (current !== state.last) {
        state.source = current;
      }
      const next = translateTextValue(state.source, i18n);
      state.last = next;
      if (current !== next) element.setAttribute(name, next);
    }
  }

  function translateSubtree(node) {
    if (!node || isExcluded(node)) return;
    if (node.nodeType === 3) {
      translateTextNode(node);
      return;
    }
    if (node.nodeType === 1) translateElementAttributes(node);
    const walker = root.createTreeWalker(node, NodeFilterApi.SHOW_ELEMENT | NodeFilterApi.SHOW_TEXT);
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current.nodeType === 3) translateTextNode(current);
      else translateElementAttributes(current);
    }
  }

  function refresh() {
    const documentElement = root.documentElement || root.ownerDocument?.documentElement;
    if (documentElement) documentElement.lang = i18n.locale;
    translateSubtree(root.documentElement || root);
  }

  const observer = MutationObserverApi ? new MutationObserverApi(records => {
    for (const record of records) {
      if (record.type === "characterData") translateTextNode(record.target);
      else if (record.type === "attributes") translateElementAttributes(record.target);
      else for (const node of record.addedNodes) translateSubtree(node);
    }
  }) : null;
  observer?.observe(root.documentElement || root, {
    attributes: true,
    attributeFilter: TRANSLATED_ATTRIBUTES,
    characterData: true,
    childList: true,
    subtree: true,
  });
  const unsubscribe = i18n.subscribe(refresh);
  refresh();

  return {
    refresh,
    disconnect() {
      observer?.disconnect();
      unsubscribe();
    },
  };
}

export { ZH_CN as zhCNMessages };
