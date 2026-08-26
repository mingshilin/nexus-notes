# Nexus Notes Preview 验收交接

更新时间：2026-08-25
部署版本：`30d3304b-002a-4213-8d2f-3895eb9be493`

## 验收地址

- Preview：<https://nexus-notes-public-beta-preview.shilinming9.workers.dev/>
- Health：<https://nexus-notes-public-beta-preview.shilinming9.workers.dev/api/v2/health>

Preview 使用独立 Worker、D1、R2、Queue 和 Durable Object，不切换生产域名。当前 Preview 的 `AI_ENABLED=false`，AI provider 尚未接入真实配置。

Preview 与生产是两条独立授权路径：Preview 只允许本地 lint/test/build/perf/load、独立 Preview URL 的 online readiness，以及仓库外认证浏览器 smoke；生产 Worker 部署、生产 D1 migration、secret 轮换、域名切换、push、PR、merge 和 tag 都必须单独审批，不能由 Preview gate 代签。

## 已完成门禁

- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run beta:test`
- `npm run beta:build`
- `npm audit --omit=dev`
- `npm run verify:deploy`
- `node scripts/verify-deploy-readiness.mjs --dist=apps/web/dist --online --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/`
- `npm run test:browser-shell -- --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/`
- `NEXUS_NOTES_BETA_URL=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/ npm run test:load`
- PowerShell: ``$env:NEXUS_NOTES_BETA_URL='https://nexus-notes-public-beta-preview.shilinming9.workers.dev/'; npm run test:load``

`npm run test:load` 读取 `NEXUS_NOTES_BETA_URL`，`--url` 对这个脚本不生效；不要用 `npm run test:load -- --url=...`，那会回退到默认的 `http://127.0.0.1:4173/`。

线上结果：health `status=ok`、OCR `ready`、安全响应头齐全、390px 公共壳无横向溢出、初始 preload 不包含 Markdown/OCR/AI chunk；本轮 `NEXUS_NOTES_BETA_URL=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/ npm run test:load` 的负载 p95 为 `811ms`。

性能门禁以 `test:browser-shell` 和 `test:load` 的实际结果为准；前者只验证 390px 公共壳和可访问性壳，后者只做无状态读请求，不写数据、不使用生产资源。

## 用户验收顺序

1. 打开 Preview，验证注册/登录、个人资料、账户安全、工作区切换和退出恢复。
2. 验证创建笔记、编辑/自动保存、附件、标签、文件夹、搜索、分享和回收站恢复。
3. 验证数据库的属性、表格/看板/日历、模板、CSV 预览与权限拒绝。
4. 验证提醒分组、重复规则、稍后提醒和通知设置。
5. AI provider 配置完成后，再验证 AI 连接测试、聊天、笔记摘要和失败恢复。

## 认证浏览器要求

真实认证 smoke 只能使用仓库外的 Chrome profile：

```powershell
$env:NEXUS_NOTES_BETA_USER_DATA_DIR = "D:\path\outside\repository\authenticated-profile"
$env:NEXUS_NOTES_BETA_AVATAR_FILE = "D:\path\outside\repository\avatar.png"
npm run test:e2e -- --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/
npm run test:a11y -- --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/
```

不要把密码、验证码、reset token、session cookie、浏览器 profile、D1/R2 导出或 AI key 放进仓库。

## 尚未执行的高风险动作

- 生产 Worker 部署、生产 D1 migration、secret 轮换和域名切换。
- GitHub push、发布 PR、合并、创建 `v1.1.0` tag。

上述动作需要单独明确授权，并在最终备份、恢复演练和回滚责任人确认后执行。
