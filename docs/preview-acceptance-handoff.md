# Nexus Notes Preview 验收交接

更新时间：2026-08-25
部署版本：`30d3304b-002a-4213-8d2f-3895eb9be493`

## 验收地址

- Preview：<https://nexus-notes-public-beta-preview.shilinming9.workers.dev/>
- Health：<https://nexus-notes-public-beta-preview.shilinming9.workers.dev/api/v2/health>

Preview 使用独立 Worker、D1、R2、Queue 和 Durable Object，不切换生产域名。当前 Preview 的 `AI_ENABLED=false`，AI provider 尚未接入真实配置。

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
- `npm run test:load -- --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/`

线上结果：health `status=ok`、OCR `ready`、安全响应头齐全、390px 公共壳无横向溢出、初始 preload 不包含 Markdown/OCR/AI chunk，负载 p95 为 19ms。

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
