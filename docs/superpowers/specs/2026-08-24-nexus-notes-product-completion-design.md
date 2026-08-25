# Nexus Notes 产品完整性与 AI 接入设计

## 目标

在不丢失旧系统能力、保持现有视觉语言的前提下，让 Nexus Notes Beta 的核心入口可发现、原有功能可用、常用操作稳定流畅，并通过服务端安全代理接入可替换的大模型 provider。

## 当前证据

- 当前 Beta 已有 `CreateCenter`、`AccountCenter`、`AIChatPanel`、数据库、知识整理、提醒、协作、分享、附件恢复和导入导出模块。
- 截图暴露的主要问题是入口发现性：左侧的“创建”语义不够明确，个人资料和账户设置位于较深层级，首屏也没有向用户说明下一步操作。
- 当前 worktree 为 `codex/public-beta-rewrite`，存在前序未提交改动；本设计不覆盖、不回退、不删除这些改动。
- 当前数据 API、D1 schema、Worker 路由和既有视觉风格均作为兼容边界；不以重写替代缺失功能盘点。

## 设计原则

1. 入口优先：用户在一个交互内能找到“新建内容”和“个人资料与设置”。
2. 能力完整：每个旧系统功能必须有入口、成功态、加载态、失败态、权限态和移动端路径。
3. 服务端可信：权限、AI key、额度、敏感数据过滤和审计不放在前端决定。
4. 渐进增强：保持原来的颜色、玻璃层级、圆角、间距和图标规则，只调整布局、信息层级和交互反馈。
5. 可恢复：保存、上传、导入、AI 请求和离线同步失败时保留用户输入并提供重试。
6. 可验证：每个阶段都有定向测试和可重复的浏览器验收，不以“代码里存在组件”视为完成。

## 分阶段方案

### 阶段 1：可发现入口与基础工作台

统一入口结构：

- 左侧主导航保留“笔记、数据库、知识整理、提醒、协作、AI 助手”。
- 左侧顶部提供清晰的“创建”按钮，打开创建中心；创建中心展示新建笔记、快速捕获、今日笔记、新建数据库、导入内容和新建提醒。
- 左侧底部和右上账户菜单同时提供“账户与设置”，进入账户中心。
- 账户中心固定展示“个人资料、安全、工作区、数据与隐私”四个 tab。
- 空工作区首屏显示“新建笔记、快速捕获、创建数据库、个人资料与设置”四个快速开始卡片。
- 390px 下将创建和账户入口放入不遮挡主内容的移动端 chrome；键盘弹出或编辑器聚焦时不占用正文空间。

验收：新用户不依赖快捷键或猜图标即可打开新建笔记、快速捕获、数据库、个人资料和安全页面；桌面与 390px 均有唯一主滚动区域。

### 阶段 2：旧系统功能对齐

建立 `docs/feature-parity-matrix.md`，以旧系统源码、旧路由和已有测试为证据，逐项记录入口、API、权限、状态和验收结果。矩阵至少覆盖：

| 产品域 | 必须可用的能力 |
| --- | --- |
| 笔记 | 全部/收件箱/今日/收藏/置顶/归档/回收站、搜索、Markdown 编辑、预览、标签、文件夹、链接、历史版本、恢复、删除与 detach 顺序 |
| 创建 | 新建笔记、快速捕获、今日笔记、导入 Markdown/纯文本、新建数据库、提醒 |
| 知识整理 | 保存搜索完整 filters、命中来源、附件组合过滤、OCR 状态、单个/批量重试、未整理归类、孤立笔记、重复标题处理、图谱 |
| 数据库 | 数据库、列/属性、类型感知值、记录、表格/看板/日历、无日期分配、模板默认值、批量编辑、CSV 事务导入导出、评论和权限 |
| 协作 | 成员邀请、角色、评论、提及、通知、活动、审计、公开分享、密码、过期和撤销 |
| 账户 | 个人资料、头像、密码、会话、邮箱/验证、工作区、数据导出、删除账户和离线清理 |
| 可靠性 | 离线草稿、冲突双版本、失败 mutation 回滚、上传恢复、队列状态、健康检查和错误 request ID |

完成标准不是“页面可打开”，而是每项能力都有真实的成功和失败测试，并通过权限矩阵验证无权数据不可见。

### 阶段 3：新增高价值功能

在旧功能对齐后增加以下不破坏核心模型的功能：

- 全局命令面板：搜索页面、创建动作、账户设置和最近笔记，支持键盘导航。
- 最近访问与固定工作区：只保存实体 ID 和排序，不缓存敏感正文到 URL。
- 笔记上下文动作：对当前笔记直接分享、查看反向链接、导出、恢复版本和发送到数据库。
- AI 上下文动作：总结当前笔记、提取任务、生成标签建议、改写选中内容；所有动作可预览后写回。
- 导入预览与撤销：导入前显示数量和冲突，失败时保留原文件和操作结果。
- 可恢复的诊断中心：显示失败 OCR、上传、同步和队列任务的重试入口。

### 阶段 4：AI 对话与服务端代理

前端只调用 Worker：

```text
Browser -> POST /api/v2/ai/chat -> Worker AI adapter -> OpenAI-compatible provider
Browser -> GET  /api/v2/ai/status -> Worker capability/status
```

Worker Secret：

- `AI_CHAT_API_URL`
- `AI_CHAT_API_KEY`
- `AI_CHAT_MODEL`

约束：

- API key 只通过 Cloudflare Secret/本地未跟踪 `.dev.vars` 注入，不进入 `wrangler.toml`、Git、前端 bundle、日志或错误消息。
- provider adapter 统一转换请求和响应；provider 不可用时返回稳定错误码 `AI_NOT_CONFIGURED`、`AI_RATE_LIMITED`、`AI_TIMEOUT` 或 `AI_PROVIDER_ERROR`。
- 单次请求限制消息数、总字符数、超时和 workspace/user 额度；写请求携带 idempotency key。
- 默认不把全部笔记自动发送给模型。上下文必须由用户明确选择当前笔记或选中文本，并在发送前显示范围。
- 对话先保存在当前浏览器状态；持久化对话作为后续 additive schema 和权限审计任务，不阻塞基础聊天。

### 阶段 5：流畅性与稳定性

- 首屏只加载当前产品域；数据库、图谱、提醒、AI 和 OCR 使用 lazy chunk。
- GET 只重试网络错误、408、429 和 5xx；写请求没有 idempotency key 时不重试。
- 搜索和列表请求支持取消、去重、stale-while-revalidate 和稳定 cursor。
- 表格、看板、日历和附件列表使用分页、分段或虚拟渲染，避免一次渲染全部记录。
- 统一 mobile scroll owner，修复底部导航、检查器、编辑器工具栏和 safe-area 重叠。
- 通过性能预算限制入口大小，保持 Markdown/OCR/AI 不进入初始 modulepreload。

## 组件与接口边界

- `apps/web/src/navigation/ProductNavigation.tsx`：只负责产品域和高频入口，不承载业务请求。
- `apps/web/src/create/CreateCenter.tsx`：只负责创建动作选择、焦点和错误反馈；动作由 `App` 注入。
- `apps/web/src/account/AccountCenter.tsx`：只负责账户 tab 和子面板编排；profile/security/workspace/privacy 保持独立。
- `apps/web/src/ai/AIChatPanel.tsx`：只负责对话状态和显示；不读取 Secret、不拼 provider URL。
- `apps/worker/src/routes/ai.ts`：认证、workspace 权限、额度、请求校验、超时和错误分类。
- `apps/worker/src/ai/ai-chat-service.ts`：provider-neutral adapter，负责请求转换和响应安全截断。
- `packages/contracts/src/ai.ts`：请求、响应、错误码和消息长度 schema 的唯一来源。
- `apps/web/src/data/api-client.ts`：统一取消、去重、错误分类和 request ID 传播。

## 测试与验收

每个阶段先写失败测试，再写最小实现。最终门禁：

```text
npm run lint
npm run test --workspace @nexus/web
npm run test --workspace @nexus/worker
npx vitest run --config vite.config.ts
npx vitest run --config vitest.worker.config.ts
npm run build
npm run verify:deploy
```

浏览器验收至少覆盖：

- 新用户从空工作区找到创建中心并创建笔记。
- 从左侧和账户菜单打开个人资料，修改显示名并恢复焦点。
- 修改密码、会话撤销、导出和删除账户确认流程。
- 数据库、提醒、导入、分享、附件/OCR 和离线草稿失败恢复。
- AI 未配置、配置成功、超时、限流、上下文范围和重试。
- 390px、键盘弹出、200% 缩放、键盘导航和无权限角色。

## 外部操作边界

- 本设计授权源码、测试和本地验证，不自动配置 Cloudflare Secret，不执行远程 migration、生产部署、域名切换、GitHub push、PR 合并或 tag 创建。
- 生产 AI Secret 需在 Cloudflare 控制台或 Wrangler Secret 中配置；配置完成后再执行线上 AI health 和真实浏览器验收。
- 发布前必须保留旧 Worker、旧 D1 和回滚版本；任何安全、权限、构建或数据恢复门禁失败都停止发布。

## 当前第一批实现顺序

1. 将创建中心和账户中心改为桌面/移动端都明显可见的主入口，并补入口 smoke。
2. 创建旧系统功能对齐矩阵，确认 Beta 已有功能与缺口，禁止遗漏项靠记忆推进。
3. 补齐最影响使用的缺口：导入/提醒入口、笔记到数据库关联、附件插入、离线冲突恢复入口。
4. 在功能矩阵稳定后，增强 AI context actions 和 provider 配置检查。
5. 最后做性能预算、真实浏览器验收和发布准备。
