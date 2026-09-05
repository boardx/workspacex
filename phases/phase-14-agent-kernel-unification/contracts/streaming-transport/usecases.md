# 契约束 `streaming-transport` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖 `domain.md`。翻译自 `requirements/02-streaming-transport.md`
> R3/R4/R6/R9，不发挥。对应 `packages/contracts/src/streaming-transport.ts`。

## 统一失败枚举

```
StreamingTransportError
  MESSAGE_NOT_VISIBLE   调用者对该消息/线程无可见权（委托上游 chat/identity 判定）
```

WebSocket 订阅本身不返回传统 HTTP 错误码，断线/重连的失败态由 `ReconnectState`
（`reconnecting`/`restored`/`failed`）在前端呈现，见下方 UC-1 说明。

## UC-1 `subscribeRunEvents` —— 订阅内核事件（WebSocket）

```
in:  { runId, lastKnownSeq }
out: KernelStreamEvent（流式推送，非单次响应）
pre: 调用者对该 run 可见（委托上游判定）
err: 无显式 err（连接层失败通过 ReconnectState 呈现，不是本操作的返回值）
```

失败模式：
- **E2 连接异常断开**：前端在有限次数内自动重连（`data-state="reconnecting"`）；
  重连成功后从 `lastKnownSeq` 补发断点之后的事件，无损接续（不丢不重复，I-4）；
  重连持续失败后进入 `failed` 态，前端提示"连接中断，请手动刷新"（不无声停留在
  旧状态）。
- **E3 内核无响应**：网关侧超时判定机制将 run 标记为 `failed` 终态（而非让 run
  无限期停留在 `running`），前端据此结束订阅。
- **E1（本 phase 触发 bug 回归用例）**：run 停在 `awaiting_tool_permission`/
  `awaiting_plan_confirmation`/`paused` 任一非终态时，刷新页面重新订阅后必须在
  5 秒内渲染对应可交互 UI，绝不能停留在无操作可做的纯 loading（R12 验收线索）。

## UC-2 `listRunAttemptsForMessage` —— 一条消息的全部续跑记录（F05）

```
in:  { messageId }
out: { attempts: AgentRunAttempt[] }
pre: 调用者对该消息可见
err: MESSAGE_NOT_VISIBLE
```

失败模式：
- `MESSAGE_NOT_VISIBLE`：不属于调用者可见范围的消息。

## 跨束委托（不在本束实现，只调用）

- 消息/线程可见性判定 → 上游 `chat`/`identity` 束。
- `forwardRun`（run 的发起）→ `kernel-gateway` 束；本束只负责该 run 产生之后的
  事件转发与状态机定义。
- `plan_update` 事件负载复用 `agui-state-events.ts` 的 `AguiTodosSnapshot`，
  不重新定义 todo 快照形状。
