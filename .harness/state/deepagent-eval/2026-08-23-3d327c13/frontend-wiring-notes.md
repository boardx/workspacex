# 生产前端对 messages/updates stream_mode 的消费情况（本会话 Explore 子代理核实，2026-08-23）

结论：deep-agent-service 的 `messages`（token delta）与 `updates`（逐节点/逐中间件，
含 `tools` 节点的独立 `ToolMessage`）两种 stream_mode，engine 层真实存在（见
`sse-and-thread-state-evidence-v2/01-sse-stream.txt`），但生产链路只**部分**用到：

## 文本 token 级流式（D3）——真实到达生产前端

- `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts:633`：
  `stream_mode: ["messages-tuple"]`——只请求 messages，不请求 updates。
- `onDelta`（同文件 ~291-297）把 messages 流里的文本 chunk 转成
  `apps/api/src/interface/controllers/agent-run.controller.ts` 的
  `/agent-runs/:runId/stream`（自定义 SSE，非 AG-UI）`{type:"delta",text}` 帧。
- `apps/web/lib/agent-run-stream.ts` 消费这些帧，`chat-live-message-panel.tsx:1382-1409`
  的 `streamingText` 状态逐块 append 并渲染——**生产聊天界面确实实时、逐块渲染文本**，
  不是终态一次性打包。

## 工具调用独立事件（D2）——engine 有，生产链路未使用，仍是「事后完整记录」

- 全仓 grep `stream_mode`/`"updates"` 只在 deep-agent-service 自己的探针脚本里出现；
  `apps/api` 从未请求 `updates` stream_mode，因此从未收到 `tools` 节点的独立
  `ToolMessage` 事件。
- `apps/api` 的工具调用可见性是靠在 `messages` 流里发现某个 chunk 带
  `tool_call_id` 后，回头 `GET /threads/:id/state` 整份重读（
  `deep-agent-model-provider.ts` 90-95、387-450 一带的 `tryStreamRun`/
  `emitNewToolEvents`/`extractToolCallEvents`），且**必须等到该 tool_call 的
  `AIMessage.tool_calls[]` 和对应 `ToolMessage` 都齐了才上报一次**——是一次性、
  已完成的事后记录，不是「开始/参数流式/结果」的独立递增事件。
- `apps/api/src/interface/controllers/copilotkit-agui.controller.ts:164-205`
  （`writeToolCallStep`）把已完成的 `RunStepPublic` 拆成固定顺序的
  `TOOL_CALL_START → ARGS → END → RESULT` 一次性写完，同样是对一个已完结 step
  的事后展开，不是活体递增；且这条 AG-UI 端点只被 `copilotkit-preview-panel.tsx`
  （独立预览页 `/chat/copilotkit-preview`）消费，不是生产聊天主链路。
- 生产聊天的工具链展示组件 `apps/web/components/chat/agent-tool-chain.tsx`
  读的是轮询来的 `/agent-runs/:runId` 全量 `steps` 快照（values 风格），默认折叠、
  一行摘要（"思考了 X 秒 · 调用了 N 个工具"），同样是事后完整记录。

## 结论对 D2/D3 打分的含义

- **D3**：engine 层（`01-sse-stream.txt` 时间戳，见
  `delta-and-tool-event-extraction.txt`）+ 生产前端渲染，两头都证实了真实、
  有意义粒度的增量流式——命中 1.0 档「模型 token 逐 delta 流出，事件时间戳证明
  逐步」。
- **D2**：engine 原生具备「每次调用独立事件」的能力（`tools` 节点更新事件，
  每条带 `tool_call_id`/`name`/`content`/`status`，见
  `delta-and-tool-event-extraction.txt` 里 `TOOL_EVENT ...` 行），但生产
  `apps/api` 从未请求/使用这个 stream_mode，最终交付给用户的仍是「事后可见完整
  调用记录，过程中不可见」——精确命中 rubric 0.3 档原文。engine 能力是真的，
  只是没有被接进产品——这是与上一轮（判「engine 本身都没有独立事件」）不同的
  结论，但落到 rubric 打分上，0.3 档位不变，只是证据更准确、原因更明确。
