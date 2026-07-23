# PRD 摘要：Vercel AI SDK 能力升级

## 需求背景

将现有手写 OpenAI 兼容请求与 SSE 转发迁移到 Vercel AI SDK，并补充可选联网搜索、Mermaid 图表和更可靠的跨端流式响应。

## 来源信息

- Meego：无
- PRD：用户直接描述
- 技术文档：未从需求源中发现独立技术文档链接
- 设计稿：未从需求源中发现 Figma 设计稿链接

## 功能清单

| 功能 | 优先级 | 状态 | 备注 |
|------|--------|------|------|
| AI SDK `streamText` 接入 | P0 | 已实现 | 保留现有多模型、鉴权与计费 |
| AI SDK UI Message Stream | P0 | 已实现 | 使用标准 SSE 数据流协议 |
| Expo 原生流式读取 | P0 | 已实现 | 使用 `expo/fetch`，移除 XHR 增量解析 |
| 联网搜索工具 | P0 | 已实现 | 通过 SDK `tool()` 接入 SearXNG，Tavily 可选 |
| Mermaid 图表渲染 | P0 | 已实现 | 支持 Web 和 iOS/Android |
| 老客户端流协议兼容 | P1 | 已实现 | 未声明新协议时返回旧 SSE |

## 技术方案

- 后端使用 `@ai-sdk/openai` 的 OpenAI Chat 兼容模式接入 DeepSeek 与 Nitro Router。
- 联网搜索采用服务端 `web_search` 工具。生产环境使用内网 SearXNG；配置 `TAVILY_API_KEY` 时优先使用 Tavily。
- 新客户端发送 `X-AI-Stream-Protocol: ui-message-v1`，服务端返回 AI SDK UI Message Stream；旧客户端继续接收 `chunk/done/error` SSE。
- 计费在 AI SDK `onEnd` 中按聚合 usage 结算；异常时释放预留额度；独立消费 SSE 分支保证客户端断开后仍能完成结算。
- Mermaid 通过 Markdown fence 规则识别。Web 端本地渲染，原生端在受限 WebView 中渲染。

## API 接口

| 接口 | 方法 | 状态 | Mock |
|------|------|------|------|
| `/api/ai/models` | GET | 已存在，扩展 capabilities | 不需要 |
| `/api/ai/chat` | POST | 已存在，升级流协议 | 不需要 |
| `http://searxng:8080/search` | GET | 内网搜索依赖 | 不需要 |
| `https://api.tavily.com/search` | POST | 可选外部依赖 | 不需要 |

## 深链参数

本需求不新增页面或深链参数。

## 仓库落点

- 主仓库：`my-app`
- 后端：`server/ai-server.mjs`
- 客户端服务：`services/ai-assistant.ts`
- 对话 UI：`components/AiFloatingAssistant.tsx`
- Mermaid：`components/MermaidDiagram.tsx`、`components/MermaidDiagram.web.tsx`

## 关键决策

- 不整体替换现有会话状态为 `useChat`：当前会话持久化、标题总结和计费上下文较多，直接迁移会扩大回归面。
- 不依赖单一模型厂商的原生搜索：当前模型来自两个 OpenAI 兼容渠道，自定义 SDK 工具可以跨模型工作。
- 联网搜索默认关闭：搜索会产生额外外部请求和上下文成本，必须由用户主动开启。
