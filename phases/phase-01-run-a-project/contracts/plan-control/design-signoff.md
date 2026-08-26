---
bundle: plan-control
phase: "01"
# 束↔feature 映射的权威（ADR-023 决策三）。
# ⚠ 当前为空：本束的 feature 尚未生成（TW-P0-3 在 feature_list.json 里没有编号，
#   2026-08-26 实测 origin/main ef4a511d：218 条 feature 里 grep `workbench|todo|计划|write_todos|TW-P0` 零命中）。
#   签核通过后由 requirement-author 生成 feature 再追加；追加规则见
#   .harness/instructions/contract-design.md「covers 追加规则」三条件。
covers: []
status: pending            # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:              # 确认人（姓名/邮箱）
confirmed_at:              # ISO 8601，且不得晚于签核当下
confirmed_via:             # ⚠ 逐字转写人类给出的选择依据，不得替人类归纳或美化
---

# 契约束 `plan-control` 设计签核

覆盖判据：`.harness/instructions/chat-task-workbench-acceptance.md` **TW-P0-3**
（六态工作流与可编辑计划）。**那份卡是判据的单一事实源，本文件只引用编号，不重抄正文。**

**实测基线**：`origin/main` @ **`ef4a511d`**（2026-08-26 `git fetch` 后实测）。
本包全部「现在有 / 现在没有」的断言都指该 SHA。

---

## 〇、这份包的由来 —— 人类的裁决（逐字）

问题问的是「可编辑计划（TW-P0-3）怎么做」，三个选项，人类选了：

> **「完整做：三个编辑动作 + 回写引擎」**
> 选项原文：扩 op 枚举（调序/删步/加约束）+ 新表 + 读模型 + 把编辑后的 todos 写回引擎 state。
> 代价最大（后端多点 + 全新的状态回写语义），但 TW-P0-3 能真到 1.0，
> 且解锁 P1-5（暂停/恢复/重试单步/检查点）的一半。

⚠ **签核时请连同下面第 ④ 节「代价与你被告知的不一样的地方」一起看。**
`contract-design.md` 的纪律是：设计过程中发现代价超出人类被告知的范围，**如实写出来**，
人类有权据此重新选。第 ④ 节就是那一节，**不是补充说明，是这份包最该先读的部分**。

---

## 一、这个束为什么这样切，为什么是**新束**而不是并进 `chat` 或 `agent-runtime`

两个候选束都读过了（`origin/main` 实测），结论：**它跨两个束，两个束都没有它。**

| | `chat` 束 | `agent-runtime` 束 |
|---|---|---|
| 有没有计划/todos/`write_todos`/六态 | **零命中**（四份 md 全文 grep） | **零命中**（四份 md 全文 grep） |
| 自述的边界 | `usecases.md:22` 把后台任务显式委托 `11-task`；**不主张执行态** | `domain.md:528`「批准卡 / AI 团队面板 / tool-call 明细的**宿主屏**：属 `chat` 束。本束定判定与数据，不定渲染」 |
| 与本束真正相接的地方 | `mutateThread` 的 `expectedVersion`/`VERSION_CHANGED` 并发范式；线程可见性判定；`/chat` 宿主屏 | run / step / checkpoint 实体；编排边界（`usecases.md:788-791`「LangGraph 只用于深度研究、HITL、多阶段生成；…两者不可混用」）；`ProvenanceWriter` |
| 签核状态 | **已 `confirmed`**（2026-07-30） | 已 `confirmed` |

**判据是「不变量互相依赖吗」。** 本束的核心不变量（I-5 编辑与引擎快照互不覆盖、
I-10 送达即成立、I-11 执行中不写引擎）**互相依赖，且不依赖上面任一束的内部不变量**——
它们只**调用**那两个束的判定结果。这正是「该独立成束」的形状。

**为什么不并进 `chat`**：`chat` 已签核。并进去要么触发人类重签整个 `chat` 束
（它有 33 条不变量、27 个 UC），要么走 `covers` 追加规则——而追加的三条件
（UI 已签 / 契约已签 / **零新增设计面**）本束**三条全不满足**：新屏、新错误码、新交互语义。

**为什么不并进 `agent-runtime`**：把「执行中写引擎 state」放进那个束，
会与它自己写下的编排边界（`usecases.md:788-791`）正面顶上——那条边界的原话是
「摄取流水线与规则求值、并发排队、审计写入用持久任务系统…两者不可混用」。
本束的处置（I-11：mid-run 只落本仓账本）**遵守**那条边界，
但把它写进那个束会读成「那个束改口了」。

⇒ **建议：新建 `plan-control` 束**。若人类不同意，替代方案是把整包降级为
`chat` 束下的一份 contract-delta（`chat/agui-bridge-delta-pending.md` 是先例形状），
代价是：**不变量与 coverage 两件会消失**，而它们正是本包里最有价值的两件。

### 🔴 新建束会连带触发一件人类必须自己做的事

`phases/phase-01-run-a-project/design-coherence.md` 的 `covers_bundles` 现在是
**16 束、`status: confirmed`（2026-08-11T23:00:24+08:00）**。
它自己的文件头逐字写着「**新增束必须同时加进这里并重做复核**」，
而 F149（`curated-capability-packs`）留下的先例逐字写着：

> 本次**刻意没有**把它追加到 covers_bundles：…只改 covers_bundles 会把"没看过"谎报成"看过"。
> 人类须先签该束，再复核本文新增的 XC-31，最后**亲自**把该束加入 covers_bundles 并刷新确认时间。

⇒ **我按这个先例，没有碰 `design-coherence.md` 一个字。**
签完本束后，人类需要复核下面第 ⑤ 节的 XC-* 交叉约束，再亲自把 `plan-control`
加进 `covers_bundles`。**在此之前 `claim` 门对本束的 feature 红是预期行为，不是坏了。**

---

## ① UI —— 人看到的界面对不对

材料：本束 [`ui.md`](./ui.md)。

**⚠ 现状：第 ① 件零截图。** `ui-prototyper` 尚未交付，八屏缺口逐条记名为
**G-01 ～ G-08**（`ui.md` 第三节）。`ui-material-map.json` 的映射行已在同一 PR 补上，
所以 `lint-ui-material.mjs` 会对本束报**判定④「目录不存在 / 0 张 png」——那是正确的红**
（`asset-governance` / `research` / phase-12 四束三次同形先例）。

> ⚠ **实测提醒**：本 PR 之前该门控是**全绿的**（2026-08-26 实测 `exit 0`，33 束 792 张全通）。
> 本 PR 会把它变红。这不是回归，是「新束的材料确实还没有」如实变红——
> 但**请知道你签的是一个会让门控变红的 PR**，别在 CI 红的时候以为是别的东西坏了。

### 签核前请重点确认

- [ ] **零截图签不签**。可选：先让 `ui-prototyper` 补画 G-01 ～ G-08 再签；
      或先签 ②③、① 留 pending 并写下书面理由。
      ⚠ **最要命的是 G-02**（编辑态三个动作同屏）——判据三的**全部**界面材料就是它。
- [ ] **删步骤不做二次确认弹窗，改用「已移除『X』· 撤销」**（`ui.md` 2.1 末）。
      理由是账本 append-only（I-2），撤销是重放，二次确认只是把成本前置给每次正确操作。
- [ ] **「暂停」还是「停止」**。I-12 的真实语义是**中止当前 run**，不是冻结。
      写「暂停，可随时继续」而实现是中止 ⇒ 写死文案，反伪造条款判 0。
      **要么改文案为「停止」，要么改语义**——两者选一，不能装作没这回事。
- [ ] **执行中编辑的告知文案**（`ui.md` 2.2）：
      「Agent 正在执行。你的改动会在当前步骤完成后生效。要立刻生效请先暂停。」
      这是 I-11 那条产品行为对用户的**唯一**出口。措辞你不满意的话现在改。
- [ ] **`chat-task-workbench-plan-*` 四个新增锚点**（`ui.md` 第四节末）是否接受。
      它们不进 TW 卡（那是判据的单一事实源，不是锚点登记簿）。
- [ ] **「恢复检查点」按钮渲不渲染** —— 取决于第 ③ 节 🔴 那条三选一。

---

## ② 用例 —— 用例接口与失败模式穷举对不对

材料：本束 [`usecases.md`](./usecases.md)（12 个 UC，失败模式逐条穷举，
统一失败枚举 `PlanControlError` 17 个码）。
支撑：[`domain.md`](./domain.md)（15 条不变量，每条附一行「怎么断言」）+
[`coverage.md`](./coverage.md)（双向 + 8 条缺口）。

### 签核前请重点确认

- [ ] **🔴 判据四的反证是怎么变成可判定的**（`usecases.md` UC-8 反证节）——**请重点看这一条**，
      因为判据四写着「否则 0.3 封顶」，它是本束最容易被做成假的一条。
      判定不依赖任何阈值，靠的是一条实测机制事实：**计划账本只有一个生产者**
      （`copilotkit-agui.controller.ts:389` 的三重条件），简单提问不触发 `write_todos`
      ⇒ `todoCount` 恒 0 ⇒ 恒 `required: false`。
      ⚠ 反证断言必须写成「确认门**从未进入 DOM**」，不是「最终不存在」——
      后者会被一个闪现半秒的门骗过去，而用户真实体验到的就是那半秒。
      ⚠ 反向也要有一条（复杂任务确实被挡住），否则 UC-8 可能整个在空转。
- [ ] **并发是 `basedOnRevision` → `PLAN_REVISION_CHANGED`，不静默覆盖**（I-5）。
      与 `chat` 束 `mutateThread` 的 `expectedVersion` → `VERSION_CHANGED`
      （`packages/contracts/src/chat.ts:539,551,561`）**故意同形不同名**：
      线程版本与计划版本是两条独立时间线，共用字段名会让「改标题」和「改计划」互相误伤。
      **这条请确认——两个方向都有人踩过：共用会误伤，同形不同名会被误认为重复。**
- [ ] **删掉带约束的步骤，约束转孤儿、不静默删**（I-8），且有界面面
      （`chat-task-workbench-plan-orphan-constraint`）。
- [ ] **删 `completed` 的步骤是允许的**（`usecases.md` UC-4 末）——
      它只从计划视图移走，不改写已发生的事实。**这条是产品判断，请拍。**
- [ ] **`UC-6 removePlanConstraint` 是本束主动补的，TW 卡没要求**
      （`coverage.md` 第五节）。理由：加得进撤不掉不叫可编辑。**认为超范围就删掉它。**
- [ ] **🟠 `stepId` 靠「content 逐字相等」继承，已知会误判**（I-6）。
      引擎 payload 里**没有 id**（`agui-state-events.ts:38-41` 实测），这是引擎侧形状，
      本束单方面修不了。后果：引擎把「对比竞品」改成「对比竞品（含定价）」时，
      本束当作新的一步，挂在旧步上的约束**变成孤儿**（I-8 兜底，用户可见）。
      **请明确接受或否决这个启发式。**

---

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面。** 第 ③ 件的落点是：

```
packages/contracts/src/plan-control.ts        ← 尚未创建
```

⚠ **本轮只产出骨架（本目录 5 份 markdown），`plan-control.ts` 尚不存在。**
它是**签核通过后、第一个 feature 开工时的第一件产出**——先写 zod 单源，
再由它生成后端 DTO / 前端 client 类型 / OpenAPI / **前端 mock**
（`contract-design.md` §一）。**mock 不许手写。**

### 3.1 🔴 `mutateThread.in.op` 到底扩不扩 —— **这条必须你来定**

人类的裁决原文写的是「**扩 op 枚举**（调序/删步/加约束）」。
逐字执行会遇到一件裁决时未必知道的事：

- `mutateThread` 的 `op` 是 `z.enum(["create","rename","delete"])`
  （`packages/contracts/src/chat.ts:545` 实测），它是 **`chat` 束已签核契约面的封闭枚举**。
- 它的 `in`/`out` 是**线程**的形状（`title` / `visibilityScope` / `impactScope`），
  塞进 `stepId` / `toIndex` / `constraintText` 会让一个操作同时服务两个领域。
- `contract-design.md` §五-7 的纪律是「枚举的封闭性是要守的性质」——
  扩它是正当的，但**扩已签核束的封闭枚举 ⇒ 触发 `chat` 束的 design-delta 或重签**。

**两个候选，请选一个：**

| | **A. 独立操作集（我的推荐）** | **B. 逐字扩 `mutateThread.op`** |
|---|---|---|
| 形状 | 新建 `packages/contracts/src/plan-control.ts`，12 个操作各自独立（`usecases.md` 的 UC-1…UC-12） | `op` 扩成 `["create","rename","delete","plan-reorder","plan-delete-step","plan-add-constraint"]`，`in` 加 6 个 nullable 字段 |
| 好处 | 两个领域的形状不互相污染；`chat` 束一个字不动 | 逐字符合你的裁决原文；只有一个路由 |
| 代价 | 新增一个契约文件与一条路由 | **触碰已签核的 `chat` 束契约面** ⇒ 需要 `chat` 的 delta/重签；`in` 变成 6 个业务无关字段的并集，`.strict()` 下每次调用都要传一堆 `null` |
| 与已有先例 | 与 `chat`/`agent-runtime` 各自一个 `<bundle>.ts` 的做法一致 | 无先例 |

⚠ **我没有替你选。** 你的原话是「扩 op 枚举」，A 偏离了那句话的字面，
所以它需要你点头，不能由我默认。

### 3.2 新表与读模型

```sql
-- 账本：append-only，(thread_id, revision) 唯一（I-1 / I-2）
CREATE TABLE chat_plan_ledgers (
  thread_id          uuid        NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  revision           integer     NOT NULL,
  engine_epoch       integer     NOT NULL,
  origin             text        NOT NULL CHECK (origin IN ('engine','user')),
  based_on_revision  integer     NULL,
  steps              jsonb       NOT NULL,   -- PlanStep[]，含内嵌 constraints
  created_by         uuid        NULL,       -- origin='user' 时非空
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, revision)
);

-- 孤儿约束（I-8）：宿主 step 消失后仍然可见，不静默删
CREATE TABLE chat_plan_orphan_constraints (
  constraint_id        uuid        PRIMARY KEY,
  thread_id            uuid        NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  text                 text        NOT NULL,
  former_step_content  text        NOT NULL,
  orphaned_at_revision integer     NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
```

**读模型 = `UC-1 getPlanLedger`，一条 SQL 读 `revision` 最大的那一行**，
外加一次孤儿表查询。`phase` / `gate` / `progress` **在读模型里派生，不落库**（I-7）。

⚠ **RLS**：两张表都按 `thread_id` 继承 `chat_threads` 的行级策略，
**本束不另立一套判权**（`chat` 束 F108 是唯一判定处）。

### 3.3 🔴🔴 状态回写语义 —— **本包最需要你看的一节**

裁决原文：「把编辑后的 todos **写回引擎 state**」。可行性已实测，但**有一条做不到**。

**能做到的（实测确认，2026-08-26）**：本仓 `apps/deep-agent-service` 由
`langgraph dev` 提供标准 LangGraph Server REST 面，`langgraph_api` 已装在该服务的 venv 里，
下面三个原语**实存**：

| 原语 | 实测出处 | 本束用它做什么 |
|---|---|---|
| `POST /threads/{id}/state`（`{values, as_node?, checkpoint_id?}`） | `langgraph_api/api/threads.py:557`（路由）+ `:298-323`（实现） | 把编辑后的 todos 写回引擎 |
| `POST /threads/{id}/runs/{run_id}/cancel` | `langgraph_api/api/runs.py:1006` | `UC-9` 暂停 |
| `GET /threads/{id}/history` | `langgraph_api/api/threads.py`（`get_thread_history`） | `UC-11` 的 checkpoint 列表（若做） |

**本仓当前一个都没接**：`deep-agent-model-provider.ts` 只有 `GET`
（`:795-800`），`ThreadStateResponse` 更是只声明了 `values.messages`
（`:166-168`）——**引擎里有 `todos`，本仓读不出来**。

#### 做不到的那一条：**执行中（mid-run）写回不可靠**

`POST /threads/{id}/state` 会写出一个新 checkpoint，但**正在跑的那条 run 持有自己的状态**，
它下一次 `write_todos` 落地时会以引擎自己的账本为准，**把用户刚写进去的覆盖掉**。
⇒ 用户在 agent 跑的时候改计划，改动会**随机地生效或不生效**。

这正是反伪造条款要挡的东西的变种：**有真实读写，但结果不可预期**。

**⇒ 本束的处置（已写死进 I-11 / I-12，请你确认）：**

| 什么时候 | 编辑落到哪 | 用户看到什么 |
|---|---|---|
| **没有活跃 run** | 本仓账本；下一轮 run 创建时经 `UC-12` 送达引擎 | 正常 |
| **有活跃 run** | **只落本仓账本**，`appliedTo: "ledger-only"` | 「你的改动会在当前步骤完成后生效。要立刻生效请先暂停。」 |
| **用户先暂停再编辑** | 账本 + 下一轮 run 送达 | 立刻生效 |

⚠ **这意味着「执行中改计划、立刻改变正在跑的这一步」这件事本束不提供。**
**这是产品行为，不是技术细节，必须你签。** 不接受的话，唯一的替代是
「编辑即强制暂停」——把选择从用户手里拿走，请一并考虑。

#### 冲突：agent 自己改了 todos 怎么办

| 情况 | 处置 | 不变量 |
|---|---|---|
| 引擎写快照 | **永远接受**，`engineEpoch` 递增 | I-6 |
| 用户编辑，`basedOnRevision` 是最新 | 接受 | I-5 |
| 用户编辑，其间引擎写过新快照 | **拒绝** `PLAN_REVISION_CHANGED`，界面浮出「Agent 刚更新了计划，你的改动没有丢——查看差异 / 重新应用」 | I-5 |

⚠ **两个方向都不许静默**：不许丢用户的输入，也不许覆盖 agent 的新版。

### 3.4 「加约束」怎么进入下一轮 —— 🔴 **A/B 待你选**

（完整对照表在 `domain.md` 第三节 ①，这里只放结论与你要拍的那一下。）

| | **A. system 消息注入（推荐 V1）** | **B. `configurable.plan_constraints`** |
|---|---|---|
| 改哪 | **只改 Node 侧** | **必须同时改 `apps/deep-agent-service`**（Python，跨语言栈、跨部署单元）——`configurable` 只负责把值送到远端，远端不读就等于没送 |
| 与 `org_skills` / `script_protocol` 打架吗 | 不打架，是不同通道 | 键名不冲突（加键是加法），但会变成**第三个** per-run 配置键，三处各自决定「缺席怎么办」——本仓「同一事实多处声明」的高发形状 |
| 局限 | 约束**到不了 `call_skill` 发起的子模型调用**（那次调用的 system prompt 是 skill 正文——这正是 #1747 当初为 `script_protocol` 选 `configurable` 的原话，见 `deep-agent-model-provider.ts:762-769`） | 无此局限 |

**推荐 A**：判据三只要求「加约束」这个编辑动作存在、真的写进后端、并送达下一轮，
它没有要求约束穿透 `call_skill`。A 能在不碰 Python 服务的前提下满足 I-10。

⚠ **无论选哪个，`UC-7.out.deliveredPlanDigest` 都不变**：
它是**实际送出去那段正文的哈希**，让「约束真的被送达」变成可断言的。
**没有它，「加约束」就是一个只写数据库的假功能**——比死按钮更难被发现。

### 3.5 新的 STATE/CUSTOM 事件名与反证门

**结论：倾向不新增。** 理由与「万一要加怎么加」在 `coverage.md` 第四节，摘要：

- 权威读面是 `UC-1 getPlanLedger`（HTTP 读模型），不是 SSE；
- `UC-2` 复用**既有** `STATE_SNAPSHOT` 生产者（`copilotkit-agui.controller.ts:389-392`），
  不建第二条触发路径。
- 若实现期非加不可：**具名条目 + 真实生产者 + 一条新的「什么时候不发它」反证**，三件齐，
  **不许放行整类**（`agui-bridge-state-events.test.ts:70-71` 逐字写着这条纪律）。
  预登记的候选名与其反证已列在 `coverage.md` 第四节表里。

### 3.6 错误码语义跨束一致

`NOT_VISIBLE` / `NO_WRITE_ROLE` / `THREAD_ARCHIVED_READONLY` / `AUDIT_SINK_UNAVAILABLE`
四个码**与 `chat` 束同码同义**，`plan-control.ts` 里**不另起一份名字**
（`chat.ts:561-562` 实测已有前三个）。

### 3.7 响应体也要被契约校验

`contract-design.md` §五-6。本束的 `UC-1` 出参是**读模型派生**——
服务端多下发一个字段不会有任何门控变红（前端类型也从同一份契约生成）。
⇒ `UC-1` 必须有 `out.safeParse()` 的**反向断言**（证明 schema 确实会拒绝多余字段），
**并特别覆盖拒绝路径**。

---

## ④ 代价与你被告知的不一样的地方 —— **请先读这一节**

你是在「**代价最大（后端多点 + 全新的状态回写语义），但 TW-P0-3 能真到 1.0**」
这个理解下选的完整方案。逐条核过之后，**有三处比那句话更贵，一处比那句话更便宜**：

### 更贵 ①：TW-P0-3 **达不到 1.0**，除非扩大到另一个已签核束

判据六第三个恢复动作「恢复检查点」，在本仓**指不到任何契约操作**
（`chat` 无；`agent-runtime` 只有 `replayAgentRun`，而「重放一次已结束的 run」
≠「把线程恢复到某个 checkpoint 继续跑」，那个束自己把它标成 `coverage.md:249` 的**缺口 25**）。
引擎侧原语实存，但本仓一行没接。

三个候选：

- **(a)** 本束新增 `restoreCheckpoint`，**接受它触碰 `agent-runtime` 已签核束的领域**
  （run/checkpoint 是那个束的实体）⇒ 那个束需要 delta 或重签。
- **(b)** 把「恢复检查点」从 TW-P0-3 判据六撤下来，改成两个恢复动作
  ⇒ **要改验收卡**（单一事实源，是你的动作）。
- **(c) 【我的推荐】** 本轮做前两个恢复动作，第三个显式记为已知缺口，
  **TW-P0-3 拿 0.7 不是 1.0**，那个按钮**不渲染**（渲染一个恒失败的按钮 = 死按钮，判 0）。

⇒ **「能真到 1.0」这句话，按 (c) 是不成立的。** 你有权据此重新选整个方案。

### 更贵 ②：如果「加约束」选 B，要改 Python 服务

见 3.4。你被告知的是「后端多点」，而 B 是**另一个语言栈、另一个部署单元**。
选 A 可以避免，但 A 有 `call_skill` 穿透的局限。

### 更贵 ③：三件裁决之外的连带工作

| 连带项 | 为什么 | 大小 |
|---|---|---|
| `design-coherence.md` 需要人类重做复核 | 新增束；F149 先例明确禁止 agent 代加 | **你的动作**，不是工时 |
| `ui-material-map.json` + 8 屏截图 | 有 `ui.md` 的束必须有截图目录；否则门控红 | 一轮 `ui-prototyper` |
| `ThreadStateResponse` 要能读 `todos` | 现在只声明了 `values.messages`（`:166-168`） | 小 |
| 反证门白名单（若新增事件名） | 具名 + 生产者 + 新反证，三件齐 | 小，但**不许省** |
| **与在飞的线排队** | 约束注入点落在 run 创建时组装 `messages` 处，`execute-run.ts` 当前有可视化提示词那条线在改同一处 | **必须排在其后，不能并行** |
| 两个实现期探针 | **P-1**：`deepagents` 的 `todos` 通道 reducer 是覆盖还是追加（决定 `POST state` 要不要带 `as_node`）——**我没能从已装的包里确认**；**P-2**：远端 `run_id` 是否被持久化（`UC-9 pause` 的前提） | 开工第一件事跑，各 < 1 小时 |

### 更便宜 ①：状态回写的**原语已经存在**，不需要自己造

你被告知的是「全新的状态回写语义」。语义确实是全新的（本仓从没写过引擎 state），
**但传输层不用自己发明**：`POST /threads/{id}/state` 和
`POST /threads/{id}/runs/{run_id}/cancel` 都是本仓已装的 `langgraph_api` 的标准路由
（实测出处见 3.3 表）。要写的是**规则**（谁赢、什么时候写、冲突怎么办），
不是协议。这一半比预期便宜。

---

## ⑤ 本束与哪些束有交叉约束（留给阶段一致性复核）

| # | 交叉点 | 对方 | 为什么必须在复核时看 |
|---|---|---|---|
| **XC-A** | **并发版本语义**：本束 `basedOnRevision`/`PLAN_REVISION_CHANGED` vs `chat` 束 `expectedVersion`/`VERSION_CHANGED` | `chat`（已签核） | 同形不同名是**故意的**。复核要确认这不是第二份副本，而是两条独立时间线 |
| **XC-B** | **编排边界**：本束 I-11「mid-run 不写引擎」是否与 `agent-runtime` 的「LangGraph 只用于深度研究/HITL/多阶段生成…两者不可混用」（`usecases.md:788-791`）一致 | `agent-runtime`（已签核） | 本束**遵守**那条边界。复核要确认没有把它读成「那个束改口了」 |
| **XC-C** | **checkpoint 归属**：`restoreCheckpoint` 若做，run/checkpoint 是谁的实体 | `agent-runtime`（已签核，I-49） | 第 ④ 节候选 (a) 会**回头触碰已签核束**——这正是 `research` 束当年出问题的同一种形状 |
| **XC-D** | **审计写入**：本束 I-13 复用 `ProvenanceWriter`，不另建 | `agent-runtime` + phase-00 `identity` | 各造一个审计面就是本仓第 N 次「同一事实多处声明」 |
| **XC-E** | **可见性与写权判定**：本束全部 `pre` 都委托 `chat` UC-0 | `chat`（已签核）+ phase-00 `identity` | 本束**不另立角色枚举**。复核要确认委托是真的（API 层断言，不是前端不渲染） |
| **XC-F** | **`AguiPlanTodoStatus` 三值枚举的封闭性** | `packages/contracts/src/agui-state-events.ts:35`（已在契约里） | 本束 `PlanStepStatus` 与它**逐字相同**且**不得加第四值**（I-2 上方的警告）。这是一份事实两处使用，复核要确认第二处是 `z.infer` 派生而非副本 |
| **XC-G** | **TW 卡的判据 vs 本束的 UC** | `.harness/instructions/chat-task-workbench-acceptance.md` | 判据的单一事实源是那份卡。本束**只引用编号**。复核要确认没有任何一条判据正文被抄进本目录 |

---

## 确认动作

人类逐节核对 ① ② ③（并先读 ④）后，把 frontmatter 的 `status` 改为 `confirmed`，
填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）/ `confirmed_via`
（**逐字转写你给出的选择依据**）。

⚠ **这是人的动作，不是 agent 的。** 该字段受 CODEOWNERS + CI 保护（ADR-023 决策五）。
在此之前 `new-sprint` 与 `claim` 都会拒绝把本束的 feature 开进 sprint。

⚠ **签核时至少要给出四个答案**，否则实现无法开工：

| # | 问题 | 在哪 | 我的推荐 |
|---|---|---|---|
| **①** | `mutateThread.op` 扩不扩（A 独立操作集 / B 逐字扩） | ③ 3.1 | **A**（但它偏离你的裁决原文，需你点头） |
| **②** | 「加约束」的送达通路（A system 注入 / B `configurable`） | ③ 3.4 | **A** |
| **③** | 「恢复检查点」三选一（a 扩到 agent-runtime / b 改验收卡 / c 记 0.7） | ④ 更贵① | **c** |
| **④** | 零截图签不签（先补画 / 先签 ②③） | ① | 先补画 **G-02** 一屏再签 ①，其余可后补 |
