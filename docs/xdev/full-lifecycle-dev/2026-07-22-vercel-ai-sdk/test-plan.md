# 测试计划：Vercel AI SDK 能力升级

## 静态检查

| 用例 | 测试对象 | 预期 |
|------|----------|------|
| Expo lint | 前端 TS/TSX | 无错误 |
| TypeScript | 全项目 | `tsc --noEmit` 通过 |
| Node 语法检查 | AI 后端 | Node 22 下通过 |
| Docker 构建 | Backend 镜像 | AI SDK 依赖可安装、服务可启动 |

## 流协议

| 用例 | 输入 | 预期 |
|------|------|------|
| 新协议文本流 | `ui-message-v1` 请求头 | 连续解析 `text-delta` |
| 分包 SSE | 单个 JSON 被拆成多个网络 chunk | 缓冲后正常解析 |
| CRLF SSE | `\r\n` 分隔 | 正常解析 |
| 工具状态 | 搜索工具调用与结果 | UI 显示搜索/整理状态 |
| 服务端错误 | `error` chunk | 前端抛出可读错误 |
| 旧协议 | 不传新协议头 | 返回 `chunk/done/error` |
| 客户端断开 | 流中途断开 | 服务端继续消费并结算或可靠释放 |

## 联网搜索

| 用例 | 条件 | 预期 |
|------|------|------|
| 未配置搜索源 | 无 Tavily Key 和 SearXNG URL | capabilities 为 false，前端不可开启 |
| 已配置 SearXNG | 有效内网搜索 URL | capabilities 为 true，可执行搜索 |
| 已配置 Tavily | 有效 API Key | 优先使用 Tavily |
| 搜索工具循环 | 模型请求实时信息 | 产生工具调用和结果后生成带来源的答案 |
| 搜索超时 | 外部接口超时 | 工具返回错误，流不永久挂起 |
| 非法 URL | 搜索返回非 HTTP(S) URL | 结果被过滤 |
| 模型不支持工具 | 上游拒绝 tool call | 返回明确错误并释放额度 |

## Mermaid

| 用例 | 平台 | 预期 |
|------|------|------|
| 合法 flowchart | Web | 渲染 SVG |
| 合法 sequenceDiagram | iOS/Android | WebView 自适应高度 |
| 非 Mermaid fence | 全平台 | 仍按普通代码块显示 |
| 非法 Mermaid | 全平台 | 显示错误和原始文本 |
| 恶意标签 | 原生 | 不突破 CSP，不执行图表内容中的脚本 |

## 回归

| 用例 | 预期 |
|------|------|
| 普通对话 | 不开启搜索时保持原有行为 |
| 多模型切换 | DeepSeek 和 Nitro Router 均可调用 |
| 屏幕知识 | 仍按用户开关决定是否注入 |
| 标题总结 | 首轮对话后继续生成标题 |
| 会话持久化 | 流结束后保存完整回答 |
| 余额不足 | 请求前返回 402，不调用模型 |
