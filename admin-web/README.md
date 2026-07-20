# Astesia Admin Web

独立于 Expo App 的 AI 管理端，可单独构建并部署到任意静态 Web 服务器。

## 本地开发

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

默认访问 `http://127.0.0.1:4173`。

## 生产构建

```bash
VITE_API_BASE_URL=https://astesia.cc pnpm build
```

构建产物位于 `dist/`。生产环境只允许 HTTPS API 地址；HTTP 仅在
`localhost` 或 `127.0.0.1` 本地开发时放行。

## 部署前置

1. 在后端数据库执行 `server/migrations/006_add_ai_admin_controls.sql`。
2. 部署包含管理员接口的 `server/ai-server.mjs`。
3. 确认管理员账号在 `auth_users.role` 中为 `admin`。
4. 将 `dist/` 部署到静态站点，配置 HTTPS。
5. 后端 CORS 应允许管理端域名，并保持 `Authorization`、`Content-Type`、
   `X-AI-User-Id` 请求头可用。

## 验证命令

```bash
pnpm lint
pnpm build
```
