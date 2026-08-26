# 契约束 `plan-control` — 领域模型与不变量（支撑材料）

> 洋葱最内层。**不依赖任何外层**：这里出现的东西不知道 HTTP、不知道 PostgreSQL、
> 不知道 LangGraph。
>
> 这一件回答的问题：**「计划」这个东西在系统里到底是什么，它什么时候算损坏。**
> 束↔feature 映射的**权威**是 `design-signoff.md` 的 frontmatter `covers:`（ADR-023 决策三），
> 不是本文件。
>
> ⚠ **实测基线**：本束全部代码断言基于 `origin/main` @ `ef4a511d`（2026-08-26 `git fetch` 后实测）。
> 文件:行号引自该 SHA。静态痕迹 ≠ 动态事实——凡本文件说「现在没有」的，都指该 SHA 上真的没有。

## 零、这个域的一句话

**引擎产出的 todo 账本，怎么变成一份用户可读、可改、可确认、可控制执行的计划，
而不在改的过程中与引擎自己的账本互相覆盖。**

判据在 `.harness/instructions/chat-task-workbench-acceptance.md` 的 **TW-P0-3**
（唯一事实源，本文件**不重抄判据正文**，只引用编号）。

---

## 一、实体与值对象

### 1. `PlanLedger`（计划账本 · 聚合根）

一条 chat 线程在任一时刻**恰好有一份**当前计划账本。

```
PlanLedger {
  threadId:        string          # chat_threads.id
  revision:        int             # 单调递增，从 0 开始；0 = 引擎首次快照之前的空账本
  steps:           PlanStep[]      # 有序，顺序即执行顺序
  origin:          PlanOrigin      # 这一版是谁写的
  basedOnRevision: int | null      # 仅 origin = "user" 时非空：这次编辑基于哪一版
  engineEpoch:     int             # 引擎侧快照的世代号，见 I-6
  createdAt:       timestamptz
}
```

### 2. `PlanStep`（计划步骤 · 值对象）

```
PlanStep {
  stepId:      string              # 束内稳定 id，见 I-3
  content:     string              # 面向用户的文案；非空白
  status:      PlanStepStatus      # 见下
  constraints: PlanConstraint[]    # 见 3；空数组表示无约束
}
```

`PlanStepStatus` —— **封闭枚举，三值**，与
`packages/contracts/src/agui-state-events.ts:35` 的 `AguiPlanTodoStatus` **逐字相同**：

```
"pending" | "in_progress" | "completed"
```

⚠ **不得在本束新造第四个值**（例如 `skipped` / `cancelled`）。
引擎侧 `write_todos` 只会产出这三个；多出来的值在下一次引擎快照到达时无处可去，
会变成一次静默的数据丢失。要加，走 ADR，并且**先改引擎侧**。

### 3. `PlanConstraint`（约束 · 值对象）

「加约束」这一件的载体。**约束不是第四种 step**，它挂在某一条 step 上。

```
PlanConstraint {
  constraintId: string
  stepId:       string            # 挂在哪一步上
  text:         string            # 面向用户与模型的自然语言，非空白，≤ 500 字符
  authorId:     string            # 只可能是人；引擎不产出约束（I-9）
  createdAt:    timestamptz
}
```

⚠ **约束的语义边界（这是本束最大的不确定项，见第三节 ①）**：
约束是**给下一轮模型的一段自然语言指令**，不是可机械校验的谓词。
系统**不承诺**约束被遵守，只承诺它**被送达**。
「送达」是可断言的（I-10），「被遵守」不是。

### 4. `PlanOrigin`（值对象 · **封闭枚举，两值**）

```
"engine"   # 由一次成功的 write_todos 工具调用产生
"user"     # 由一次 UC-3/UC-4/UC-5 编辑产生
```

### 5. `PlanPhase`（六态 · **封闭枚举，六值**）

TW-P0-3 判据一的那六个态。**它是派生值，不是可写字段**（I-7）。

```
"preparing" | "planning" | "executing" | "approving" | "done" | "failed"
```

面向用户的中文文案：`准备` / `计划` / `执行` / `审批` / `完成` / `失败`。

⚠ **文案与枚举值是同一事实的两份表示**——单一事实源在
`packages/contracts/src/plan-control.ts`（第 ③ 件，见 `design-signoff.md`），
前端**不得**自己维护一张映射表。本仓已五次因此漂移。

### 6. `PlanGateDecision`（确认门判定 · 值对象）

TW-P0-3 判据四的载体。**服务端判定，前端只渲染结果**。

```
PlanGateDecision {
  required: boolean
  reason:   "no-plan" | "single-step" | "multi-step" | "user-forced"
}
```

### 7. `RunControlAction`（执行控制动作 · **封闭枚举，四值**）

TW-P0-3 判据五「可暂停」与判据六「三个恢复动作」的载体。

```
"pause" | "retry-step" | "edit-input" | "restore-checkpoint"
```

⚠ **`restore-checkpoint` 在本仓当前没有任何契约操作能实现它**——见第三节 ②。
它写在这里是因为判据六要求它；**写在这里不等于它可做**。

---

## 二、不变量

> 判据：**它在任何时刻都为真，违反即数据损坏**。每条附一行「怎么断言」。

### A 组 · 账本单一性与顺序

**I-1** 任一 `threadId` 在任一时刻**恰好有一份** revision 最大的 `PlanLedger`，
它就是「当前计划」。UI 与 API 都只读它，不各自重算。
› 怎么断言：`SELECT count(*) FROM chat_plan_ledgers WHERE thread_id=$1 GROUP BY revision HAVING count(*)>1` 必须返回 0 行；
唯一约束 `(thread_id, revision)`。

**I-2** `revision` 在同一 `threadId` 内**严格单调递增，且永不重用**。
任何一次写入（引擎快照或用户编辑）都产生**新的一行**，不就地改写。账本是 append-only。
› 怎么断言：对同一 `threadId` 连发两次编辑，第二次的 `revision` 严格大于第一次；
`UPDATE chat_plan_ledgers SET steps=...` 在迁移里没有对应代码路径（`lint` 级别的 grep 断言）。

**I-3** `stepId` 在同一 `threadId` 的**整个生命周期内稳定**：
调序不改 `stepId`，删步骤不重排其余 `stepId`。
› 怎么断言：调序前后取两版 `steps.map(s=>s.stepId).sort()`，集合相等；
删除后剩余集合 = 原集合 − {被删的那个}。

⚠ **I-3 是「调序」和「删步」能被验收的前提**，也是本束最容易被实现绕过的一条：
引擎侧 `write_todos` 的 payload **只有 `{content, status}`，没有 id**
（`agui-state-events.ts:38-41` 实测）。所以 `stepId` **必须由本束在接收快照时赋予**，
派生规则见 I-6。

**I-4** `steps` 的**数组下标即执行顺序**，不存在第二个 `order` 字段。
› 怎么断言：schema 里搜不到 `order` / `sortKey` 字段；调序的 API 出参与入参下标一致。

### B 组 · 引擎与用户的写入互不覆盖（本束的核心）

**I-5** 一次用户编辑（`origin="user"`）必须携带 `basedOnRevision`，
且当且仅当 `basedOnRevision == 当前最大 revision` 时被接受；否则拒绝为 `PLAN_REVISION_CHANGED`，
**不静默覆盖**。
› 怎么断言：并发两次编辑同一 `basedOnRevision`，第二次必须收到 `PLAN_REVISION_CHANGED`；
账本里只多出一行，不是两行。

⚠ **这条与 `chat` 束 `mutateThread` 的 `expectedVersion` → `VERSION_CHANGED` 是同一种东西**
（`packages/contracts/src/chat.ts:539,551,561` 实测）。**故意同形不同名**：
线程版本与计划版本是两条独立的时间线，共用一个字段名会让「改标题」和「改计划」互相误伤。

**I-6** 引擎快照（`origin="engine"`）**永远被接受，永远不因用户编辑而被拒绝**，
但它必须**递增 `engineEpoch`**。用户编辑不改 `engineEpoch`。
`stepId` 的赋予规则：新快照的第 i 条，若 `content` 与上一版第 j 条**逐字相等**则继承其 `stepId`，
否则新发一个。
› 怎么断言：引擎连发两次快照，`engineEpoch` 递增 2；内容不变的条目 `stepId` 不变；
用户编辑后 `engineEpoch` 与编辑前相等。

⚠ **「逐字相等即继承」是一个刻意的、会出错的启发式**。引擎把
「对比竞品」改成「对比竞品（含定价）」时，本束会认为那是**新的一步**，
用户挂在旧那一步上的约束会随之失去宿主（I-8 兜底）。
**没有更好的办法**：payload 里没有 id，这是引擎侧的形状，不是本束能单方面修的。
这条必须在签核时被人类明确接受或否决，见 `design-signoff.md` ② 节。

**I-7** `PlanPhase` 是**纯派生值**，由 (`run.status`, 账本是否为空, 是否有待决审批, 是否有失败步骤)
唯一决定，**不落库、不可写**。
› 怎么断言：schema 与迁移里不存在 `phase` 列；派生函数是纯函数，同输入同输出的表驱动测试。

⚠ **这条正面对着 TW 卡的反伪造条款**：一个可写的 `phase` 字段会立刻变成「写死文案」的温床——
后端想让它显示什么就显示什么，与真实 run 状态脱钩。派生是唯一让它不能撒谎的形状。

**I-8** 一条 `PlanConstraint` 的 `stepId` 必须指向**同一 revision 内实存的** step；
其宿主 step 在后续版本里消失时，该约束**转为孤儿并对用户可见地标记**，
**不得静默删除，也不得静默转挂到别的 step 上**。
› 怎么断言：删掉带约束的 step 后，查约束表该行仍在且 `orphanedAtRevision` 非空；
UI 有对应的可见提示元素。

**I-9** `origin="engine"` 的账本版本里 `constraints` **恒为空数组**。
约束只可能由人产生。
› 怎么断言：引擎快照落库路径不读用户约束表；对任一 `origin="engine"` 行断言
`jsonb_array_length(steps->0->'constraints') = 0`。

### C 组 · 送达与控制

**I-10** 一次「已确认的计划 + 其全部约束」在**下一轮 run 被创建时必定被送达引擎**，
且送达内容与账本当前版本**逐字一致**。送达失败 ⇒ 该轮 run 不被创建（fail closed）。
› 怎么断言：拦截 `POST /threads/:id/runs` 的请求体，断言其中携带的计划正文
与 `PlanLedger` 当前 revision 的序列化结果逐字相等；
注入失败时断言无 run 被创建、返回 `PLAN_DELIVERY_FAILED`。

⚠ **I-10 是「加约束」这一件唯一可验收的性质**。见第一节 3 的边界说明：
系统承诺送达，不承诺遵守。**验收线不得写成「模型遵守了约束」**——那不可判定。

**I-11** 用户编辑在 run **正在执行时**不进入引擎，只进入本仓账本，
并被标记为 `pendingApplyAtNextRun`。UI 必须如实告知「将在当前步骤完成后生效」。
› 怎么断言：run `running` 期间提交编辑，断言 `POST /threads/:id/state` **未被调用**，
且出参 `appliedTo` 为 `"ledger-only"`；UI 有对应可见文案元素。

⚠ **这条是本束最重要的一条诚实**。理由见第三节 ③——mid-run 写引擎 state 会被
引擎自己的下一次 `write_todos` 覆盖，做出来是个会随机失效的功能，正是反伪造条款要挡的东西。

**I-12** `pause` 只在存在**活跃 run** 时可用；它的语义是**中止当前 run**，
不是「冻结」。暂停后账本保持在暂停时刻的 revision，可编辑。
› 怎么断言：无活跃 run 时调用 `pause` → `NO_ACTIVE_RUN`；
有活跃 run 时调用后，run 状态转终态且 `POST /threads/:id/runs/:run_id/cancel` 被调用一次。

**I-13** 任何 `RunControlAction` 都产生**一条审计事件**，越权尝试同样产生。
› 怎么断言：四个动作各调一次，审计表各多一行；无权限的调用者调用后被拒且审计表仍多一行。

### D 组 · 与已有门控的关系

**I-14** 本束下发的任何 AG-UI 事件，若其 `EventType` 属
`{STATE_SNAPSHOT, STATE_DELTA, CUSTOM}`，必须在
`apps/api/tests/agent-runtime/agui-bridge-state-events.test.ts` 的**具名**白名单里有对应条目，
**且该条目有真实生产者**。
› 怎么断言：该测试文件的三条反证断言（`:252-255`、`:267`、`:281`）保持红/绿语义不变；
新增名字必须同时新增一条「不发它」的反证用例。

⚠ **不许把 CUSTOM 整类放行**。该测试文件 `:70-71` 逐字写着这条纪律。

**I-15** 用户不可见 `write_todos` 字面串。
› 怎么断言：`chat-task-workbench-copy.spec.ts` 的黑名单（TW-COPY-1）已逐字包含 `write_todos`，
本束不重复定义黑名单，只保证不违反。

---

## 三、待人类裁决 / 待定

> 以下每一条都会改变实现代价。**人类是在「代价最大但 TW-P0-3 能真到 1.0」这个理解下
> 选的完整方案**——下面 ① ② ③ 三条是我在设计过程中发现的、**代价比那句话更大**的地方，
> 按纪律如实列出，人类有权据此重新选。

### ① 🔴 「加约束」需要改 Python 服务，还是只改 Node 侧

约束要进入下一轮模型，只有两条通路，**代价差一个语言栈**：

| 通路 | 怎么做 | 代价 | 会不会与 `org_skills` / `script_protocol` 打架 |
|---|---|---|---|
| **A. system 消息注入**（推荐 V1） | 在 `ensureRun` 组装 `messages` 时，把计划正文 + 约束作为一段 system 文本前置 | **只改 Node 侧**。不碰 `apps/deep-agent-service` | 不打架——两者是不同通道。但**约束到不了 `call_skill` 发起的子模型调用**，因为那次调用的 system prompt 是 skill 正文（`#1747` 的原始理由，`deep-agent-model-provider.ts:762-769` 逐字写着这条） |
| **B. `configurable.plan_constraints`** | 与 `org_skills`/`script_protocol` 同一通道 | **必须同时改 Python 侧**才有人读它——`configurable` 只是把值送到远端，`deep_agent_service` 不读就等于没送。跨语言栈、跨部署单元 | 键名不冲突（`configurable` 是对象，加键是加法）。但**第三个 per-run 配置键**意味着三处各自决定「缺席时怎么办」，这正是本仓「同一事实多处声明」的高发形状 |

**推荐：A 作为 V1，B 留给「约束需要穿透 `call_skill`」被真实需求逼出来的那一天。**
理由：TW-P0-3 判据三只要求「加约束」这个**编辑动作**存在且真的写进后端并送达下一轮，
它没有要求约束对子技能调用生效。用 A 能在不碰 Python 服务的前提下满足 I-10。

⚠ **但 A 有一个现在就存在的冲突**：注入点在 run 创建时组装 `messages` 的地方，
而 `apps/api/src/application/agent-run/execute-run.ts` **当前有另一条在飞的线**
（可视化提示词）。两条线改同一处。**本束的实现必须排在那条线之后**，
不能并行——否则是一次可预期的冲突，不是意外。

### ② 🔴 `restore-checkpoint`（判据六第三个恢复动作）**指不到任何契约操作**

`contract-design.md` §五-8 逐字要求：**验收里的每个动词必须能指到一个契约操作**，
指不出来的「不要写进验收」。逐条核过：

- `chat` 束：无。它的 `usecases.md:22` 把后台任务显式委托给 `11-task`。
- `agent-runtime` 束：有 `replayAgentRun`，有 I-49「一次 run 结束后…checkpoint…**且可重放**」，
  但**「重放一次已结束的 run」≠「把线程恢复到某个 checkpoint 继续跑」**。
  该束 `coverage.md:249` 自己把这条标成 **缺口 25（跨 phase-00 `context-pack`）**。
- 引擎侧**确实有原语**：`GET /threads/{id}/history` 与
  `POST /threads/{id}/state`（带 `checkpoint_id`）在本仓装着的 `langgraph_api` 里实存
  （`langgraph_api/api/threads.py:555-575` 实测，2026-08-26）。**但本仓一行都没接。**

⇒ **三个候选，请人类选一个**：

- **(a)** 本束新增 `restoreCheckpoint` 操作，并接受它**触碰 `agent-runtime` 已签核束的领域**
  （run/checkpoint 是那个束的实体）⇒ `agent-runtime` 需要一次 design-delta 或重签。
- **(b)** 把 `restore-checkpoint` 从 TW-P0-3 判据六里**撤下来**，判据六改为两个恢复动作。
  这要改验收卡（单一事实源），是人类的动作。
- **(c)** 本轮先做前两个恢复动作，第三个显式记为**已知缺口**，接受 TW-P0-3 拿 **0.7 不是 1.0**。

⚠ 我的推荐是 **(c)**：人类选「完整做」的理由是「TW-P0-3 能真到 1.0」，而
(a) 会把这次签核从「新增一个束」扩大成「重开一个已签核束」，
那不是他被告知的代价。**(c) 诚实地把 1.0 降成 0.7，好过用 (a) 悄悄扩大范围。**

### ③ 🟠 mid-run 写引擎 state 不可靠 —— I-11 就是这条的产物

`POST /threads/{id}/state` 实存（同上，实测）。但**在 run 执行途中调用它**：
写入产生一个新 checkpoint，而**正在跑的那条 run 持有自己的状态**，
它下一次 `write_todos` 落地时会以引擎自己的账本为准，把用户刚写进去的覆盖掉。

⇒ 用户在 agent 跑的时候改计划，**改动会随机地生效或不生效**——
这正是反伪造条款要挡的「点了没有真实读写的按钮」的变种：**有读写，但结果不可预期**。

**本束的处置（已写进 I-11）**：mid-run 编辑只落本仓账本 + 明确告知「下一步生效」；
要立刻生效，用户先**暂停**（I-12），暂停后的编辑在下一轮 run 创建时经 I-10 送达。

⚠ **这是一条产品行为，不只是技术选择，必须由人签**。它意味着
「执行中改计划立刻改变正在跑的这一步」**这件事本束不提供**。

### ④ 待定：确认门的判定阈值

`PlanGateDecision.reason` 的 `single-step` / `multi-step` 分界现在写的是
「引擎产出的 todo 条数 ≥ 2 ⇒ 需要确认」。这条阈值**没有依据**，是我定的。
判据四只说「复杂任务先确认计划，简单问题直接回答」。
› 好消息：**反证是可判定的**——简单提问根本不触发 `write_todos`，
所以 `reason="no-plan"` ⇒ `required=false` 这条路径与阈值无关（见 `usecases.md` UC-8 的反证）。
› 要人类拍的只是「2 条 todo 算不算复杂」。

### ⑤ 待定：暂停后的 run 记账

`pause` 需要远端 `run_id`。`deep-agent-model-provider.ts` 的 `ensureRun` 拿到 `run_id`
后**只在方法内使用**（`:781` 返回给调用者），**是否被持久化到 `agent_runs` 尚未核实**。
若没有，`pause` 需要先补一条「记住当前 run_id」的写入。
› **这是一个实现期的探针（P-2），不是设计裁决**，但它会影响工作量估计，故记在这里。

---

## 四、这个域不负责什么

- **引擎能不能产出结构化 todo** → `.harness/rubrics/deepagent-capability-rubric.md` D1。本束假定它能。
- **todo 在界面上实时可见** → `.harness/instructions/chat-ux-acceptance-criteria.md` 第 2 项。
  本束只负责**可编辑与可控制**这一层（TW 卡第一节的三层划分逐字如此）。
- **审批卡本体**（三态决策、风险分级、五项披露）→ TW-P0-6，宿主屏归 `chat` 束。
  本束只在 `PlanPhase="approving"` 这一个派生态上与它相接。
- **模型路由 / model registry / MCP** → `agent-runtime` 束。
- **线程可见性与角色判定** → `chat` 束（F108）+ phase-00 `identity`。本束不另立角色枚举。
- **产物版本与引用资格** → phase-00 `artifact`。
- **后台任务队列本体** → `11-task`。
