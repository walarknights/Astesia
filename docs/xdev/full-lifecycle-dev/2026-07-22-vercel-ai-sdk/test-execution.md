# 测试执行记录：Vercel AI SDK 能力升级

## 自动检查

| 检查项 | 命令 | 结果 |
|--------|------|------|
| TypeScript | `pnpm exec tsc --noEmit` | 通过 |
| ESLint | `pnpm lint` | 通过 |
| Diff 格式 | `git diff --check` | 通过 |
| Node 22 语法 | `npx -y node@22 --check server/ai-server.mjs` | 通过 |
| Web 生产导出 | `pnpm exec expo export --platform web` | 通过 |
| Android Bundle | `pnpm exec expo export --platform android` | 通过 |

## 后端运行验证

使用 Node `v22.23.1` 启动 `server/ai-server.mjs`：

| 场景 | 预期 | 实际 | 状态 |
|------|------|------|------|
| `GET /health` | 返回 `{"ok":true}` | 符合 | 通过 |
| 未登录调用 `/api/ai/chat` | 返回 401 | 符合 | 通过 |
| 新流协议 CORS 预检 | 放行 `x-ai-stream-protocol` | 符合 | 通过 |
| AI SDK 搜索工具循环 | 模型调用搜索并引用结果 | 2 次工具调用，返回官方来源 | 通过 |
| AI SDK UI Message Stream | 正文和 usage 可消费 | 文本与 64 tokens usage 完整 | 通过 |

## 生产环境验证

| 场景 | 实际 | 状态 |
|------|------|------|
| Backend Docker 构建 | Node 22 镜像成功安装并导入 AI SDK 依赖 | 通过 |
| SearXNG 搜索 | 返回 OpenRouter 2026-05-07 官方公告首条结果 | 通过 |
| 容器健康检查 | `web`、`backend`、`searxng`、`akshare` 均 healthy | 通过 |
| 公网健康检查 | `https://astesia.cc/health` 返回 200 | 通过 |
| 模型能力接口 | 25 个模型，`capabilities.webSearch: true` | 通过 |
| 未登录聊天保护 | 联网搜索请求返回 401 | 通过 |

## 浏览器验证

| 场景 | 预期 | 实际 | 状态 |
|------|------|------|------|
| 首页加载 | 页面可用 | 符合 | 通过 |
| 打开 AI 助手 | 抽屉打开 | 符合 | 通过 |
| 联网搜索入口 | 工具栏出现可访问的 switch | 符合 | 通过 |
| Mermaid Web 构建 | Mermaid 按需分包 | 生成 Mermaid 主包和图表类型分包 | 通过 |

## 未执行项

- 真实 AI 文本流与钱包结算：本地没有可用的登录用户和隔离测试数据库，未调用生产计费链路。
- 真实 Tavily 搜索：生产环境使用 SearXNG，当前未配置 `TAVILY_API_KEY`。
- 原生 WebView 实机渲染：Android Bundle 已通过，仍需真机验证 CDN 网络与动态高度。

## 已知残余

- 静态 Web 页面控制台存在 React hydration `#418` 和 Expo Animated Web 警告；本次功能未依赖这些路径，建议单独排查。
- Mermaid Web 端按需加载仍会生成较多图表类型分包，但不会全部进入首屏主包。
- 搜索结果依赖公开搜索引擎可用性；Tavily 可作为后续的托管搜索覆盖。
