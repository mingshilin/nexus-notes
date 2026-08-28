# Nexus Notes AI 工具与交互性能设计

日期：2026-08-26
分支：`codex/ai-tools-performance`
状态：设计已获用户批准，待 spec 复核后实施

## 目标

在不改变现有视觉语言和 `/api/v2` 兼容调用方式的前提下：

- 让页面点击后的目标页面壳层立即出现，缓存页面在 250ms 内可交互；
- 让 AI 能够安全地创建笔记、创建提醒、创建站内通知和发送系统邮件；
- 保证所有副作用操作有用户确认、workspace/member 权限、幂等键、审计和失败恢复；
- 不让 AI 直接执行 SQL、访问任意 URL、读取跨 workspace 数据或绕过现有 API。

## 当前基线

- AI 对话入口：`apps/web/src/ai/AIChatPanel.tsx` → `/api/v2/ai/chat`。
- Worker provider：`apps/worker/src/ai/ai-chat-service.ts`，当前只返回 provider 文本，不执行工具。
- AI 配置：`UserAiConfigService` 使用 AES-GCM 密文保存用户 key；生产 `AI_ENABLED=false`。
- 笔记、提醒、通知、Queue 和 Resend 已有独立服务/仓储，可复用现有权限与审计边界。
- 页面切换入口集中在 `apps/web/src/app/App.tsx`；workspace domain lazy loader、client cache 和 database bootstrap 已存在。

## 方案

### 1. AI Tool Orchestrator

在 Worker 增加 `AiToolOrchestrator`，由 `/api/v2/ai/chat` 调用。provider 只接收固定 tool schema；provider 返回 tool call 后，Worker 将其转换为 `AiActionProposal`，而不是直接执行：

```ts
interface AiActionProposal {
  action_id: string;
  tool: "create_note" | "create_reminder" | "create_notification" | "send_email";
  summary: string;
  input: Record<string, unknown>;
  requires_confirmation: true;
  expires_at: string;
}
```

新增确认接口：

- `POST /api/v2/ai/actions/:actionId/confirm`
- `POST /api/v2/ai/actions/:actionId/reject`

action proposal 持久化到 `ai_action_proposals`，包含 `user_id`、`workspace_id`、tool、经过 schema 校验的 input、状态、revision、幂等键和过期时间。客户端永远不能提交未经 Worker 生成的任意 tool input。

### 2. 工具边界

`create_note`：

- 目标 workspace 必须是当前 session 的成员关系；
- 默认进入 Inbox，可选已授权 folder/database；
- 服务端调用现有 `NoteService`，不直接写表；
- 重复确认返回第一次成功结果。

`create_reminder`：

- `note_id` 必须属于当前 workspace；
- 复用现有 recurrence、timezone、channels 和 delivery outbox 校验；
- 默认只开启站内提醒，邮件/Push 必须在确认卡片中明确显示。

`create_notification`：

- 目标只能是当前用户或当前 workspace 的有效成员；
- 复用 collaboration notification repository 的 dedupe 规则；
- 不允许通知任意外部用户。

`send_email`：

- 发件人固定为 Worker 的 `EMAIL_FROM` 和已配置的 Resend API；
- 默认收件人是当前用户的已验证邮箱；其他收件人必须在 action proposal 中完整展示并由用户确认；
- 收件人、主题、正文有长度/数量上限，正文按纯文本发送，禁止 AI 直接生成任意 HTML；
- 通过 email outbox/Queue 异步发送，重试和永久失败状态可查询；
- 不支持用户自定义 SMTP/Resend 身份，不把发件凭据返回前端。

### 3. 前端确认交互

`AIChatPanel` 增加 action card：

- 展示工具名称、目标 workspace、对象、收件人、主题和正文摘要；
- “确认执行”和“拒绝”按钮默认都可见；
- 发送邮件和通知使用更强的二次确认文案；
- action 过期、重复、权限变化和执行失败均显示明确状态及重试入口；
- 刷新页面后仍可查询未过期 proposal，但不在本地缓存明文邮件正文或 API key。

### 4. 性能优化

- 导航点击同步提交 `requestedDomain` 和页面壳层；lazy module 预加载放到 idle/hover/focus 阶段；
- domain client 按 workspace 生命周期稳定，切换页面不重建 client；
- 列表/数据库/账户/提醒查询使用 workspace-scoped cache，先显示 stale 数据再后台刷新；
- 相同 TTL 和 dedupe key 下不重复请求；离开页面取消旧请求；
- 页面重组件保持 lazy，初始 preload 不包含 Markdown/OCR/AI；
- AI action card 仅更新局部会话状态，不触发整个工作台重挂载。

## 安全与失败处理

- 所有 action confirm 必须重新检查 session、workspace membership、role、目标实体和 proposal revision；
- proposal 只能被创建它的用户确认，过期时间默认 10 分钟；
- 每个工具使用 `ai-action:${userId}:${actionId}` 幂等键；
- 主数据写入与 audit/outbox 在同一 D1 batch 内提交；邮件/Push 投递失败不能回滚已提交笔记或提醒；
- 日志只记录 action id、tool、状态、request id 和错误码，不记录 prompt、正文、收件人完整地址、token 或 key；
- provider 超时、无工具调用、非法 tool、schema 错误和 Queue 故障均返回可解释错误。

## 数据库迁移

新增 additive migration：

- `0017_ai_action_proposals.sql`
- `0018_ai_email_outbox.sql`

不修改现有表的语义，不删除旧字段。迁移失败不得影响已有笔记、提醒和登录。

## 测试与验收

- contracts：tool schema、proposal、confirm/reject、email payload 上限；
- Worker：跨 workspace 拒绝、viewer/editor 权限、过期 proposal、重复确认、审计/事务回滚、邮件 Queue 重试；
- Web：action card 确认/拒绝/失败恢复、刷新后 proposal、键盘焦点和 390px 布局；
- 性能：导航壳层 100ms 内出现、缓存页面 250ms 内可交互、TTL 内不重复请求；
- 生产：AI 默认保持关闭，配置 provider 后再执行真实聊天和工具 smoke；
- 完成后运行 lint、root/Beta 双端测试、build、audit、deploy readiness 和线上 smoke。

## 不在本阶段

- 不支持任意 SMTP、任意外部 HTTP、任意 SQL、自动发送无确认邮件；
- 不持久化完整聊天历史；
- 不实现 CRDT 或后台全自动代理；
- 不改变当前视觉主题和生产 R2 绑定。
