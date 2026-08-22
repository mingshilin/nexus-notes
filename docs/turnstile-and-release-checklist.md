# Nexus Notes 线上联调手册

## Turnstile 检查

1. 打开 Beta 健康检查接口：
   `GET /api/v2/health`
2. 期望返回 `success: true`，并确认前端构建包含 `VITE_TURNSTILE_SITE_KEY`。
3. Worker 必须通过 Wrangler Secret 配置 `TURNSTILE_SECRET_KEY`；不要写进 TOML、Git 或前端 bundle。
4. 如果前端登录页提示缺少站点密钥：
   说明前端缺少 `VITE_TURNSTILE_SITE_KEY`

## 邮件验证码检查

1. `EMAIL_FROM` 必须使用 Resend 已验证域名的发件地址，例如：
   `Nexus Notes <noreply@msl88ljctengxun.xyz>`
2. `onboarding@resend.dev` 仅适合 Resend 账户所有者的测试投递，不能作为面向任意用户的 Beta 发件人。
3. Worker 必须通过 Wrangler Secret 配置 `RESEND_API_KEY`；注册后可从 Preview tail 看到脱敏的 `email.delivery` 状态。
4. 收到 `200` 仍需检查收件箱、垃圾邮件和 Resend 投递日志；不要在日志或 D1 中保存验证码明文。

## Cloudflare 主机名检查

1. Turnstile 小组件中必须加入：
   `notes.msl88ljctengxun.xyz`
2. 如果登录页只出现空白验证区域：
   通常是站点密钥与主机名白名单不匹配
3. 调整白名单后，重新部署前端并清浏览器缓存

## 发布后缓存检查

1. 桌面浏览器执行强制刷新：
   `Ctrl + F5`
2. 手机浏览器如果仍看到旧页面：
   清理站点缓存后重新打开
3. 如果代码已部署但页面没更新：
   先确认自定义域名命中的确实是最新 Worker 版本

## 自定义域检查

1. 当前正式域名：
   `https://notes.msl88ljctengxun.xyz/`
2. 发布成功后检查：
   首页返回 `200`
3. 若自定义域异常，再回退检查：
   `workers.dev` 预览地址是否正常

## 常见故障判断

- 注册时报“人机验证未配置”：
  前端环境变量缺失
- 注册时报“人机验证服务配置异常”：
  Worker 缺少 `TURNSTILE_SECRET_KEY`
- 验证框可见但无法完成：
  主机名白名单或 Turnstile 模式配置异常
- 人机验证成功但注册返回 500：
  检查 Preview tail 中是否出现 `auth.stage_failure`；若是 `send_verification_email`，先检查 `EMAIL_FROM` 是否为已验证域名。
- 线上已修复但用户仍看到旧问题：
  先排查浏览器缓存，再排查 Cloudflare 资产缓存
