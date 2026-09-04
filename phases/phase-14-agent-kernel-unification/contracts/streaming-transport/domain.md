# 契约束 `streaming-transport` — 领域模型与不变量（支撑材料）

> 洋葱最内层。翻译自 `requirements/02-streaming-transport.md`，不发挥。

## 一、实体与值对象

### `AgentKernelRunStatus`（状态机，值对象）

```
queued → running → { awaiting_plan_confirmation, awaiting_tool_permission,
                      paused, succeeded, failed, cancelled }
```

七态中 `succeeded`/`failed`/`cancelled` 是终态，其余四态（`queued` 计入非终态但不
渲染交互 UI，`running`/`awaiting_plan_confirmation`/`awaiting_tool_permission`/
`paused`）均非终态。`awaiting_plan_confirmation`/`awaiting_tool_permission` 由
`plan-permissions` 束触发迁入，本束定义状态机本身与终态判定。

### `KernelStreamEvent`（六类事件，判别联合）

```
token_delta | tool_call_start | tool_call_end | plan_update | status_change | checkpoint_saved
```

每条事件带 `runId` + 单调递增的 `seq`，供断线重连时判断"补发从哪开始"。

### `AgentRunAttempt`（F05：一逻辑 run 多次续跑）

```
AgentRunAttempt {
  runId:                    string
  attemptSeq:                int      # 同一逻辑 run 的续跑序号，从 1 开始
  messageId:                string    # 触发它的用户消息，多次续跑指向同一条
  resumedFromCheckpointId:  string | null
  status:                   AgentKernelRunStatus
}
```

## 二、不变量

- **I-1 终态覆盖完整**：`isTerminalRunStatus` 必须覆盖且仅覆盖
  `{succeeded, failed, cancelled}` 三态；其余四态（`queued`/`running`/
  `awaiting_plan_confirmation`/`awaiting_tool_permission`/`paused`）均判非终态
  （R6 后置条件）。可断言：对枚举全体逐一调用 `isTerminalRunStatus`，与
  `AGENT_KERNEL_TERMINAL_STATUSES` 集合逐一比对相等。
- **I-2 无轮询残留**：代码库中不存在任何形式的轮询兜底，包括被注释掉但未删除的
  代码（R7）。可断言：静态扫描 `agui-bridge.ts`/`copilotkit-v2-run-restore.ts`
  不出现 `readModelDeltas`/`readAgentRun` 定时轮询符号与"20 分钟轮询预算+gave-up"
  兜底逻辑（R6 后置条件）。
- **I-3 落库推流解耦**：账本写入（落库）是 fire-and-forget 旁路，不是前端获取状态
  的路径（R7）。可断言：`status_change`/`checkpoint_saved` 等事件的推送时序不依赖
  账本写入事务提交完成。
- **I-4 事件序号单调**：同一 `runId` 下事件的 `seq` 单调递增，断线重连补发时不丢
  不重复（R3 步骤 4，R12 验收线索）。可断言：注入乱序/重复事件，客户端按 `seq`
  去重排序后结果与真实产生顺序一致。
- **I-5 单一状态名**：`awaiting_tool_permission` 是唯一的"工具调用需人工表态"状态，
  代码库中不再存在 `awaiting_approval` 这一独立状态分支（00-overview 已澄清的设计
  决策 + R12 验收线索）。可断言：静态扫描全仓不出现 `awaiting_approval` 符号
  （`wave2-runtime.ts` 现存的同名旧枚举值属于待作废契约面，见下方"待确认"）。
- **I-6 延迟上限**：事件产生到前端收到的端到端延迟 < 500ms（R9）。可断言：注入
  已知时间戳事件，测得延迟低于阈值。

## 三、待人类在签核时确认

- `wave2-runtime.ts` 的 `AgentRunStatus`（含 `awaiting_approval`）是否需要在本轮
  一并标记为 deprecated 或物理删除——本契约束刻意换了新枚举名
  `AgentKernelRunStatus` 避免"同一符号两处声明不同值"，但旧枚举本身仍然存在于
  仓库中直到实现阶段真正删除代码，这段"新旧并存于契约层面"的窗口期是否可接受，
  待人类确认（一次性切换原则下，理想状态是实现 PR 直接删除旧枚举，而不是留存）。
- 多设备同时观看同一 run（R4 A1）"只保证数据一致，不要求多端 UI 同步细节"——
  本束的 `subscribeRunEvents` 是否已经足够支撑"数据一致"这条最低要求（多个客户端
  各自订阅同一 `runId` 收到相同事件序列），待人类确认是否需要补充断言。
