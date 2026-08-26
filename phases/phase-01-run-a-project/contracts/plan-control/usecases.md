# 契约束 `plan-control` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL、不知道 LangGraph。
>
> 这一件回答的问题：**application 层的输入/输出端口长什么样，失败长什么样。**
> 「失败长什么样」是契约的一半——界面的异常态全靠它渲染。
>
> 束↔feature 映射的**权威**在 `design-signoff.md` 的 frontmatter `covers:`。

## 统一约定

- 每个 UC 一段：`in` / `out` / `pre` / `err`。
- `err` **穷举**，不写「等等」。
- 所有 UC 的调用者身份都来自 `CurrentPrincipal()`，不由入参传递。
- **可见性与写权判定不在本束**：每个 UC 的 `pre` 里那条「调用者对该线程有写权」
  一律委托 `chat` 束 F108 的判定结果（`chat/usecases.md` UC-0），
  **本束不重复定义角色语义**（本仓最高发的「同一事实两处声明」）。

## 跨束委托（不在本束实现，只调用）

- 角色枚举与两层判定 → phase-00 `identity`（`uc-0-3`）+ `chat` 束 UC-0
- 线程本体的增改删与 `expectedVersion` → `chat` 束 `mutateThread`
- 审批卡本体（三态决策 / 风险 / 披露）→ TW-P0-6，宿主归 `chat` 束
- run 的创建 / 状态 / 工具事件 → `agent-runtime` 束 + `deep-agent-model-provider`
- 审计写入 → `agent-runtime` 束 `ProvenanceWriter`（append-only，I-45）

## 统一失败枚举 `PlanControlError`

```
# 通用
NOT_VISIBLE                 调用者看不到这条线程（委托 chat UC-0 的判定结果）
NO_WRITE_ROLE               可见但无写权（观察者恒无写权：按钮不渲染 **且** 接口拒绝）
THREAD_ARCHIVED_READONLY    线程已归档，全部写操作被拒
AUDIT_SINK_UNAVAILABLE      审计不可写 ⇒ 整个操作失败（fail closed，I-13）

# 账本
PLAN_NOT_FOUND              该线程还没有任何计划账本（revision 0 也没有）
PLAN_REVISION_CHANGED       basedOnRevision 不是当前最大 revision（I-5，不静默覆盖）
PLAN_STEP_NOT_FOUND         stepId 不在当前 revision 里
PLAN_EMPTY_NOT_ALLOWED      删到 0 步；计划不得被编辑成空（见 UC-4）
PLAN_CONSTRAINT_TOO_LONG    约束正文超过 500 字符
PLAN_CONSTRAINT_BLANK       约束正文全为空白
PLAN_CONTENT_BLANK          步骤正文全为空白（与 AguiPlanTodo 的 refine 同义）

# 送达与执行控制
PLAN_DELIVERY_FAILED        计划/约束未能随下一轮 run 送达引擎 ⇒ 该轮 run 不创建（I-10）
NO_ACTIVE_RUN               没有活跃 run，pause / retry-step 无对象（I-12）
RUN_ALREADY_TERMINAL        目标 run 已是终态
CHECKPOINT_UNAVAILABLE      引擎侧没有可恢复的 checkpoint
RESTORE_NOT_IMPLEMENTED     见 domain.md 第三节 ②——本束当前不提供，签核时人类可选删除此码
```

---

# 用例 · A 组 · 账本读写

### UC-1 `getPlanLedger` —— 读当前计划（读模型）

前端计划面板**唯一**的数据来源。

```
in:  { threadId }
out: {
       revision, engineEpoch, origin,
       steps: [{ stepId, content, status, constraints: [{ constraintId, text, createdAt }] }],
       orphanedConstraints: [{ constraintId, text, orphanedAtRevision, formerStepContent }],
       phase: PlanPhase,                       # 派生，I-7
       gate:  { required, reason },            # 派生，见 UC-8
       progress: { completed, total, elapsedMs },
       pendingApplyAtNextRun: boolean,         # I-11
       activeRunId: string | null
     }
pre: 调用者对该线程可见（委托 chat UC-0）
err: NOT_VISIBLE
```

⚠ **`phase` / `gate` / `progress` 三个都是派生值，出参里给的是判定结果，不是原料。**
前端**不得**自己从 steps 重算 phase——那会立刻变成同一事实的第二份声明。

⚠ **零计划是正常态，不是错误**：新线程返回 `revision: 0, steps: [], phase: "preparing",
gate: { required: false, reason: "no-plan" }`，**不返回 `PLAN_NOT_FOUND`**。
`PLAN_NOT_FOUND` 只出现在写操作里。

### UC-2 `ingestEnginePlanSnapshot` —— 引擎快照落账本（内部端口，无 HTTP 面）

由 `write_todos` 成功时的现有生产者调用
（`copilotkit-agui.controller.ts:389-392` 的同一个判定点，**不新建第二条触发路径**）。

```
in:  { threadId, todos: AguiPlanTodo[] }        # 复用 packages/contracts/src/agui-state-events.ts:38
out: { revision, engineEpoch }
pre: —（系统内部调用）
err: —（写入失败即整轮 run 失败，不吞）
```

⚠ **永远被接受**（I-6）。用户编辑不能阻止引擎写它。
⚠ `stepId` 在这一步被赋予：内容逐字相等则继承，否则新发（I-6 的启发式，**已知会出错**，
见 `domain.md` 第三节 ②上方的警告与 `design-signoff.md` ② 节的确认项）。

---

# 用例 · B 组 · 三个编辑动作（TW-P0-3 判据三）

> 三个 UC 共享同一条并发纪律：**必带 `basedOnRevision`**，不匹配即拒（I-5）。
> 三个 UC 共享同一条执行期纪律：run 活跃时只落账本（I-11），出参的 `appliedTo` 如实说明。

### UC-3 `reorderPlanStep` —— 调顺序

```
in:  { threadId, basedOnRevision, stepId, toIndex }
out: { revision, appliedTo: "ledger-only" | "ledger-and-engine", auditEventId }
pre: 调用者对该线程有写权（委托 chat UC-0）
err: NOT_VISIBLE | NO_WRITE_ROLE | THREAD_ARCHIVED_READONLY
   | PLAN_NOT_FOUND | PLAN_REVISION_CHANGED | PLAN_STEP_NOT_FOUND
   | AUDIT_SINK_UNAVAILABLE
```

⚠ `toIndex` 越界（<0 或 ≥ steps.length）**钳制到边界，不报错**——
拖拽 UI 天然会产生越界值，把它做成错误会让界面被迫做一次多余的前置校验。

### UC-4 `deletePlanStep` —— 删步骤

```
in:  { threadId, basedOnRevision, stepId }
out: { revision, appliedTo, orphanedConstraintIds: string[], auditEventId }
pre: 同 UC-3
err: NOT_VISIBLE | NO_WRITE_ROLE | THREAD_ARCHIVED_READONLY
   | PLAN_NOT_FOUND | PLAN_REVISION_CHANGED | PLAN_STEP_NOT_FOUND
   | PLAN_EMPTY_NOT_ALLOWED | AUDIT_SINK_UNAVAILABLE
```

⚠ **删掉带约束的步骤不删约束**（I-8）：约束转孤儿，`orphanedConstraintIds` 如实返回，
UI 必须可见地告知。**静默删除是数据丢失。**

⚠ **删 `status="completed"` 的步骤是允许的**——它只从计划视图里移走，
不改写已经发生过的事实（工具调用链与审计不受影响）。这一条请人类确认，见 `design-signoff.md`。

### UC-5 `addPlanConstraint` —— 加约束

```
in:  { threadId, basedOnRevision, stepId, text }
out: { revision, constraintId, appliedTo, auditEventId }
pre: 同 UC-3
err: NOT_VISIBLE | NO_WRITE_ROLE | THREAD_ARCHIVED_READONLY
   | PLAN_NOT_FOUND | PLAN_REVISION_CHANGED | PLAN_STEP_NOT_FOUND
   | PLAN_CONSTRAINT_BLANK | PLAN_CONSTRAINT_TOO_LONG | AUDIT_SINK_UNAVAILABLE
```

### UC-6 `removePlanConstraint` —— 撤掉一条约束（含孤儿）

```
in:  { threadId, basedOnRevision, constraintId }
out: { revision, appliedTo, auditEventId }
pre: 同 UC-3
err: NOT_VISIBLE | NO_WRITE_ROLE | THREAD_ARCHIVED_READONLY
   | PLAN_NOT_FOUND | PLAN_REVISION_CHANGED | AUDIT_SINK_UNAVAILABLE
```

⚠ 加得进去、撤不掉的东西不是可编辑，是单向写入。UC-6 不是可选项。

---

# 用例 · C 组 · 确认门（TW-P0-3 判据四）

### UC-7 `confirmPlan` —— 确认这份计划，放行执行

```
in:  { threadId, basedOnRevision }
out: { revision, runId, deliveredPlanDigest: string, auditEventId }
pre: 调用者有写权；`gate.required === true`
err: NOT_VISIBLE | NO_WRITE_ROLE | PLAN_NOT_FOUND | PLAN_REVISION_CHANGED
   | PLAN_EMPTY_NOT_ALLOWED | PLAN_DELIVERY_FAILED | AUDIT_SINK_UNAVAILABLE
```

⚠ **`deliveredPlanDigest` 是 I-10 的可验收出口**：它是「实际送进 `POST /threads/:id/runs`
请求体里那段计划正文」的哈希。验收断言它与账本当前 revision 的序列化结果一致——
**这让「约束真的被送达」变成可断言的，而不是一句愿望**。

⚠ **送达失败 ⇒ 不创建 run**（fail closed）。半送达的计划比不送更糟：
用户以为自己的约束生效了。

### UC-8 `evaluatePlanGate` —— 确认门判定（纯函数端口，无 HTTP 面）

```
in:  { todoCount: int, userForced: boolean }
out: { required: boolean, reason: "no-plan"|"single-step"|"multi-step"|"user-forced" }
pre: —
err: —（纯函数，不失败）
```

判定表（**封闭，表驱动**）：

| 条件 | reason | required |
|---|---|---|
| `userForced === true` | `user-forced` | `true` |
| `todoCount === 0` | `no-plan` | **`false`** |
| `todoCount === 1` | `single-step` | **`false`** |
| `todoCount >= 2` | `multi-step` | `true` |

### 🔴 UC-8 的反证 —— 判据四「简单提问不得被加确认门」怎么变成可判定的

TW-P0-3 判据四逐字：**「反证要求：一个简单提问不得被加上一道确认门（否则判 0.3 封顶）」**。

**它可判定，且不依赖任何阈值**，理由是一条实测到的机制事实：

> 计划账本**只有一个生产者**——`copilotkit-agui.controller.ts:389` 的三重条件
> （`step.status === "succeeded"` ∧ `step.toolName === "write_todos"` ∧ `toolArgsSummary !== null`）。
> **简单提问不会触发 `write_todos`**，所以它的 `todoCount` 恒为 0，
> 恒命中 `reason: "no-plan"` ⇒ `required: false`。

⇒ **反证用例（必须会红，不许 `test.skip`）**：

```
给定  一条新线程
当    用户发送一条简单提问（真栈，走真实引擎，不 mock write_todos）
那么  ① 该轮 run 走到 `phase: "done"`，中途从未出现 `phase: "planning"`
      ② `getPlanLedger.gate` 恒为 { required: false, reason: "no-plan" }
      ③ 界面上 `chat-task-workbench-plan-confirm` 这个锚点**从未出现过**
         （不是「出现后消失」——用 e2e 的持续断言，不是终态快照）
```

⚠ **③ 必须写成「从未出现」**。写成「最终不存在」会被一个闪现半秒的确认门骗过去，
而用户真实体验到的就是那半秒。本仓九次「全绿但空转」有一半是这种断言方向问题。

⚠ **反向也要有一条**（否则 UC-8 可能整个在空转）：一个真正复杂的任务
必须命中 `multi-step` 且确认门**真的挡住执行**——未确认前 run 不被创建。

---

# 用例 · D 组 · 执行控制（TW-P0-3 判据五、六）

### UC-9 `pausePlanRun` —— 暂停

```
in:  { threadId }
out: { runId, pausedAtStepId: string | null, auditEventId }
pre: 调用者有写权；存在活跃 run
err: NOT_VISIBLE | NO_WRITE_ROLE | NO_ACTIVE_RUN | RUN_ALREADY_TERMINAL
   | AUDIT_SINK_UNAVAILABLE
```

⚠ **语义是「中止当前 run」，不是「冻结」**（I-12）。UI 文案必须与之一致——
写「已暂停，可随时继续」而实现是中止，就是写死文案。
⚠ 落点：引擎侧 `POST /threads/{id}/runs/{run_id}/cancel`
（`langgraph_api/api/runs.py:1006` 实测存在）。
⚠ **依赖一个未核实的前提（P-2）**：远端 `run_id` 是否被持久化。见 `domain.md` 第三节 ⑤。

### UC-10 `retryPlanStep` —— 重试某一步（判据六 ①）

```
in:  { threadId, stepId }
out: { runId, auditEventId }
pre: 调用者有写权；该 step 处于失败语义（其所属 run 已失败）
err: NOT_VISIBLE | NO_WRITE_ROLE | PLAN_STEP_NOT_FOUND | NO_ACTIVE_RUN
   | AUDIT_SINK_UNAVAILABLE
```

⚠ 实现语义：把该 step 及其后续置回 `pending`，写回账本，起新一轮 run（经 UC-7 的送达路径）。
**不是引擎级的「从那个节点继续」**——那需要 checkpoint，见 UC-11。这一点必须对用户如实措辞。

### UC-11 `restoreCheckpoint` —— 恢复检查点（判据六 ③）🔴 **本轮可能不做**

```
in:  { threadId, checkpointId }
out: { revision, runId, auditEventId }
pre: 调用者有写权；引擎侧存在该 checkpoint
err: NOT_VISIBLE | NO_WRITE_ROLE | CHECKPOINT_UNAVAILABLE
   | RESTORE_NOT_IMPLEMENTED | AUDIT_SINK_UNAVAILABLE
```

🔴 **这个 UC 是三个候选之一，等人类裁决**，见 `domain.md` 第三节 ②。
- 若选 (a)：本 UC 生效，且 `agent-runtime` 束需要一次 design-delta（checkpoint 是它的实体）。
- 若选 (b)：本 UC 删除，**同时改验收卡**（人类的动作）。
- 若选 (c)（我的推荐）：本 UC 保留形状但恒返回 `RESTORE_NOT_IMPLEMENTED`，
  UI **不渲染这个按钮**（渲染一个恒失败的按钮 = 反伪造条款的死按钮，判 0）。
  TW-P0-3 记 **0.7 不是 1.0**，如实。

⚠ **注意 (c) 与「死按钮判 0」的关系**：(c) 之所以不判 0，
是因为按钮**不渲染**，缺口如实登记；渲染一个点了报错的按钮才判 0。

---

# 用例 · E 组 · 状态送达（横切）

### UC-12 `deliverPlanToRun` —— 计划与约束进入下一轮 run（内部端口）

I-10 的实现端口。**唯一的注入点**，不许有第二处。

```
in:  { threadId, ledgerRevision }
out: { digest: string }
pre: —（由 UC-7 / UC-10 / 正常轮次创建路径调用）
err: PLAN_DELIVERY_FAILED
```

⚠ **通路选择见 `domain.md` 第三节 ①（A/B 两案，等人类裁）**。
无论选哪个，`digest` 的定义不变：**实际送出去的那段正文的哈希**，
不是「本该送出去的」——这两者的区别正是本仓「静态痕迹 ≠ 动态事实」那条纪律。

⚠ **与在飞的线冲突**：注入点落在 run 创建时组装 `messages` 的地方，
`apps/api/src/application/agent-run/execute-run.ts` 当前有另一条线在改同一处。
**本束实现必须排在其后。**

---

## 端口（infrastructure 实现这些）

| 端口 | 职责 | 实现落点 |
|---|---|---|
| `PlanLedgerRepository` | 账本读写；`(thread_id, revision)` 唯一；append-only（I-2） | PostgreSQL 新表，见 `design-signoff.md` ③ 节 |
| `PlanDeliveryGateway` | UC-12；把计划正文送进下一轮 run 并返回真实 digest | 扩 `deep-agent-model-provider` 的 run 创建路径 |
| `EngineRunController` | UC-9 的 cancel；（若选 (a)）UC-11 的 history + state 恢复 | `POST /threads/:id/runs/:run_id/cancel` 等 |
| `EngineStateReader` | 读回引擎 `values.todos`（**当前读不到**，见 ③ 节） | 扩 `ThreadStateResponse`（`deep-agent-model-provider.ts:166-168`） |
| `ProvenanceWriter` | I-13 的审计写入 | 复用 `agent-runtime` 束既有端口，**不另建** |
