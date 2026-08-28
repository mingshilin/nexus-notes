# AI Chat Configuration

更新时间：2026-08-28

AI 助手支持系统 AI 与用户个人 OpenAI-compatible provider。系统 AI 默认通过 Cloudflare Workers AI 提供，不需要用户 API Key；用户可以选择“我的 AI”并配置个人地址、模型和 Key。浏览器只发送工作区范围内的 conversation，不会读取或自动上传笔记内容；API key 只在 Worker 运行时使用。

在 AI 页面中，“系统 AI”是默认选项；“我的 AI”通过 `/api/v2/ai/provider` 按用户保存选择。该选择跨工作区生效，个人配置缺失时服务端自动回退系统 AI。

## Local

在 Worker 项目目录创建被 `.gitignore` 忽略的 `.dev.vars`：

```text
AI_CHAT_API_URL=https://provider.example/v1/chat/completions
AI_CHAT_API_KEY=replace-with-a-local-key
AI_CHAT_MODEL=replace-with-a-model
```

不要把 `.dev.vars`、真实 key 或 provider 响应提交到 Git。

## Cloudflare Worker

生产环境只将 URL 和 model 作为 Worker variables 配置，使用 Worker Secret 保存 key：

```text
AI_CHAT_API_URL=https://provider.example/v1/chat/completions
AI_CHAT_MODEL=provider-model
npx wrangler secret put AI_CHAT_API_KEY
```

也可以在 Cloudflare Worker 控制台的 Settings 中分别设置变量和 secret。生产环境不使用 `VITE_AI_CHAT_API_KEY`，也不要把 key 写入 `wrangler.toml`、`.env.production`、`.env.example` 或前端 bundle。

Provider 需要接受如下请求并返回 `choices[0].message.content`：

```json
{
  "model": "configured-model",
  "messages": [{ "role": "user", "content": "你好" }],
  "stream": false
}
```

如果个人配置缺失，用户选择“我的 AI”时会自动回退系统 AI。只有系统 AI 与个人 AI 都不可用时，`POST /api/v2/ai/chat` 才返回 `AI_NOT_CONFIGURED`；前端保留用户输入并显示可恢复提示，不影响笔记和数据库功能。

## AI Actions

系统 AI 由 `AI_ENABLED=true` 与 Workers AI binding 启用；管理员可以另外配置外部 provider URL、model 和 Worker Secret 覆盖系统来源。任何会写入笔记、提醒、通知或邮件的提案都必须先显示预览并等待用户显式确认；`/api/v2/ai/actions/:actionId/confirm` 在执行前会重新校验 session、workspace membership、role 和 proposal revision，未确认的提案不得直接落库或发信。
