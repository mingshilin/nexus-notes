# Nexus Notes Preview 验收交接

更新时间：2026-08-28
部署版本：`bcdf6053-25d4-4d55-8112-4936d4414f81`
回滚版本：`5c70961e-e737-4420-b5f9-754222a2ffe1`

## 验收地址

- Preview：<https://nexus-notes-public-beta-preview.shilinming9.workers.dev/>
- Health：<https://nexus-notes-public-beta-preview.shilinming9.workers.dev/api/v2/health>

Preview 使用独立 Worker、D1、R2、Queue 和 Durable Object，不切换生产域名。当前 Preview 的 `AI_ENABLED=false`，AI provider 尚未接入真实配置。

Preview 与生产是两条独立操作路径：Preview 使用独立 D1、R2、Queue 和 Worker；本记录只证明 Preview 门禁，不把 Preview 结果当作生产数据安全或切换证明。生产 Worker 部署、生产 D1 migration、secret 轮换、域名切换、push、PR、merge 和 tag 需要独立记录操作结果。

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
- `npx wrangler d1 migrations apply nexus-notes-public-beta-preview --remote`（`0021` 至 `0024`）
- `npx wrangler d1 execute nexus-notes-public-beta-preview --remote --command "PRAGMA foreign_key_check;"`

`npm run test:load` 读取 `NEXUS_NOTES_BETA_URL`，`--url` 对这个脚本不生效；不要用 `npm run test:load -- --url=...`，那会回退到默认的 `http://127.0.0.1:4173/`。

线上结果：health `status=ok`、OCR `ready`、安全响应头齐全、390px 公共壳无横向溢出、无未命名控件、无运行时错误、初始 preload 不包含 Markdown/OCR/AI chunk；本轮负载为 32 请求、p95 `875ms`。真实认证 AI/导航 smoke 返回 `BLOCKED AUTHENTICATED_PROFILE_UNSET`，因为未配置仓库外 Chrome profile，不视为通过。

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

## 生产操作记录

- 已执行生产 Beta D1 additive migrations `0017` 至 `0024`，并通过外部备份恢复演练和线上外键检查。
- 已部署生产 Worker `modern-notes-saas` 版本 `1c5198ff-7671-4e97-9c1a-1e9dc3c131cc` 到 `https://notes.msl88ljctengxun.xyz/`，旧版本 `03d67b5b-0e32-4210-94df-6a34097a8ad7` 保留回滚。
- 已推送 GitHub 分支并创建 <https://github.com/mingshilin/nexus-notes/pull/10>；PR 当前等待 `verify` CI，尚未合并。
- 生产 secret 未轮换，现有 secret 仅通过 Cloudflare Secret 保留；AI 仍为 `AI_ENABLED=false`，真实 provider 未配置。

仍未完成的发布动作是 PR 合并和 `v1.1.0` tag；它们必须等 CI 绿灯后执行。本文件记录的是已发生的操作，不替代 GitHub 或 Cloudflare 的实际状态。
