# 契约 delta（待签核）—— AG-UI SSE 桥接端点

> ⚠ 本文件是 **ADR-023 contract-delta 登记**，不是签核。`design-signoff.md` 的
> `covers:`/`status:` 一个字没动——那是人类专属的动作。这里只是把最小契约面
> 写下来、挂上待签核标记，供后续正式签核回收，不阻塞 #654 阶段 1b 开工
> （人类在 issue #654 的直接裁决第 3 条：新契约操作可先写最小定义登记，不用
> 等完整 signoff）。

## 端点

`POST /copilotkit/agui`

## 状态

🟡 **待人类补签**，参照 #519 `retryAgentRun` 先例（同一份裁决权威见
`apps/api/src/interface/controllers/agent-run.controller.ts` 文件头）。

## 最小定义

- **鉴权**：与本仓其余路由一致，`Authorization: Bearer <token>` → `CurrentPrincipal()`。
- **入参**：
  - Query `agentId`（必填，字符串）—— 目标 Agent 的已发布 id。本仓没有挂载任何
    "列出组织 agent 目录" 的路由（见 `apps/web/components/chat/
    personal-chat-screen.tsx` 文件头，同一个已如实暴露的既有缺口），所以这里
    要求调用方显式传入，不发明一个"默认 agent"。
  - Body：AG-UI `RunAgentInput` 的最小切片 `{ threadId?, runId?, messages:
    { role, content }[] }`，只读最后一条 `role === "user"` 的消息。
- **出参**：`text/event-stream`，帧为 `data: <json>\n\n`，`json.type` 取
  `@ag-ui/core` 的 `EventType` 枚举值，序列固定为：
  `RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT → TEXT_MESSAGE_END
  → RUN_FINISHED`（成功）或单条 `RUN_ERROR`（失败/超时）。
- **`threadId`/`runId` 语义**：请求体里的两个 id 是 AG-UI 客户端侧的关联 id，
  原样回显在事件里；与本仓 Chat 的 `chat_threads.id` **无关**——桥接端点内部
  每次调用都开一条新的个人线程（单轮范围，见 issue #654 裁决第 2 条）。
- **单轮范围**：不引入多步编排、不做逐 token 真流式（当前 `execute-run.ts`
  是一次性模型调用，桥接端点一次性吐出整段回复）。

## 实现锚点

- `apps/api/src/interface/controllers/copilotkit-agui.controller.ts`
- `apps/api/src/application/agent-run/agui-bridge.ts`
- 测试：`apps/api/tests/agent-runtime/agui-bridge-sse.test.ts`、
  `apps/web/tests/session/copilotkit-agui-httpagent.test.ts`

## 待人类裁决的点（补签时一并过）

1. `agentId` 显式必填是否是长期形状，还是应该等"列出 agent 目录"路由补上后
   收敛成下拉（与 `personal-chat-screen.tsx` 的已知缺口是同一个决策）。
2. 桥接端点"每轮开一条新个人线程"是否要在阶段 2 收敛成"同一 AG-UI 会话
   复用同一条 Chat 线程"（需要一个客户端 threadId → 服务端 threadId 的映射，
   本阶段刻意不做）。
3. 事件形状是否要正式收进 `packages/contracts/src/`（当前只在 controller
   docblock + 本文件登记，未建 zod 契约）。
