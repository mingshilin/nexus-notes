# Nexus Notes AI 助手与流畅度深化设计

更新时间：2026-08-27
基线：`codex/ai-tools-performance-public` / `5657911`

## 目标

本轮解决两个用户可感知问题：页面点击和切换不够顺滑，以及 AI 只能对话、不能安全完成笔记软件任务。视觉风格保持现有 Nexus Notes Beta，不重做配色、字体、圆角、glass surface 或导航结构。

## 已知事实

- `apps/web/src/app/App.tsx` 约 2,825 行，仍是多个产品域的主要组合与状态入口。
- Beta 已有 notes、databases、knowledge、reminders、collaboration、account 和 AI 页面，API v2、workspace 权限、D1/R2/Queue、IndexedDB 和 lazy chunks 已存在。
- 已有 AI proposal/confirm/reject、`create_note`、`create_reminder`、`create_notification`、`send_email` 四个工具，以及 workspace-scoped cache、请求取消和 stale-while-revalidate 基础。
- Preview 的无状态负载最近测得 p95 约 1,339ms；这只能作为基线，不能替代真实导航、API 和浏览器指标。
- Preview/生产默认 `AI_ENABLED=false`；生产仍需独立备份、迁移、回滚和真实认证门禁。

## 已锁定的产品决策

### AI 授权

- 默认模式为 `confirm`；用户可在账户中心显式开启按 workspace 生效的 `trusted` 模式，默认 24 小时后失效，可手动关闭。
- 读取和分析只允许当前 workspace；默认上下文是当前笔记和用户明确选定的实体。工作区搜索必须由用户明确选择范围，结果仍按 workspace、database、field 权限过滤。
- trusted 模式可自动执行：新建笔记、新建提醒、创建站内通知。每次操作仍记录审计、idempotency key 和结果。
- 以下动作无论模式都必须展示预览并显式确认：修改或删除笔记、归档/恢复、批量操作、数据库结构/记录写入、权限变更、发送邮件和任何外部副作用。
- 邮件默认只允许当前用户和 workspace 成员作为收件人；外部地址每次都必须确认。所有邮件使用 Worker 的 `EMAIL_FROM` 和系统 Resend 配置，不接受用户 SMTP。
- AI 不得执行任意 SQL、任意 HTTP、动态代码、文件系统操作或绕过现有 service/repository 权限。

### 流畅度

- 导航点击先同步提交目标 domain 和页面 shell，再异步加载 lazy module。
- 每个 route 只有一个主 scroll owner；返回页面优先显示 workspace-scoped stale cache，再后台刷新，不清空可见数据。
- 同一 workspace/查询在 TTL 内不重复请求；切换 workspace、退出和 mutation 必须使旧请求失效，旧响应不能覆盖新租户状态。
- 目标指标：点击后 100ms 内出现目标 shell；缓存页面 250ms 内可交互；API read p95 <500ms、write p95 <800ms；超标只记录为待优化证据，不用测试造假掩盖。

## AI 工具分层

工具由共享契约声明，Worker 只注册 allowlist 工具，执行器只调用已有领域服务：

| 层级 | 工具 | 默认行为 |
| --- | --- | --- |
| Read | `search_notes`、`get_note`、`list_reminders`、`search_databases`、`get_database_record` | 直接执行；返回来源、范围和权限裁剪信息 |
| Safe write | `create_note`、`create_reminder`、`create_notification` | trusted 自动；confirm 模式先 proposal |
| Confirmed write | `update_note`、`archive_note`、`restore_note`、`delete_note`、`move_note`、`apply_tag`、`create_database_record`、`update_database_record`、`complete_reminder` | 始终 proposal + 显式确认 + revision CAS |
| External/destructive | `send_email`、`change_permissions`、`delete_database`、批量写入 | 始终确认；邮件走 outbox/Queue/Resend |

每个工具输入使用 Zod schema；proposal 绑定 `user_id`、`workspace_id`、工具版本、输入 fingerprint、base revision、过期时间和 idempotency key。确认时重新检查 session、membership、role、capability、目标实体和 revision。

## 流程与错误恢复

1. Web 发送用户消息和显式上下文选择。
2. Worker provider adapter 只能收到契约声明的工具 schema；模型返回 tool call 后先验证全部调用，再创建 proposal 或执行只读工具。
3. proposal 卡片展示目标、字段变化、数据范围、收件人和风险级别；用户确认后调用 confirm endpoint。
4. Worker 执行器调用 tenant-bound service。写入使用确定性 idempotency；失败保留 proposal、错误分类和重试入口，不能静默成功。
5. 邮件先写 D1 outbox，再由 Queue/Resend 发送；dispatch lease、delivery lease 和 Queue generation 分离，外部投递只宣称 at-least-once。
6. 前端在请求超时、断网、workspace 切换和页面卸载时保留输入、proposal 状态和可恢复提示，不把敏感正文写入 localStorage、IndexedDB、日志或 Service Worker cache。

## 产品缺口优先级

### P0：稳定性与数据安全

- 导航 shell 与数据请求解耦，修复旧请求覆盖、重复请求和 loading 清空内容。
- 所有 AI 写操作统一 proposal、权限、revision、idempotency、audit 和恢复状态。
- 真实浏览器覆盖注册/登录、笔记保存、断网恢复、workspace 切换、AI action confirm/reject 和邮件 outbox 状态。
- 迁移、备份、恢复和 rollback 证据必须在 Preview 完成后才允许生产动作。

### P1：核心工作流完整度

- AI 能搜索并引用笔记、创建/修改笔记、整理文件夹/标签、创建和完成提醒、创建数据库记录。
- Knowledge Center 的搜索来源、附件/OCR 状态、未整理/孤立/重复笔记处理提供清晰反馈。
- Database 管理中心补齐模板预览、CSV 错误定位、权限最终生效说明和移动端抽屉收起行为。
- Account Center 增加可信模式开关、作用域、到期时间、审计记录和通知偏好说明。

### P2：效率增强

- AI 批量整理、周期任务、跨页面任务进度、可撤销操作和结果摘要。
- 大列表虚拟化/分段渲染、预取命中率和 Web Vitals 面板。
- 更完整的无障碍键盘导航、390px/200% zoom 和移动键盘回归。

## 非目标

- 不实现 CRDT、Anthropic/Gemini 原生协议、用户 SMTP、任意插件代码执行或跨 workspace 默认搜索。
- 不在本轮重做视觉设计，不直接覆盖生产 Worker/D1，不删除旧部署或旧数据。

## 验收门禁

- Web、Worker、contracts、domain、UI 定向测试和全量测试零失败。
- `npm run lint`、`npm run beta:build`、`npm audit --omit=dev`、`npm run verify:deploy` 通过；无 Vite `>500 kB` 警告，Markdown/OCR/AI 不进入初始 preload。
- 真实浏览器在独立外部 profile 中验证关键登录、笔记、缓存切换和 AI proposal 流程；缺少凭据时必须标记 blocked，不得伪造通过。
- Preview online health、headers、390px、load、migration/restore 和 rollback evidence 全部具备后，才单独请求生产迁移和部署。
