# AI Chat Configuration

AI 助手通过 Worker 代理 OpenAI-compatible Chat Completions API。浏览器只发送工作区范围内的 conversation，不会读取或自动上传笔记内容；API key 只在 Worker 运行时使用。

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

如果配置缺失，`POST /api/v2/ai/chat` 会返回 `AI_NOT_CONFIGURED`，前端保留用户输入并显示可恢复提示，不影响笔记和数据库功能。
