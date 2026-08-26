# 契约束 `plan-control` — UC 覆盖证明（支撑材料）

> 横切的一件。**两个方向都查**：
> - **判据 → API**：验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
> - **API → 判据**：有 API 操作没有任何判据要它 ⇒ **接口多余，或有判据没写**
>
> 这一件是签核面里唯一做双向检查的（ADR-023 决策二），所以它不在签核面里但不许删。

## 怎么读这张表

- 本束的「R12 验收线索」不来自某条 UC 文档，而来自
  `.harness/instructions/chat-task-workbench-acceptance.md` 的 **TW-P0-3 判据一～六**
  （**那份卡是判据的单一事实源，本文件只引用编号，不重抄正文**）。
  为与本仓其余束同构，逐条编号为 `V1`…`V6`，子条编 `V3a`…。
- 「前端消费点」列填**真实 `data-testid`**；填不出来的标 `—（API 层验收）`，**但不能空着**。
- 状态取值：`✅` / `⚠ **缺口 N**（…）` / `🔴 **缺口 N —— 待人类裁决**`。
- ⚠ **本束当前一个 `✅` 都没有**——`✅` 的定义是「API 与前端消费点都已存在」，
  而本束是待签核的新束，实现为零。这里的 `✅` 一律读作
  **「契约面已闭合，缺口只在实现」**；`⚠`/`🔴` 才是**契约本身不够**。

---

## 一、TW-P0-3 判据 R12（6 条 → 11 行）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **V1** | 六态状态机存在，当前态**可读**（不靠颜色） | `UC-1 getPlanLedger.phase`（派生，I-7） | `chat-task-workbench-phase-indicator`（`data-phase` + `aria-current`） | ✅ 契约闭合 |
| V1a | 去掉 CSS 后仍能读出当前态 | 同上（`phase` 是文本枚举，不是颜色） | 同上 + `role="status"` 播报 | ✅ 契约闭合 |
| **V2** | 计划文案面向用户，不暴露 `write_todos` | `UC-1` 的 `steps[].content` 直出引擎正文 | `chat-task-workbench-plan-step` | ⚠ **缺口 1**（正文是引擎写的中文，本束不改写；**若引擎某轮吐英文/工具名，本束无净化层**） |
| **V3** | 计划可编辑：调顺序 | `UC-3 reorderPlanStep` | `chat-task-workbench-plan-step-reorder` | ✅ 契约闭合 |
| V3a | 计划可编辑：删步骤 | `UC-4 deletePlanStep` | `chat-task-workbench-plan-step-delete` | ✅ 契约闭合 |
| V3b | 计划可编辑：加约束 | `UC-5 addPlanConstraint` + `UC-12 deliverPlanToRun`（送达才算数，I-10） | `chat-task-workbench-plan-step-add-constraint` | 🔴 **缺口 2 —— 待人类裁决**（送达通路 A/B 未选，见 `domain.md` 三·①） |
| V3c | 加进去的约束撤得掉 | `UC-6 removePlanConstraint` | `chat-task-workbench-plan-constraint-remove` | ✅ 契约闭合（**TW 卡未要求，本束补的**） |
| **V4** | 确认门**条件性**：复杂任务先确认 | `UC-8 evaluatePlanGate` → `required: true` + `UC-7 confirmPlan` | `chat-task-workbench-plan-confirm` | ✅ 契约闭合 |
| **V4′** | **反证**：简单提问不得被加确认门（否则 0.3 封顶） | `UC-8` → `reason: "no-plan"`，`required: false`；**判定不依赖阈值**（生产者只有 `write_todos` 一个） | `chat-task-workbench-plan-confirm` **从未进入 DOM** | ✅ 契约闭合（判定见 `usecases.md` UC-8 反证） |
| **V5** | 执行态：当前步骤 / 完成比例 / 耗时 / **可暂停** | `UC-1 getPlanLedger.progress` + `UC-9 pausePlanRun` | `chat-task-workbench-run-progress`、`chat-task-workbench-run-pause` | ⚠ **缺口 3**（`pause` 依赖远端 `run_id` 是否持久化，探针 P-2 未跑） |
| **V6** | 失败态：失败步骤 + 三个恢复动作 | `UC-10 retryPlanStep` / `UC-3-5`+`UC-7`（修改输入） / `UC-11 restoreCheckpoint` | `chat-task-workbench-failure-{retry-step,edit-input,restore-checkpoint}` | 🔴 **缺口 4 —— 待人类裁决**（第三个动作指不到任何契约，见 `domain.md` 三·②） |

---

## 二、不变量 → 界面/API 的覆盖（本束特有的一张）

> 不变量没有界面面 = 它对用户不存在。这张表查的就是这个。

| 不变量 | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **I-5** | 并发编辑不静默覆盖 | `UC-3/4/5/6` 的 `PLAN_REVISION_CHANGED` | `chat-task-workbench-plan-stale-banner` | ✅ 契约闭合 |
| **I-8** | 孤儿约束不静默删除 | `UC-4.out.orphanedConstraintIds` + `UC-1.out.orphanedConstraints` | `chat-task-workbench-plan-orphan-constraint` | ✅ 契约闭合 |
| **I-10** | 计划与约束**必定送达**，失败即不起 run | `UC-7.out.deliveredPlanDigest` + `UC-12` | —（API 层验收：拦请求体断言 digest） | 🔴 同**缺口 2** |
| **I-11** | 执行中编辑只落账本，如实告知 | `UC-3/4/5.out.appliedTo === "ledger-only"` | `chat-task-workbench-plan-pending-apply` | ✅ 契约闭合 |
| **I-13** | 四个控制动作都有审计，越权也有 | 各 UC 的 `auditEventId` + `AUDIT_SINK_UNAVAILABLE` | —（API 层验收） | ✅ 契约闭合（复用 `agent-runtime` 的 `ProvenanceWriter`） |
| **I-14** | 新增状态事件必须进具名白名单 | —（无 API 面） | —（门控层验收） | ⚠ **缺口 5**（是否需要新事件名尚未定，见第四节） |

---

## 三、缺口清单（这一件的真正价值所在）

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | 步骤正文无净化层：引擎若吐出裸工具名/英文，直出到用户面前 | **契约不够**（V2 判据要求「面向用户」，但本束没有任何操作能保证它） | 三选一：① 接受（判据二靠 prompt 保证，不靠契约）；② 本束加一条净化端口；③ 把「面向用户」的责任写回引擎侧 system prompt。**建议 ①，并在 TW-COPY-1 的黑名单里兜底** |
| **2** | 约束送达通路未选（A: system 注入 / B: `configurable`） | **待人类裁决** | `domain.md` 三·①。选 B 需同时改 `apps/deep-agent-service`（跨语言栈） |
| **3** | `pause` 依赖的远端 `run_id` 是否持久化，未核实 | **实现期探针 P-2**，不是设计裁决 | 开工第一件事跑探针；若无，先补一条 run_id 记账 |
| **4** | 「恢复检查点」指不到任何契约操作 | **待人类裁决**（三候选 a/b/c） | `domain.md` 三·②。**推荐 (c)**：不渲染该按钮，TW-P0-3 记 0.7 |
| **5** | 是否需要新的 AG-UI 业务态事件名 | **契约面未定** | 见第四节。**倾向不新增** |
| **6** | 第 ① 件零截图（G-01 ～ G-08） | **材料缺口** | `ui-prototyper` 交付 8 屏；在此之前 `lint-ui-material` 对本束报判定④ 是正确的红 |
| **7** | `stepId` 继承靠「content 逐字相等」的启发式，已知会误判 | **契约不够，但无更好方案** | 引擎侧 payload 无 id（`agui-state-events.ts:38-41` 实测）。I-8 是兜底。**要人类明确接受** |
| **8** | 本束尚无 feature 编号 | **流程缺口** | `covers:` 当前为空；签核后由 `requirement-author` 生成 feature 再追加（追加规则见 `contract-design.md` 「covers 追加规则」三条件） |

---

## 四、要不要新的 AG-UI 事件名（I-14 的展开）

反证门 `apps/api/tests/agent-runtime/agui-bridge-state-events.test.ts` 的白名单
`PLUMBING_CUSTOM_EVENT_NAMES = {chat_thread_id, chat_message_id}` 是**封闭**的
（该文件 `:73-76` 实测），三条断言 `:252-255` / `:267` / `:281` 会因任何未具名的
`STATE_DELTA` / `CUSTOM` 变红。

**本束的结论：倾向不新增任何业务态事件名。** 理由：

- 计划账本的**权威读面是 `UC-1 getPlanLedger`（HTTP 读模型）**，不是 SSE 事件。
  界面在 run 期间靠既有轮询 + 既有 `STATE_SNAPSHOT` 拿到引擎侧变化即可。
- 现有 `STATE_SNAPSHOT`（`copilotkit-agui.controller.ts:389-392`）已经是本束
  `UC-2 ingestEnginePlanSnapshot` 的**同一个触发点**——复用它，不建第二条触发路径。
- 新增一个事件名的成本不只是加一行白名单，而是**必须同时新增一条「什么时候不发它」的反证用例**
  （I-14），否则白名单一放宽，那三条断言就从「守着零业务态」退化成「守着一个越来越长的名单」。

⇒ **若实现期发现非新增不可**（例如 `phase` 变化必须实时推送），
补法是**具名条目 + 真实生产者 + 一条新反证**三件齐，**不许放行整类**。
建议的名字与生产者预先登记在此，供签核时一并看：

| 候选事件名 | 类型 | 真实生产者 | 什么时候**不**发（反证） |
|---|---|---|---|
| `plan_ledger_revision` | `CUSTOM` | `UC-2`/`UC-3-6` 写账本成功后 | run 里没有任何 `write_todos` 且用户没编辑 ⇒ 一条都不发 |

---

## 五、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `UC-1 getPlanLedger` | V1 V1a V2 V5 + I-8 I-11 | 必需，且是**唯一**读面 |
| `UC-2 ingestEnginePlanSnapshot` | I-6（无直接判据） | 必需——没有它账本永远为空，V1～V6 全部落空 |
| `UC-3 reorderPlanStep` | V3 | 必需 |
| `UC-4 deletePlanStep` | V3a | 必需 |
| `UC-5 addPlanConstraint` | V3b | 必需 |
| `UC-6 removePlanConstraint` | **无判据要求** | ⚠ **本束主动补的**。理由：加得进撤不掉不叫可编辑。**若人类认为超范围，删掉它** |
| `UC-7 confirmPlan` | V4 | 必需 |
| `UC-8 evaluatePlanGate` | V4 V4′ | 必需，且 V4′ 的可判定性全靠它 |
| `UC-9 pausePlanRun` | V5 | 必需 |
| `UC-10 retryPlanStep` | V6① | 必需 |
| `UC-11 restoreCheckpoint` | V6③ | 🔴 **形状在、能力悬空**。三候选选 (b) 或 (c) 则本操作**应当删除**，不留一个恒失败的接口 |
| `UC-12 deliverPlanToRun` | I-10（V3b 的实质） | 必需——**没有它，「加约束」就是一个只写数据库的假功能** |

⚠ **`UC-12` 是本束的反伪造关键**。TW 卡逐字：「点了没有真实后端读写的按钮，一律判 0」。
「加约束」若只落库不送达，它**有后端读写但对结果无影响**——比死按钮更难被发现。
`deliveredPlanDigest`（`UC-7.out`）就是为了让这一条变成可断言的而存在的。
