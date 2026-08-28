# Nexus Notes 功能对齐矩阵

更新时间：2026-08-28
基线：`codex/ai-assistant-fluency` 当前 worktree
状态含义：`已验证` 表示有对应测试或验收证据；`已实现待验收` 表示源码入口存在但仍需要真实浏览器或失败路径证据；`缺口` 表示当前 Beta 还没有完整能力；`依赖配置` 表示代码存在但需要外部 Secret/绑定。

## 阶段 1 入口

| 能力 | 当前状态 | 证据/入口 | 下一步 |
| --- | --- | --- | --- |
| 创建中心 | 已验证 | `ProductNavigation` 的“创建内容”视觉入口，accessible name 为“创建中心”；桌面画布顶部和快速开始区域均有可见创建入口；笔记上下文列表额外提供文字化“创建内容”入口；`CreateCenter` 覆盖新建笔记、快速捕获、Web Clipper、今日笔记、新建数据库、提醒和导入；390×844 真实 Chrome 首轮打开/关闭通过，dialog 关闭会等待背景解除 `inert` 后把焦点还给移动端 opener | 继续补线上真实认证浏览器验收 |
| 新建笔记 | 已验证 | 左侧“新建笔记”、创建中心和快速开始入口；前端 live flow 测试 | 补数据库关联入口 |
| 个人资料与设置 | 已验证 | 左侧“个人资料与设置”、账户菜单、笔记上下文列表文字化“个人资料”入口、`AccountCenter`；App 级测试覆盖个人资料/安全/工作区入口 | 补真实认证浏览器修改资料/安全流程 |
| 移动端入口 | 已验证 | 390×844 真实 Chrome 中底栏高度约 58px 并贴合视口底部；产品域横向滚动且显式 `overflow-y:hidden`；账户与 AI 页面不挂载浮动创建区；页面宽度与视口同为 390px；控制台无 error/warning | 继续检查真实移动键盘与设备 safe-area |

## 核心功能

| 产品域 | 能力 | 当前状态 | 证据/缺口 |
| --- | --- | --- | --- |
| 笔记 | 全部、收件箱、今日、收藏、置顶、归档、回收站 | 已验证 | `NotesClient` server-side filters 与 live flow 测试 |
| 笔记 | 搜索标题、正文、标签与搜索空态 | 已验证 | 搜索 query、去抖、清除和 Worker route 测试 |
| 笔记 | Markdown 编辑、预览、工具栏、斜杠命令 | 已验证 | `NoteEditorSurface` 和 preview 测试 |
| 笔记 | 编辑器上传附件并插入私有正文链接 | 已验证 | `note-editor-surface.test.tsx`、`live-notes-flow.test.tsx` 覆盖成功上传、链接插入和上传失败时保留正文 |
| 笔记 | 关联数据库 | 已验证 | 选中笔记后懒加载“笔记数据库”选择器；保存时向 `PATCH /api/v2/notes/:id` 传递 `database_id`；`live-notes-flow.test.tsx` 覆盖 |
| 笔记 | 文件夹、标签、链接、反向链接 | 已实现待验收 | 组件和 client 已存在；需真实浏览器闭环 |
| 笔记 | 历史版本、恢复、回收站永久删除 | 已验证 | live flow 与 detach/删除测试 |
| 创建 | 快速捕获、今日笔记 | 已验证 | `CreateCenter`、quick-capture、daily flow 测试 |
| 创建 | Markdown/纯文本导入 | 已实现待验收 | `ImportExportCenter` 已覆盖多块预览、条目数、文件大小校验、失败保留原文件、重试、任务轮询和 queued 任务按 revision 撤销；Worker 按 `---` 分块并限制最多 100 篇；仍需真实 Worker/浏览器验收和大文件场景 |
| 创建 | Web Clipper | 已验证 | `/api/v2/clipper/capture` 独立契约、http/https URL allowlist、收件箱/今日笔记/数据库目标、数据库 workspace 校验、失败保留输入和创建中心入口测试 |
| 创建 | 新建提醒 | 已验证 | 主导航创建中心可打开“新建提醒”，并进入提醒中心；App 级导航测试覆盖 |
| 知识整理 | 搜索 filters、保存搜索、命中来源 | 已实现待验收 | Knowledge client/repository 已有 filters；需逐项确认 UI 映射 |
| 知识整理 | 附件类型/OCR 状态/日期/来源组合过滤 | 已实现待验收 | 附件恢复面板已有部分 filters；需组合过滤验收 |
| 知识整理 | OCR 单个/批量重试和失败诊断 | 已实现待验收 | Worker queue/OCR consumer 已有；需真实附件流程 |
| 知识整理 | 未整理批量归类、孤立笔记、重复标题 | 已实现待验收 | `KnowledgeDiagnosticActions` 提供批量归类、孤立笔记移入收件箱/忽略、重复标题合并并归档副本；`knowledge-recovery-live.test.tsx` 覆盖未整理归类和重复合并，仍需真实 Worker/浏览器验收 |
| 知识整理 | 知识图谱 | 已实现待验收 | lazy graph panel 已存在；需真实数据验收 |
| 数据库 | 数据库、属性、记录、视图 | 已验证 | Database client/workbench 与数据库测试 |
| 数据库 | text/number/select/date/checkbox/member/relation 等 typed values | 已验证 | `DatabaseRecordForm` 和 typed property tests |
| 数据库 | 表格、看板、日历、无日期分配 | 已实现待验收 | 组件与回滚测试已有；需真实浏览器场景 |
| 数据库 | 模板默认值完整编辑与应用 | 已实现待验收 | `DatabaseViewTemplateForms` 已存在；需边界和浏览器验收 |
| 数据库 | 批量编辑和 CSV 事务导入导出 | 已验证 | Worker D1 transaction/CSV tests |
| 数据库 | 数据库/字段权限和字段过滤 | 已验证 | Worker permission matrix tests |
| 协作 | 成员、邀请、角色和工作区 | 已实现待验收 | `CollaborationCenter` 与 Worker route tests；创建工作区成功后刷新 session 并自动切换到新 workspace；刷新失败时保留当前工作台并提示刷新，避免重复创建 |
| 协作 | 评论、提及、通知、活动、审计 | 已实现待验收 | Worker tests 已有；需真实浏览器流程 |
| 协作 | 公开分享、密码、过期、撤销 | 已验证 | 当前笔记“打开笔记分享”入口和 share route tests |
| 账户 | 个人资料和头像 | 已验证 | `ProfilePanel`、资料持久化、头像上传/响应头和失败恢复已由 `scripts/smoke-beta-browser.mjs` 的真实认证浏览器 smoke 验证；邮箱/安全敏感流程仍需外部邮件配置 |
| 账户 | 密码、会话、邮箱验证和重置 | 已实现待验收 | Auth/Account panels 和 Worker routes 已有；需外部邮件/Turnstile 配置验收 |
| 账户 | 数据导出、账户删除、离线清理 | 已实现待验收 | `DataPrivacyPanel` 已存在；需真实数据恢复演练 |

## AI

| 能力 | 当前状态 | 证据/缺口 |
| --- | --- | --- |
| AI 对话页面 | 已实现待验收 | `AIChatPanel` 已连接 `/api/v2/ai/chat` |
| AI 配置状态 | 已实现待验收 | `/api/v2/ai/status` 和未配置状态文案 |
| AI 工具写入确认 | 已验证 | `POST /api/v2/ai/actions/:actionId/confirm` / `reject` 在执行前重新校验 session、workspace membership、role 和 proposal revision；`send_email` 由 Worker 配置的 `EMAIL_FROM` 发出，不使用用户邮箱 |
| Provider API key 安全 | 依赖配置 | 必须设置 Worker Secret，不能进入前端 bundle 或 Git |
| OpenAI-compatible adapter | 已实现待验收 | Worker adapter 已有；需配置真实 provider 后跑 health/chat smoke |
| 当前笔记总结/改写/提取任务 | 已实现待验收 | `NoteAiActions` 提供摘要、任务提取和标签建议；结果先预览，确认后才写入当前草稿或标签；`live-notes-flow.test.tsx`、`note-ai-actions.test.tsx` 覆盖，仍需真实 provider/browser 验收 |
| AI 限流、额度、超时、重试 | 已实现待验收 | 路由有 workspace/IP 限流，服务层有请求体/响应体边界和内部超时，慢 provider 映射为可重试 `AI_PROVIDER_TIMEOUT`；需真实 provider/fault tests |

## 稳定性与性能

| 能力 | 当前状态 | 证据/缺口 |
| --- | --- | --- |
| 请求取消、去重、重试策略 | 已验证 | `ApiClient` 与 query tests |
| 离线草稿、失败恢复和冲突双版本选择 | 已验证 | local store、draft controller、`NoteConflictPanel` 和 live flow tests 覆盖保留本地/采用服务器两条恢复路径 |
| 附件上传恢复 | 已实现待验收 | recovery code 已有；需真实 R2/浏览器流程 |
| 统一主滚动区域和 390px 溢出 | 已验证 | mobile overflow/core UX tests；真实浏览器确认产品导航仅横向滚动、底栏不增加第二个纵向滚动容器 |
| 长列表分页/大数据库渲染 | 已实现待验收 | keyset/page-size code 已有；需 5,000 条性能场景 |
| lazy Markdown/OCR/AI chunk | 已验证 | build/readiness 检查无初始 forbidden preload |
| 静态资源缓存与公共壳负载 | 已验证 | Task 12 线上 390px public-shell smoke 通过，DOMContentLoaded 1461ms、FCP 1544ms；load gate 为 32 请求 p95 875ms，低于 2000ms 预算。`/assets/*` 返回一年 `immutable`，HTML 返回 `max-age=0, must-revalidate` |
| 真实浏览器注册、登录、创建、分享、AI | 已实现待验收 | 真实 Chrome/CDP 已验证登录、创建笔记、丢失保存响应后的 IndexedDB 草稿恢复、reload 后 idempotency replay、资料保存、头像上传、200% zoom、390px 键盘布局和退出清理恢复；真实分享与 AI provider 仍需对应数据/外部配置 |

## Preview 与数据发布证据

| 项目 | 当前状态 | 证据/约束 |
| --- | --- | --- |
| 线上 preview 前端 | 已验证 | `https://nexus-notes-public-beta-preview.shilinming9.workers.dev/` 已部署最新源码；Task 12 部署版本 ID `bcdf6053-25d4-4d55-8112-4936d4414f81`，回滚版本 `5c70961e-e737-4420-b5f9-754222a2ffe1`；`/api/v2/health` 返回 `status=ok, ocr=ready` |
| Preview D1 备份 | 已验证 | 仓库外备份：`D:\mingSL\Documents\nexus-notes-beta-backups\20260828-171927\preview-data.sql`；323,638 bytes；SHA-256 `1CB5C34C27A64CD86FB6A34F5C406CDE3F56DE9B67982FD291B9A622634FA45F`；仅排除 FTS5 内部表、`_cf_KV` 与 `d1_migrations` |
| D1 恢复演练 | 已验证 | 在全新仓库外恢复目录 `D:\mingSL\Documents\nexus-notes-restore-runtime\20260828-171927` 应用 Beta schema 后导入 60 个普通应用表；本地恢复读取 10 users、8 workspaces、25 notes、1 database、0 reminders、0 AI proposals/outbox，`PRAGMA foreign_key_check` 无结果；源备份哈希未变化 |
| 远程 additive migrations | 已验证 | Preview D1 已应用 `0021_ai_trusted_mode.sql` 至 `0024_ai_reminder_actions.sql`，迁移记录完整为 `0001` 至 `0024`；`PRAGMA foreign_key_check` 无结果，迁移后 health 为 200 |
| Preview R2 数据 | 无需复制 | 备份时 beta/legacy attachment 记录均为 0；当前没有需要同步的 R2 对象 |
| 真实认证 smoke | 已验证 | `scripts/smoke-beta-browser.mjs --require-auth --authenticated` 使用仓库外 Chrome profile 完成认证与恢复场景；临时账号已清理，reset token/session 未写入仓库 |

## 收尾证据

| 项目 | 当前状态 | 证据 |
| --- | --- | --- |
| 临时认证账号清理 | 已验证 | Preview D1 中账号已标记 `deleted`，48 个 session 均无 active 状态，成员关系为 0，测试笔记已清理；不可变 `audit_logs` 保留 101 条，`PRAGMA foreign_key_check` 无结果 |
| 审计存在时的账户删除 | 已验证 | `D1ProfileRepository` 在个人空间存在不可变审计行时归档空间而非触发级联删除失败；`d1-profile-repository.test.ts` 覆盖归档、匿名化和成员清理 |

## 下一阶段顺序

1. 用仓库外的认证 Chrome profile 复跑 `npm run test:e2e -- --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/`，补齐真实分享、附件/OCR 和离线恢复数据场景。
2. 配置真实 AI provider Worker Secret 后执行 health、chat、超时和限流验收；当前 Preview 明确保持 `AI_ENABLED=false`。
3. Preview 全部门禁通过后，再单独审批 GitHub push/PR、生产切换和 tag。
