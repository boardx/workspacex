# 契约束 `research` — 签核②：用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。
> 覆盖 feature 与依据 UC 见 `design-signoff.md`（权威）。
>
> ⚠ **本文的端口数量刻意保守。** `OPEN-QUESTIONS.md` 的 **Q-8（实体分几层）未裁**，
> 它决定下面一半端口的主体是 `Research` 还是 `ResearchQuestion`。
> **在裁决前把端口写满，是把未定的范围伪装成已定。**
> 因此本文按推荐方案 B（两层）书写，并逐个标出「若裁 A 则塌缩为哪一个」。
>
> ⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
> 本束的原型材料**极度偏向 happy path**：研究详情屏画的是「已出结论 · 来源 14」，
> 现场屏四行里三行正常；**五份 UC 里的 20 余条异常流程（E1…En × 5）在原型上一条都没有。**
> **别继承这个缺陷。**

---

## 零、统一失败枚举 `ResearchError`

前端据此渲染七态之一（D-36）。
⚠ **凡是已签核束已有的错误码，本束一律复用、不新建**——这是第一批要被审的地方。

### 复用（**不新建**）

| 码 | 来自 | 本束什么时候用 |
|---|---|---|
| `FORBIDDEN_ROLE` | `project` / `org-admin` | 观察者调任何写端口（N-10）|
| `MODEL_UNAVAILABLE` | `agent-runtime`（已签核）| Scout 所用模型不可达（`uc-24-1` E1）|
| `AGENT_RUN_FAILED` | `agent-runtime` | 检索执行失败（`uc-24-2` E1 / `uc-24-5` E1）|
| `QUOTE_REVOKED` | `interview`（已签核）| 证据所依赖的访谈引述已被撤回（X-C）⚠ **失效 SLA 在对方，本束不复述** |
| `SOURCE_OUT_OF_SCOPE` | `recording`（已签核）| 观察者试图经研究读到逐字稿原文（X-B）|

### 本束新增（每一条都附「为什么不能用既有码」）

| 码 | 场景 | 前端应显示 | 为什么必须新增 |
|---|---|---|---|
| `NO_EXTERNAL_SOURCE` | 结论无外部来源却调入库（**N-1**）| 「结论必须挂着外部来源才能进洞察库」+ 指向补充资料 | 这是本域**独有**的发布门槛；既有码没有一个表达「出处不足」|
| `EVIDENCE_IS_DISPUTED` | 「争议 / 不确定」条目调入库（**N-2**）| 「此条按不确定保留，不进洞察库」 | 与上一条**必须分开**——前者是缺出处（可补），后者是有出处但相互矛盾（要判定）。合并会让用户走错补救路径 |
| `CONFLICT_PENDING_HUMAN` | 冲突未经人判定却调入库（**N-5**）| 「先标不确定再上台讨论」 | 与 `EVIDENCE_IS_DISPUTED` 区分：那是**单条**证据不确定，这是**两条结论互斥**且**等人判定** |
| `SOURCE_PREF_VIOLATION` | 检索请求越出 `sourcePrefs`（**N-4**）| 「该来源不在本研究的来源偏好内，先改配置」 | 内部一致性违反，不是权限问题；用 `FORBIDDEN_ROLE` 会误导用户去找管理员 |
| `RESEARCH_ARCHIVED` | 对已归档研究调写端口（**N-7**）| 「该研究已归档」+ 恢复出口 | 归档不是删除也不是无权限 |
| `DECISION_NODE_GONE` | 入库成功但节点回流失败（`uc-24-4` E2）| **非阻断**提示：入库已成，回流失败原因 | ⚠ 这是**部分成功**，不能用任何表示「整体失败」的码——否则前端会回滚已成功的入库 |

⚠ `DECISION_NODE_GONE` 是本节最容易做错的一条：**它必须能与成功结果同时返回**。
端口签名见 2.4。

---

## 一、命令端口（写）

> 每个端口给：签名 · 前置 · 后置 · 可能失败。
> `[Q-8:A]` 标记 = 若 Q-8 裁「一层」，该端口的主体塌缩为 `Research`。

### 1.1 `CreateResearch`

```
CreateResearch(input: {
  scene: text, question: text,
  kind: ResearchKind, depth: ResearchDepth,
  sourcePrefs: SourceKind[], deliverables: Deliverable[],
  groupRef: GroupId | "all", decisionNodeRef: NodeId | null,
  projectRef: ProjectId | null,      // null = Studio 独立发起
}) -> Research
```
- **前置**：调用者非观察者；`question` 非空；`sourcePrefs` 非空（**除非 Q-5 裁为「空=全选」**）；
  `deliverables` 非空；`decisionNodeRef` 存在或为 `null`。
- **后置**：`Research` 已创建并固化七项配置（**N-12**）；进入 `运行中`（枚举待 Q-10）。
  **⚠ 即便 Scout 不可用也必须创建成功**（`uc-24-1` E1）——落 `待运行` + 可重试。
- **失败**：`FORBIDDEN_ROLE` · `VALIDATION_FAILED`（非空校验）。
  ⚠ `MODEL_UNAVAILABLE` **不是本端口的失败**，它属 1.2。

### 1.2 `RunResearch` / `RetryResearch`

```
RunResearch(id: ResearchId) -> ResearchRun
```
- **前置**：研究存在且未归档。
- **后置**：产生一次执行；执行的来源范围 ⊆ `sourcePrefs`（**N-4**）；
  **部分完成的结果必须可见**（`uc-24-2` E1）。
- **失败**：`MODEL_UNAVAILABLE` · `AGENT_RUN_FAILED` · `RESEARCH_ARCHIVED` · `SOURCE_PREF_VIOLATION`。

### 1.3 `AskFollowUp`

```
AskFollowUp(id, text, wantSourceKind?: SourceKind) -> ResearchRun
```
- **前置**：调用者非观察者（**N-10**）；若给了 `wantSourceKind`，它 ∈ `sourcePrefs`。
- **失败**：`FORBIDDEN_ROLE` · `SOURCE_PREF_VIOLATION` · `AGENT_RUN_FAILED`。
- ⚠ **消息本体复用 `chat` 束**（X-H）。本端口只管「这条追问属于哪个研究、要补哪类来源」。

### 1.4 `PromoteConclusionToInsight`（**本束最关键的端口**）

```
PromoteConclusionToInsight(conclusionId) -> {
  insight: CandidateInsight,                    // N-11：候选，不是已采信
  nodeBackflow: Ok | Failed(DECISION_NODE_GONE) // 部分成功，见零节
}
```
- **前置（门控，三条全过才放行）**：
  ① 结论挂 ≥1 条外部来源（**N-1**）
  ② 结论不在「争议 / 不确定」（**N-2**）
  ③ 若涉冲突，该冲突已由人判定（**N-5**）
- **后置**：产生**候选**洞察（**N-11**）；相关证据的 `disposition` 更新（Q-12 未裁前不落枚举值）；
  低置信来源**随之带过去并保持标注**（**N-3**）；
  若 `decisionNodeRef != null`，回流该节点并标注置信度。
- **失败**：`NO_EXTERNAL_SOURCE` · `EVIDENCE_IS_DISPUTED` · `CONFLICT_PENDING_HUMAN` ·
  `FORBIDDEN_ROLE` · `QUOTE_REVOKED`（X-C）。
- ⚠ **禁止乐观 UI**（`uc-24-4` R9）：下游不可用时**不得**显示已入库。

### 1.5 `ResolveConflict`

```
ResolveConflict(conflictId, action: "以样本为准" | "再补一路检索" | "上台讨论",
                actor: UserId) -> ConflictResolution
```
- **前置**：调用者是**引导师**（组长能否 → **Q-14**）。
- **后置**：处置留痕（谁 / 何时 / 选了哪一条），**不可静默删除**（`uc-24-5` R6）。
- **失败**：`FORBIDDEN_ROLE`。
- ⚠ **`上台讨论` 的后果 Q-18 未裁**——端口可接收该值，但**不实现后果**。
  ⚠ **`以样本为准` 不得由系统预选或超时自动执行**（**N-6**）。

### 1.6 `ArchiveResearch` / `CopyResearch`

```
ArchiveResearch(id) -> Research    // N-7：归档，非删除；被引证据不失效
CopyResearch(id)    -> Research    // 只复制七项配置 → Q-4 未裁前不实现
```
- ⚠ **无 `DeleteResearch` 端口。** 原型的提示逐字是「已**归档**该研究主题」`[原型 @16,907,049B]`。
  **不许**因为「一般都有删除」就加一个。

### 1.7 `PinResearch`

```
PinResearch(id, pinned: bool) -> Research
```
- ⚠ 与「标为关键问题」是否同一动作 → **Q-13 未裁前，本端口与结论区那个按钮不合并。**

---

## 二、查询端口（读）

| 端口 | 返回 | 关键约束 |
|---|---|---|
| `ListResearch(filter: {tag?, archived?, groupScope})` | `Research[]` + 计数 | **可见性在数据层过滤**（`uc-24-3` E5），不是渲染层隐藏 |
| `GetResearchPlan(id)` | 三计数 + 证据表 | 计数是**派生值**；缺失返回 `null` 而非 `0`（**N-8**）|
| `GetResearchDetail(id)` | 对话轮 + 四段结果 | 段 ③ 对观察者按 X-B 脱敏；**低置信不得过滤**（**N-3**）|
| `ListLiveResearchTasks(projectId, onlyConflicts?)` | 任务行 + `{total, ready, conflicts}` | `onlyConflicts` 的判据取 `conflicts > 0` 而非状态词（Q-10 未收敛）|
| `ListConflicts(projectId)` | 冲突项 + 三个可选动作 | 动作**不带预选态**（**N-6**）|

⚠ 所有查询端口的计数都是**派生**的。**不许**接受一个 `count` 入参然后原样回显
——那是本仓已确认的「假数据穿透」形状（`asset-governance` coverage.md 第 5 条同型）。

---

## 三、随裁决结果增删的端口（**现在不写签名**）

| 端口 | 依赖 | 若裁则 |
|---|---|---|
| `CreateResearchQuestion` / `ListQuestions` | **Q-8** | 裁 B（两层）才存在；裁 A 塌缩进 1.1 |
| `SaveResearchDraft` | **Q-4** | 裁「要草稿」才存在 |
| `ListResearchTemplates` / `ApplyTemplate` | **Q-4** | 裁「要模板层」才存在。⚠ 这是 `itv` / `survey` 都栽过的「模板层被砍中段」，**但不能因此就发明一个** |
| `EscalateConflictToAgenda` | **Q-18** | `上台讨论` 的后果 |
| `SendToSynthesisStudio` | **Q-11 / X-D** | 🔴 **`interview` 束（已签核）里已经有这个动作的按钮**，目的地却不存在。裁定前**两边都不实现** |

⚠ 第三节存在的意义：**让「还没定的接口」有名字、可见、会在复核里被问到**，
而不是等实现者写代码时顺手创造出来（ADR-020 的立论）。

---

## 四、本束**不**提供的端口

- 洞察库的读写（`14-brain`，phase-03）· 图谱节点的增删（`09-kg`，phase-02）·
  报告的取材与成文（`10-report`，phase-02）· 待办卡（`11-board`，phase-02）。
- 任何 agent / 模型 / MCP 的注册与配置（`agent-runtime`，**已签核**，X-G）。
- 任何对话消息的收发（`chat`，**已签核**，X-H）。
- 任何新的角色或权限模型（`project` / `org-admin`）。

⚠ 这一节不是「以后补」，是「**别处已经有了，本束调用它**」。
