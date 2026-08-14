# 原始需求（细化）— UC-8.8 对话进行中 run 断线重连与发送重试（参照 Claude Code）

> 所属：阶段一 · 能跑完一场项目 / M8 Chat
> 来源：人类 2026-08-14 原话「加入一个需求到 chat，模仿 claude code，在新建一个 chat 之后，
> 这个 chat 的对话的 AI 调用和生成应该是在后台处理，前端可以切换可以刷新不会影响结果不会
> 丢失数据。如果 chat 提交 request 以后，网络中断，系统会重复测试 10 次，如果还连不上则
> 出现超时的错误。」

> 口径（四标记）：本 UC 无 `[原型]`（沿用现有对话面板，不新增界面骨架，仅新增/调整状态提示）。
> 行为为 **[Backlog]**（人类原话直接下发），尚未经契约束签核，**不可开工**，需先过
> `contracts/chat/design-signoff.md` 补签。

## ⚠ 调研已确认：本 UC 只补两个真实缺口，不要重复已实现的部分

实测基于 origin/main（2026-08-14）：

- **AI 调用/生成已经是后台处理，与本 UC 无关，不要重新要求"改成后台化"**：
  `POST /chat/threads/:threadId/messages`（`chat.controller.ts`）已经是 202 Accepted +
  `runStatus: "queued"`，真正执行在后台 tick worker（`agent-run-executor.ts`）里认领
  `queued` run 并推进，**完全不依赖前端连接存活**；流式 delta 落库持久化，SSE/轮询都只是
  只读 relay，断开不会中断 run。这块已经做到，人类原话里"AI 调用和生成应该是在后台处理"
  这句话描述的行为，**已经是现状**，本 UC 不重复实现。
- **最终回复结果不会丢**：助手回复是持久消息行，切回线程重新拉取消息列表就能看到已完成的
  回复，不会因为切走/刷新而丢失数据。
- 真正没做到的是下面两条——**这才是本 UC 的范围**。

## R1 概览（Use Case 名称 / Actor / 目标 / 系统边界）

- **Use Case ID / 名称**：UC-8.8 / 对话进行中 run 断线重连与发送重试
- **Actor**：对话参与者（人类用户）；系统（前端对话面板、后端已有 run 状态机）。
- **目标**：
  1. 打开/切回/刷新一个线程时，若该线程存在仍处于 `queued`/`running`/`writeback_pending`
     的 in-flight run，前端能**自动发现并续上**对它的观察（轮询或 SSE），不需要用户手动
     重新触发才能看到后续进展与最终回复。
  2. 提交消息（`POST /messages`）时若遇到网络中断/瞬时失败，前端自动重试**最多 10 次**
     （需要退避策略，不是无间隔连打），全部失败后进入一个明确的**超时错误**状态提示用户，
     而不是当前这种一次失败就直接停在 `submitFailure` 且不重试。
- **系统边界**：`apps/web/components/chat/chat-live-message-panel.tsx`（换线程 reset 逻辑、
  `submit()`、轮询/SSE effect）；`apps/web/lib/api-client.ts`（`apiRequest` 的重试/超时策略，
  这是全 web 共享的基础设施热点，改动影响所有调用方，需要独立评审）。**不改后端**：
  `agent-runtime` 束的 run 状态机、`queued/running/...` 状态、`REQUEST_TIMEOUT`/
  `DEPENDENCY_UNAVAILABLE` 错误码已存在，本 UC 复用、不重新定义（同一事实不得声明两处）。
- **核心数据对象**：`AgentRunView`（run 状态、`steps`）、`clientMessageId`（既有幂等键，
  重试必须复用它，不能因为重试而产生重复消息）、`ThreadMessage` 列表（用于回推 in-flight
  run）。

## R2 前置条件 / 触发条件

- **前置条件**：线程消息列表接口（`GET /chat/threads/:threadId/messages` 或等价读侧）已能
  返回消息关联的 `agentRunId`；`GET /agent-runs/:runId` 轮询/SSE 已存在（`agent-run.ts`/
  `agent-run-stream.ts`）。
- **触发条件 A（缺口 A：断线重连）**：用户打开一个线程 / 从别的线程切回 / 刷新页面。
- **触发条件 B（缺口 B：发送重试）**：用户点击发送，`POST /messages` 请求失败（网络中断、
  超时、5xx 等可重试类错误——参照 `agent-runtime` 束已定义的 `REQUEST_TIMEOUT`/
  `DEPENDENCY_UNAVAILABLE` 语义判断"可安全重试"，不是所有失败都重试，例如 4xx 校验错误
  不应重试）。

## R3 主流程（编号步骤）

### 缺口 A：断线重连（in-flight run 自动续观察）

1. **系统处理（发现）**：线程消息页加载完成后，从返回的消息/线程状态里判断是否存在一个
   `agentRunId` 指向仍处于非终态（`queued`/`running`/`writeback_pending`）的 run
   （具体判定方式：读该 run 的当前状态，或线程侧直接暴露 `activeRunId` 字段——两种实现
   路径均可，落地时二选一并在 usecases.md 写清楚，不在本 UC 预先绑死）。
2. **系统处理（续接）**：若存在，自动对该 `runId` 续上观察（轮询或 SSE，复用既有
   `openAgentRunStream`/轮询逻辑，不重新发明一套），行为等价于"用户刚提交完这条消息"那一刻
   的观察状态——即数据格式不变，只是**恢复观察时机**这一件事，不改变现有终态判定/写回逻辑。
3. **系统响应**：用户看到该 run 的实时进度（流式 token / 工具调用链）与最终回复自动出现，
   不需要手动刷新第二次。

### 缺口 B：发送重试（网络中断自动重试 + 超时错误态）

4. **系统处理（首次尝试）**：用户点击发送，`clientMessageId` 生成（幂等键，与现状一致），
   发起 `POST /messages`。
5. **系统处理（重试判定）**：若请求失败且判定为"可安全重试"类错误（网络层失败、超时、
   `DEPENDENCY_UNAVAILABLE`），进入重试循环：**最多重试 10 次**，每次间隔采用退避策略
   （具体数值——如指数退避的起始/上限——留给 design-signoff 签核，本 UC 只定"上限 10 次 +
   要退避，不是固定间隔硬打 10 枪"这条边界）。每次重试复用同一个 `clientMessageId`，
   保证后端幂等去重，不产生重复消息。
6. **系统处理（重试期间的用户可见状态）**：重试进行中，用户应能看到"正在重试"这一状态
   （不是静默重试、也不是表现成"卡住无响应"），具体呈现（是否显示第几次重试）留给 UI 契约。
7. **系统处理（用完重试预算）**：10 次全部失败后，进入**明确的超时错误状态**（区别于现有
   `submitFailure` 的单次失败态——需要能让用户分辨"是网络问题重试也没用"而不是"参数错了"），
   保留输入内容与 `clientMessageId`，允许用户手动再次触发（手动触发仍受幂等保护）。
8. **系统响应**：若重试期间某一次成功，正常进入既有 202 + `queued` 流程，不再重试。

## R4 边界（不做什么）

- **不改 AI 生成/后台执行本身**——已经是后台化，本 UC 不涉及 `agent-run-executor.ts`/
  `execute-run.ts`。
- **不改后端 run 状态机、不新增错误码**——复用 `agent-runtime` 束已有的
  `REQUEST_TIMEOUT`/`DEPENDENCY_UNAVAILABLE` 枚举，缺口 A 若需要后端暴露"线程当前
  in-flight run"这类新读侧字段，落地时再评估是否需要小范围加字段，但不新造状态机。
- **不改 `clientMessageId` 幂等机制本身**——只是"谁来负责多发起几次请求"，幂等边界不变。
- **重试次数/退避参数、断线重连的具体判定实现（回推 vs 线程侧暴露字段）**——留给
  `contracts/chat/design-signoff.md` 由人类逐字签核，本 UC 只圈定行为边界。

## R5 涉及既有代码（供实现与签核参考，不代表已实现）

- `apps/web/components/chat/chat-live-message-panel.tsx`：换线程 reset（约 331-337 行）、
  `submit()`（约 495-543 行）、轮询 effect（约 360-420 行）、SSE effect（约 432 行起）——
  缺口 A、B 的改动都落在这个文件，属**高热点文件**（近期被多个 PR 反复改动），落地前查一遍
  是否有其它 in-flight 改动，避免撞车。
- `apps/web/lib/api-client.ts`（`apiRequest`，约 179 行）：当前单次 fetch、无重试无超时，
  是全 web 共享基础设施——缺口 B 若在此处加重试策略，影响面是全部调用方，需要独立评审、
  不要与其它 feature 并发改这个文件。
- `apps/web/lib/agent-run.ts` / `agent-run-stream.ts`：既有轮询/SSE 薄封装，缺口 A 复用。
- `phases/phase-01-run-a-project/contracts/agent-runtime/usecases.md`（约 14-31 行）：
  `REQUEST_TIMEOUT`/`DEPENDENCY_UNAVAILABLE` 错误枚举定义处，本 UC 引用，不重复定义。
