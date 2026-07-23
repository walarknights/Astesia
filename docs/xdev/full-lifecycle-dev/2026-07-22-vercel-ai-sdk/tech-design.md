# 技术方案：Vercel AI SDK 能力升级

## 组件树

```text
AiFloatingAssistant
├── Markdown
│   └── MermaidDiagram
├── WebSearchToggle
└── requestAiAssistantReply
    └── expo/fetch
        └── AI SDK UI Message Stream parser

Hono /api/ai/chat
├── auth / model switch / wallet reservation
├── streamText
│   ├── OpenAI-compatible chat provider
│   └── web_search tool (optional)
│       ├── Tavily (configured first)
│       └── SearXNG (internal fallback)
├── usage settlement
└── UI Message Stream or legacy SSE response
```

## 数据流

1. 前端从 `/api/ai/models` 读取模型和 `capabilities.webSearch`。
2. 用户主动开启联网搜索后，请求体携带 `webSearch: true`。
3. 服务端完成鉴权、模型启用校验和额度预留，再调用 `streamText`。
4. 模型按需执行 `web_search`，SDK 最多运行四个步骤并生成最终文本。
5. 新客户端消费 `text-delta`、工具状态、错误和计费数据；旧客户端消费兼容 SSE。
6. AI SDK 汇总 usage 后完成钱包结算，流异常则释放 reservation。

## 流协议

- 请求头：`X-AI-Stream-Protocol: ui-message-v1`
- 响应头：`x-vercel-ai-ui-message-stream: v1`
- 文本：`text-delta`
- 工具：`tool-input-available`、`tool-output-available`、`tool-output-error`
- 错误：`error`
- 计费：`data-billing`
- 结束：`finish` 与 `[DONE]`

客户端解析器同时接受现有 `event: chunk/done/error` 格式，便于灰度期间回滚服务端。

## 联网搜索

- 开关：请求体 `webSearch`
- 服务端能力：`Boolean(TAVILY_API_KEY || AI_WEB_SEARCH_SEARXNG_URL)`
- 工具名：`web_search`
- Schema：`query`、可选 `topic`、可选 `timeRange`
- 限制：查询最长 300 字符，最多 5 条结果，基础搜索，不返回原始网页正文
- 超时：12 秒
- 输出：标题、URL、摘要、相关度、发布时间
- 生产部署：SearXNG 仅暴露在 Compose 内网，固定镜像 digest，并启用安全搜索和 JSON 输出
- 选择顺序：配置 Tavily 时优先调用 Tavily，否则调用内网 SearXNG

## Mermaid

- 输入：Markdown fence 的 `sourceInfo` 为 `mermaid`
- Web：动态导入 `mermaid`，`securityLevel: strict`
- Native：WebView 加载固定 jsDelivr Mermaid 脚本，CSP 仅放行该脚本域名和内联样式
- 降级：语法错误或脚本加载失败时展示错误与原始 Mermaid 文本

## 计费与容错

- reservation 仍在上游请求前创建。
- `onEnd` 使用所有步骤的聚合 usage 结算，搜索导致的多步模型调用会被完整计费。
- `onError`、`onAbort` 和无有效文本时释放 reservation。
- `consumeSseStream` 保持独立消费分支，客户端断开不会让已产生的上游成本漏记。
- 流设置总超时、单步超时、分片静默超时和工具超时。

## Figma 节点映射

未从需求源中发现 Figma 设计稿链接。本次仅复用现有 AI 抽屉样式，不新增页面结构。

## 代码落点

- `server/ai-server.mjs`
- `services/ai-assistant.ts`
- `components/AiFloatingAssistant.tsx`
- `components/MermaidDiagram.tsx`
- `components/MermaidDiagram.web.tsx`
- `.env.example`
- `docker-compose.yml`
- `docker/Dockerfile.backend`
- `docker/searxng/settings.yml`
