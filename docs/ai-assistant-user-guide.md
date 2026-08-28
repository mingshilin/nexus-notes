# Nexus Notes AI 助手使用说明

更新时间：2026-08-28

## 当前 Preview 状态

Preview 地址：<https://nexus-notes-public-beta-preview.shilinming9.workers.dev/>

当前 Preview 的 AI 默认关闭（`AI_ENABLED=false`）。你可以打开 AI 助手查看入口和配置状态，但在管理员接入真实 OpenAI-compatible provider 前，聊天请求会显示“未配置”恢复提示，不会影响笔记、数据库和提醒功能。

## AI 可以做什么

接入 provider 并启用后，AI 助手可以在当前工作区中提出以下操作：

- 建立、更新、归档、恢复或删除笔记。
- 建立文件夹、批量应用标签。
- 建立和更新数据库记录，并按类型校验字段值。
- 建立、完成和管理提醒。
- 建立站内通知。
- 使用 Nexus Notes 系统发件地址发送邮件。
- 对当前笔记生成摘要、任务提取和标签建议。

写入、发信和删除操作都会先生成可审查的操作卡片。只有用户明确确认后，Worker 才会再次校验登录状态、工作区成员关系、角色、权限和 proposal revision，然后执行一次幂等操作。邮件通过系统 outbox/Queue 投递，失败会保留可重试状态。

## 使用建议

1. 先在对话中明确目标工作区、笔记或数据库记录。
2. 对有副作用的请求先检查操作卡片中的目标、字段、收件人和正文。
3. 需要真正写入或发信时点击确认；只想讨论时不要确认操作卡片。
4. 看到超时、权限拒绝或 provider 错误时，先按提示重试，不要重复提交相同任务。

## 安全边界

AI 不会获得其他工作区的数据。用户笔记正文、密码、session、邮件验证码和 provider key 不写入日志、Analytics、IndexedDB 或浏览器缓存。Provider key 只允许由管理员配置为 Worker Secret；不要把 key 放进前端环境变量、`wrangler.toml`、Git 或聊天内容。

## 验收限制

当前自动化认证 AI smoke 会在没有仓库外 Chrome authenticated profile 时返回 `BLOCKED AUTHENTICATED_PROFILE_UNSET`。这表示缺少安全测试凭据，不表示 AI 功能失败或通过；配置 profile 和真实 provider 后再执行完整聊天、操作确认、邮件和失败恢复场景。
