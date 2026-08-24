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
    { role, content }[], forwardedProps?: { chatThreadId?: string } }`，只读
    最后一条 `role === "user"` 的消息。`forwardedProps.chatThreadId` 是
    DA-19a（2026-08-24）新增字段，见下方"续聊语义"。
- **出参**：`text/event-stream`，帧为 `data: <json>\n\n`，`json.type` 取
  `@ag-ui/core` 的 `EventType` 枚举值，序列固定为：
  `RUN_STARTED → [CUSTOM chat_thread_id]? → TEXT_MESSAGE_START →
  TEXT_MESSAGE_CONTENT → TEXT_MESSAGE_END → RUN_FINISHED`（成功）或单条
  `RUN_ERROR`（失败/超时）。`CUSTOM chat_thread_id` 紧跟在 `RUN_STARTED` 之后
  写出——真实 `@ag-ui/client` `HttpAgent` 要求首个事件必须是 `RUN_STARTED`
  （协议校验器，非本仓自定规则），只在真正走到 `onStarted` 的成功路径上出现。
- **`threadId`/`runId` 语义**：请求体里的两个 id 是 AG-UI 客户端侧的关联 id，
  原样回显在事件里；与本仓 Chat 的 `chat_threads.id` **无关**（AG-UI 协议命名
  空间的 id 与本仓 Chat 线程 id 刻意不复用同一个字段，见控制器文件头）。
- **续聊语义（DA-19a，2026-08-24 落地，回收下方 §2 的裁决点）**：桥接端点默认
  仍是"每轮开一条新个人线程"；调用方要延续同一条 Chat 线程时，把上一轮
  `CUSTOM chat_thread_id` 事件里学到的值原样传回 `forwardedProps.chatThreadId`。
  这不是一张新的客户端 id → 服务端 id 映射表——`forwardedProps.chatThreadId`
  **就是**本仓 Chat 的 `chat_threads.id` 本身，直接复用 `runAguiBridgeTurn`
  早就支持的 `AguiBridgeInput.threadId` 复用通路（`resolveThreadId`），控制器
  只是把它从"永远传 null"改成"读请求体这个字段"。同一个 Chat 线程 id 也会让
  `deep-agent-model-provider.ts` 的 `deriveRemoteThreadId` 决定性推出同一个
  远端 deep-agent 线程——底层 agent 真的记得上一轮，不只是本仓自己多存一行。
- **单轮范围**：不引入多步编排、不做逐 token 真流式（当前 `execute-run.ts`
  是一次性模型调用，桥接端点一次性吐出整段回复）。

## 实现锚点

- `apps/api/src/interface/controllers/copilotkit-agui.controller.ts`
- `apps/api/src/application/agent-run/agui-bridge.ts`
- `apps/web/components/chat/copilotkit-preview-panel.tsx`（DA-19a 起的唯一
  真实调用方——发 `forwardedProps.chatThreadId`，订阅 `onCustomEvent` 学习它）
- 测试：`apps/api/tests/agent-runtime/agui-bridge-sse.test.ts`、
  `apps/web/tests/session/copilotkit-agui-httpagent.test.ts`

## 待人类裁决的点（补签时一并过）

1. `agentId` 显式必填是否是长期形状，还是应该等"列出 agent 目录"路由补上后
   收敛成下拉（与 `personal-chat-screen.tsx` 的已知缺口是同一个决策）。
2. ~~桥接端点"每轮开一条新个人线程"是否要在阶段 2 收敛成"同一 AG-UI 会话
   复用同一条 Chat 线程"~~ —— **DA-19a（2026-08-24）已落地**：调用方可选传
   `forwardedProps.chatThreadId` 延续；不传时行为与之前逐字一致（默认仍新建）。
   不是一张新映射表，见上方"续聊语义"。此点从"待裁决"改为"已实现，待人类
   确认长期默认值要不要从'不传=新建'翻成'前端记住上一条线程自动带'"。
3. 事件形状是否要正式收进 `packages/contracts/src/`（当前只在 controller
   docblock + 本文件登记，未建 zod 契约）。
