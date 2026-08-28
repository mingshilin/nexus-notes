# Personal AI Provider And Note Editor Focus Design

## Goal

让 Nexus Notes 同时支持管理员提供的系统 AI 和用户自己的 AI 配置，并让打开笔记时写作区成为首屏主内容，管理信息按需打开而不挤压编辑器。

## Decisions

- 系统 AI 是默认提供方，是否可用由 Worker 的管理员配置决定。
- 用户可以在账户 AI 控制页选择“系统 AI”或“我的 AI”。选择“我的 AI”但没有完整个人配置时，服务端回退到系统 AI。
- 个人 API Key 继续由现有 `UserSecretBox` 加密保存；API、日志、Analytics、IndexedDB 和 Service Worker 不接触明文 Key。
- 个人配置优先级只由用户选择决定，不改变现有 workspace 权限、AI action confirmation、revision 或 idempotency 校验。
- `AI_ENABLED=false` 只禁用系统默认 provider；当用户存在完整个人配置时，个人聊天和个人 AI action 仍可用。
- 笔记的文件夹、数据库、标签、链接和 AI 操作仍保留，但收纳到 Inspector。Inspector 默认关闭，桌面端为不占主画布的右侧面板，移动端为全屏抽屉。
- 不修改现有 API URL 或破坏已有响应字段，只增加 `selected_source`、`personal_configured` 等状态字段，并以 additive migration 保存 provider 选择。

## Data Flow

用户请求 AI 时，Worker 读取用户的 provider preference 和个人配置：

1. 选择 `personal` 且个人配置完整，使用用户解密后的 provider。
2. 其他情况使用系统 provider；系统 provider 未启用或未配置时返回现有 `AI_NOT_CONFIGURED`/disabled 错误。
3. 个人配置删除后 preference 保留为 `system`，下次请求自然回退系统 provider。

所有 provider selection 和 config endpoint 仍需 session；workspace AI chat/action 仍需 workspace membership 和现有角色/能力校验。

## UI

AI 控制页增加当前 provider 单选/选择器，并分别展示系统 AI 是否可用、个人 AI 是否已配置和当前使用来源。配置个人 AI 的表单保留现有地址、模型、Key、测试、保存、删除流程。

笔记编辑器顶栏只保留标题、保存状态和必要的操作按钮。Inspector opener 使用明确的 `aria-label`，关闭后焦点回到 opener；Inspector 打开时不改变编辑器正文宽度，移动端不产生第二个垂直滚动容器。

## Verification

- Worker 测试覆盖系统启用、系统关闭、个人配置优先、个人配置缺失 fallback、选择持久化和跨用户隔离。
- Web 测试覆盖 provider 选择状态、个人配置表单和无 AI 时的可恢复提示。
- Web 测试覆盖笔记首屏默认关闭 Inspector、打开/关闭焦点和移动端不占主写作区。
- 完整 lint、双端测试、build、deploy readiness、Preview online readiness 和 390px browser shell 必须通过；不得产生 Vite `>500 kB` 警告或 Markdown/OCR/AI 初始 preload。
