# Nexus Notes 线上联调手册

## Turnstile 检查

1. 打开健康检查接口：
   `GET /api/health/turnstile`
2. 期望返回：
   `{"success":true,"data":{"configured":true,"mode":"always"}}`
3. 如果 `configured` 为 `false`：
   说明 Worker 缺少 `TURNSTILE_SECRET_KEY`
4. 如果前端登录页提示缺少站点密钥：
   说明前端缺少 `VITE_TURNSTILE_SITE_KEY`

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

- 登录时报“人机验证未配置”：
  前端环境变量缺失
- 登录时报“人机验证服务配置异常”：
  Worker 缺少 `TURNSTILE_SECRET_KEY`
- 验证框可见但无法完成：
  主机名白名单或 Turnstile 模式配置异常
- 线上已修复但用户仍看到旧问题：
  先排查浏览器缓存，再排查 Cloudflare 资产缓存

