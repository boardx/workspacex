# S070 — Sprint Planning（冲刺计划）

> Type: Work Skill · Domain: Product & Delivery · Strategy: A1（一个 adapt 主源 + 两个 reference-only 源）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文独立作者化（AUTHOR-S070）；v1 模板只作话题提示，正文未沿用。
> 引用 WorkspaceX 现有代码处均已在 baseline 上读过文件；未读过的标 **UNVERIFIED**，尚不存在或未接线的能力标 **proposed-unwired**。

## 1. 这个 Skill 解决什么问题
S070 把「已经排好序、已经切好片的候选条目」和「这支团队在这个时间窗里真实能投入的时间」对齐，产出**一份冲刺预测（forecast）**：一句冲刺目标、承诺集合、stretch 集合、明确不进本冲刺的条目及原因、容量算式与风险。

它回答的是一个算术 + 取舍问题：**在 N 个工作日、这些人、这些已知干扰下，哪些条目能以可接受的把握完成，且它们合起来构成一个有意义的目标**。

S070 **不做**的事（各有唯一归属，读自已作者化的相邻文档）：
| 不做 | 归谁 |
|---|---|
| 候选排序、MoSCoW 切分（以 appetite 为界） | S068 Prioritization（`handoff.S070 = { mustIds, shouldIds }`，`skills/S068-prioritization.md` §6） |
| 需求与验收条件、PRD 就绪判定 | S067 PRD / Spec Writing（`PrdReadiness`，mode = readiness） |
| 把 PRD + 原型切成工作项草稿 | S076 Design Handoff（`workItemDrafts`，草稿不含估点/负责人/sprint） |
| 建卡、指派负责人、卡片状态流转 | S142 Work Item Management（`sprint-commit` 模式） |
| 季度/半年路线图的时间段划分 | S069 Roadmap Planning |
| 冲刺回顾、看板流动分析 | 当前无 Skill，D015 gaps 列已记「Retrospective facilitation; Kanban flow analysis」 |

S070 的两个核心风险：**过度承诺**（把 100% 甚至更多的名义容量排满）和**无目标的清单**（承诺集合里的条目彼此无关，冲刺结束时说不出交付了什么）。§4 的 P3、P7 与 §6 不变式 3、5 专门围住这两点。

## 2. 图上的消费者（逐条从矩阵读出，不推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行原文 | S070 在其中的用途 |
|---|---|---|
| W030 PRD-to-Sprint | `\| W030 \| PRD-to-Sprint \| Product \| S067, S068, S070, S142, S076 \|` | `mode = plan`：吃 S067 就绪结果、S068 切分、S076 草稿，产出 `SprintPlan`，交给同一 Workflow 内的 S142 `sprint-commit` 落卡 |

S070 只出现在 W030 一行。W032 Roadmap Review（S069, S068, S072, S009, S008, S155）、W053 Weekly PMO Review（S143, S142, S144, S145, S155, S010）、W002 Meeting-to-Actions（S006, S017, S142, S007）**都不含** S070；这些 Workflow 运行时不会调用 S070（ADR-118 决策 9，已读 `docs/adr/ADR-118-generic-workflow-runtime.md:26`）。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md，只代表直接调用）
| DigitalHuman | 矩阵行 | 该行 Workflow | 该行 Skill 列 | 该行 gaps 列 |
|---|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | S061, S009, S064, S065, S067, S068, S069, **S070**, S071, S072, S073, S074, S008, S075 | — |
| D015 Agile / Product Operating Model Coach | 第 21 行 | W030, W032, W053, W002 | **S070**, S068, S069, S142, S153, S143, S156 | Retrospective facilitation; Kanban flow analysis; Product operating model health |

直接调用场景：
- D003 在对话里对一份手工给出的 backlog 做 `mode = plan`（不经 W030，因此没有 S067/S076 的前置产物，见 P1 的降级规则）；或在冲刺中途做 `mode = replan`。
- D015 在对话里对一份已有计划做 `mode = review`（诊断过度承诺、目标缺失、结转失真），**不改写**计划。

说明：本次第一批数字人收缩为 3 个，D015 不在 D001–D010 范围内；但矩阵边仍在，本文照列，不删边。

## 3. 上游来源与许可（G1）
| 来源 | 路径 | SHA / 版本 | 许可（artifact 级） | 处理方式 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins（本地克隆 `scratchpad/upstream/knowledge-work-plugins`） | `product-management/skills/sprint-planning/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7`（该路径最后一次提交也是此 SHA） | Apache-2.0（`product-management/LICENSE`） | **adapt**。采用：输入五项 Team / Sprint length / Backlog / Carryover / Dependencies（:41-45）；容量扣减 PTO、会议、on-call（:3, :27, :57）；承诺 vs stretch 分层（:63-65, :93）；「按 70–80% 容量计划」（:91）；「目标一句话说不清就是不聚焦」（:92）；「结转前先弄清为何没交付」（:94）。**不采用**：P0/P1/P2 自评优先级列（:61-65）——优先级归 S068，S070 只透传名次（决策 2）；每行 `Owner` 列（:61）——负责人归 S142；泛化 DoD 清单（:74-78）——DoD 属团队约定，由输入给出，不由 Skill 生成。 |
| RefoundAI/lenny-skills（本地克隆 `scratchpad/upstream/lenny-skills`） | `skills/planning-cadence/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`，Copyright (c) 2025 Refound AI） | **reference-only**。只借两点作校验依据：「Planning without strategy」反模式（:81）→ P7 要求冲刺目标挂到上游需求/目标；「75% Weekly Goals」（:63）作为 70–80% 缓冲的第二个独立佐证。不复制播客引语。 |
| The Scrum Guide 2020（Schwaber & Sutherland，scrumguides.org） | 2020 年 11 月版全文（非 git 仓库，无 SHA；以版本年月定位） | 2020-11 | CC BY-SA 4.0（指南自身声明） | **reference-only，只借概念不借文字**：Sprint Goal 是单一目标、Sprint Backlog 是开发者的**预测**而非合同、计划中范围可协商而目标不变。这是决策 1「forecast 而非 commitment 语义」和 `replan` 模式「目标不变、范围可调」的依据。CC BY-SA 的相同方式共享义务只在复制/改编文本时触发，本文未复制文本。 |

- 按 Apache-2.0 §4(b)(c)，NOTICE 与改动说明写入 Skill 包的 `references/upstream.md`；上游要点均已中文重述。
- 两个 reference-only 源满足 A1「≥2 个最佳实践来源」。

## 4. 专业方法（S070 专属步骤）
### P1 入口检查（只读，不修前置产物）
- `mode = plan` 且由 W030 调用：要求 `prdReadinessRef` 指向的 S067 `PrdReadiness.status = "ready"`，以及 `handoffRef` 指向的 S076 输出 `readiness ∈ {ready, ready-with-gaps}`；为 `ready-with-gaps` 时要求 `gapsAcceptedBy ≠ null`（由 W030 人工闸门写入）。不满足 → `PRECONDITION_NOT_READY`，并逐条列出缺哪项。
- 直接调用（D003）且没有这两个引用：允许继续，但输出 `entry.mode = "unverified-backlog"`，每个候选的 `traceability = "none"`，冲刺目标只能挂到调用方给出的 `goalAnchors`（P7）。
- 候选全集 = S076 `workItemDrafts` ∪ 结转条目 ∪（仅直接调用时）调用方手工条目。**W030 中不接受草稿之外的新故事**（对齐 S076 E15：「S070 没有收到在草稿之外自造的故事」）。

### P2 可用人日（逐人，逐日）
1. 取冲刺窗口 `[startDate, endDate]` 内的工作日：`market = CN` 必须带 `workCalendarRef`（含法定节假日与调休上班日）；缺失 → `CALENDAR_UNRESOLVED`，不猜。`US` 用组织配置的假日表（`holidayCalendarRef`），缺失时按周一至周五并在 `assumptions[]` 写明「未扣联邦/公司假日」。
2. 每人：`availableDays = workingDays − ptoDays − (ceremonyHours + recurringMeetingHours)/hoursPerDay − onCallDays × onCallDrag`。`onCallDrag` 缺省 0.5，调用方可覆盖。`allocation`（0–1，兼职/跨团队）最后相乘。
3. 结果写进 `capacity.people[]`，每一项扣减都带来源（`declared-by-caller` 或 `server-roster`，见 §8）。

### P3 容量换算与负载上限
- **有历史**（`velocityHistory` 至少 3 个已结束冲刺）：`baseVelocity = 最近 3 个冲刺完成点数的中位数`（用中位数而不是均值，抵消一次异常冲刺）；`capacityPoints = baseVelocity × (本冲刺总可用人日 / 那 3 个冲刺总可用人日的中位数)`。
- **无历史或不足 3 个**：`capacity.basis = "cold-start"`，只按人日计（`unit = "person-days"`），负载上限降到 60%，并在 `risks[]` 自动加一条 `kind = "no-velocity-baseline"`。
- 负载上限：`committedLoad ≤ loadCeiling × capacity`，`loadCeiling` 缺省 0.8，允许 0.6–0.85；调用方给 > 0.85 → `INPUT_INVALID`（决策 3）。`stretch` 另计，`committedLoad + stretchLoad ≤ 1.0 × capacity`。

### P4 估点来源
- 每个候选的 `estimate` 必须带 `source ∈ {team, carryover-remaining, skill-proposed}`。
- `skill-proposed` 估点只能用于 stretch 或 `excluded`，**不能进入 committed**（不变式 4，决策 4）。没有团队估点的 must 条目 → 放进 `needsEstimate[]`，冲刺计划状态为 `draft-needs-estimates`，不是 `ready-for-commit`。
- 刻度：`fibonacci`（1,2,3,5,8,13）或 `person-days`，整份计划只允许一种；单条 > 8 点（或 > 5 人日）的条目 → `tooLarge[]`，建议交回 S076 再切，不进 committed。

### P5 结转处理
- 结转条目必须带 `carryReason ∈ {underestimated, blocked-external, blocked-internal, interrupted, scope-grew, deprioritized-midsprint}`，没有原因 → `CARRYOVER_REASON_MISSING`（上游 :94 落到可校验层）。
- 结转条目用「剩余估点」而不是原始估点；`carryReason = underestimated` 且连续第 2 次结转 → 强制进 `risks[]`（`kind = "chronic-carryover"`），并建议拆分。
- 结转条目默认排在同名次新条目之前（在制品优先完成），但仍受 S068 名次约束：结转条目若在 S068 本轮已被标 `wont`，进 `excluded(deprioritized)`，不自动续命。`wont` 标记不在 S068 给 S070 的 handoff（只有 `{ mustIds, shouldIds }`）里，由服务端经 `prioritizationRef` 读 S068 输出的 `cut.wont` 得到。

### P6 选择（贪心 + 依赖 + 共享组件前置）
按以下顺序填 committed，直到触到负载上限：
1. S068 `mustIds`（按其给出的顺序），结转条目在同名次内前置；
2. S068 `shouldIds`；
3. 其余进 stretch，再装不下的进 `excluded(over-capacity)`。
约束：
- `kind = "shared-component"` 的草稿若被某个 committed 纵向切片依赖，必须同样 committed，且排在它之前；装不下则那条切片也不进 committed。
- 外部依赖（`dependencies[].party = "external"` 且 `status ≠ "resolved"`）的条目不进 committed，进 stretch 并在 `risks[]` 写 `kind = "external-dependency"`，附对方名称与预计解决日。
- must 条目放不进 committed 时，**唯一去向是 `stretch`**，`whyStretch = "must-not-fit"`，同时其 id 写进 `mustNotFit[]`（纯标注），计划状态 `over-scope`，交给 W030 人工闸门决定：缩 must（回 S068）或延长冲刺（不由 Skill 决定）。must 条目**永不进 `excluded`**（`dependency-cycle` 的 must 直接报错，见 §10）；本条优先于上面第 3 步的 over-capacity 规则。

### P7 冲刺目标
- 一句话，≤ 40 个汉字或 ≤ 25 个英文词（上游 :92 落到可校验层）。
- 必须挂到 ≥ 1 个 committed 条目覆盖的 `requirementId`（W030）或调用方 `goalAnchors`（直接调用）；
- **只靠 committed 集合就能达成**：若目标描述的结果依赖某个 stretch 条目 → `goal.status = "depends-on-stretch"`，不合格；
- 目标不得是条目标题的拼接（检测：目标文本与任一条目标题的字符重合 > 70%，或含 ≥ 3 个顿号/逗号分隔的并列功能名）。

### P8 风险与集中度
- 每人承诺负载 > 其个人容量 → `risks[kind = "individual-overload"]`（只在调用方给出 `assigneeHints` 时评估；S070 不指派）；
- 单人承担 > 50% committed 点数 → `kind = "bus-factor"`；
- 冲刺最后 2 个工作日有团队成员 PTO 且其承诺条目 ≥ 5 点 → `kind = "end-of-sprint-absence"`。

### P9 模式差异
- `replan`（冲刺中途，D003）：输入当前计划 + `asOf` + 新增/变更条目；**目标文本不可改**（Scrum Guide 概念），只允许换出等量点数的非目标条目；若新条目使目标不可达 → `goal.status = "invalidated"`，建议人类决定是否取消冲刺，Skill 不自己改目标。
- `review`（D015 / D003）：输入一份现成计划（本 Skill 输出或手填），只输出 `findings[]`，不输出新的 committed 集合。

### P10 交接
- W030：`handoff.S142.candidates` 按 S142 `WorkItemCandidate` 形状**只给出 committed**。S142（已 PASS）的 `WorkItemCandidate` 输入没有可区分 committed/stretch 的字段，`unwiredFields` 是 S142 的输出（`field` 仅 sprintId/sourceKind/originRefs），S070 不得往候选里塞该字段。stretch 只保留在 `SprintPlan.stretch` 中供 W030 人工闸门查看，冲刺中途要拉入时经 `mode = replan` 重新产出计划再交接。给 S142 输入加标记的提议见 §14 提议 6。sprint 归属由 S142 自己写入其输出 `unwiredFields.sprintId`。
- S070 自身**不写**任何卡片或看板。

## 5. 输入契约（`inputSchema`）
```ts
type SprintPlanningInput = {
  mode: "plan" | "replan" | "review";
  locale: "zh-CN" | "en-US";
  market: "CN" | "US" | "global";
  sprint: { name: string; startDate: string; endDate: string;   // ISO date；endDate ≥ startDate，窗口 5–30 个自然日
            timeZone: string };                                  // IANA
  workCalendarRef?: string;          // market=CN 必填（调休日历版本）
  holidayCalendarRef?: string;       // US 可选
  team: {
    teamId: string;                  // 服务端据此取 roster（§8），调用方给的 members 仅作补充声明
    members: Array<{ principalId: string; allocation: number;   // 0 < allocation ≤ 1
                     ptoDates?: string[]; onCallDates?: string[];
                     recurringMeetingHoursPerWeek?: number }>;
    hoursPerDay: number;             // 4–10，缺省 8
    ceremonyHours: number;           // 本冲刺全部仪式小时数/人
    onCallDrag?: number;             // 0–1，缺省 0.5
  };
  estimation: { unit: "points" | "person-days"; scale?: "fibonacci" };
  velocityHistory?: Array<{ sprintId: string; completedPoints: number; availablePersonDays: number }>; // ≤ 12
  loadCeiling?: number;              // 0.6–0.85，缺省 0.8
  prdReadinessRef?: { skill: "S067"; outputId: string };        // W030 必填
  handoffRef?: { skill: "S076"; outputId: string };             // W030 必填
  prioritizationRef?: { skill: "S068"; outputId: string };      // W030 必填；服务端读 handoff.S070
  candidates: Array<{
    candidateId: string;             // W030 中 = S076 draftId；结转 = 原 taskId
    title: string;
    origin: "s076-draft" | "carryover" | "manual";              // manual 仅直接调用
    draftKind?: "vertical-slice" | "shared-component";
    requirementIds?: string[];
    estimate?: { value: number; source: "team" | "carryover-remaining" | "skill-proposed" };
    carryReason?: CarryReason; carryCount?: number;
    dependencies?: Array<{ on: string; party: "internal" | "external"; status: "resolved" | "open"; expectedBy?: string }>;
    assigneeHint?: string;           // 仅用于 P8 评估
  }>;                                // 1–150
  goalAnchors?: string[];            // 直接调用时的目标锚点（OKR / 路线图条目文本或 id）
  currentPlan?: SprintPlan;          // replan / review 必填
  asOf?: string;                     // replan 必填
};
```
输入不变式：
- `mode = plan` 且调用上下文为 W030 ⇒ `prdReadinessRef`、`handoffRef`、`prioritizationRef` 均必填；
- `origin = "manual"` 与 W030 上下文互斥；
- `candidateId` 唯一；`dependencies[].on` 必须指向本输入中的 candidateId 或以 `ext:` 开头；
- `estimation.unit = "person-days"` 时不得出现 `scale`。

## 6. 输出契约（`outputSchema`，S070 专属）
```ts
type SprintPlan = {
  planId: string; mode: "plan" | "replan"; sprint: Sprint;
  status: "ready-for-commit" | "draft-needs-estimates" | "over-scope" | "goal-invalid";
  entry: { mode: "w030-verified" | "unverified-backlog"; prdReadiness?: "ready"; handoffReadiness?: "ready" | "ready-with-gaps"; gapsAcceptedBy?: string };
  capacity: {
    unit: "points" | "person-days"; basis: "velocity" | "cold-start";
    workingDays: number; calendarRef: string | null;
    people: Array<{ principalId: string; availableDays: number;
                    deductions: Array<{ kind: "pto" | "ceremony" | "meeting" | "on-call" | "allocation"; amount: number; source: "server-roster" | "declared-by-caller" }> }>;
    totalPersonDays: number;
    baseVelocity?: number; velocitySprintIds?: string[];
    capacity: number; loadCeiling: number;
  };
  goal: { text: string; requirementIds: string[]; anchors: string[];
          status: "ok" | "depends-on-stretch" | "is-list" | "invalidated" };
  committed: Array<{ candidateId: string; estimate: number; estimateSource: "team" | "carryover-remaining"; s068Tier: "must" | "should" | "none"; reason: "must" | "should" | "carryover" | "shared-prerequisite" }>;
  stretch: Array<{ candidateId: string; estimate: number | null; estimateSource: EstimateSource; whyStretch: "capacity" | "external-dependency" | "skill-estimate-only" | "must-not-fit" }>;
  excluded: Array<{ candidateId: string; why: "over-capacity" | "deprioritized" | "too-large" | "dependency-cycle" }>;
  mustNotFit: string[];   // 标注：⊆ stretch 中 whyStretch = must-not-fit 的 candidateId
  needsEstimate: string[]; tooLarge: string[];
  load: { committed: number; stretch: number; committedRatio: number };   // committedRatio = committed / capacity
  risks: Array<{ kind: "no-velocity-baseline" | "external-dependency" | "chronic-carryover" | "individual-overload" | "bus-factor" | "end-of-sprint-absence"; refs: string[]; detail: string }>;
  assumptions: string[];
  handoff: { S142?: { mode: "sprint-commit"; candidates: WorkItemCandidate[] } };   // 形状取自 S142 §6
};
type SprintPlanReview = { planRef: string; findings: Array<{ code: ReviewCode; refs: string[]; detail: string }> };  // mode = review 唯一返回
// ReviewCode: OVER_CEILING | GOAL_MISSING | GOAL_IS_LIST | GOAL_DEPENDS_ON_STRETCH | SKILL_ESTIMATE_COMMITTED | CARRYOVER_NO_REASON | CHRONIC_CARRYOVER | NO_BUFFER_COLD_START | SHARED_COMPONENT_ORDER
```
输出不变式（`scripts/check-sprint-plan.mjs`，proposed-unwired，§12）：
1. 每个输入 `candidateId` 恰好出现在 `committed`、`stretch`、`excluded`、`needsEstimate`、`tooLarge` 之一（`mustNotFit` 只是标注，不单独计）；must 条目只能在 `committed`、`stretch`、`needsEstimate`、`tooLarge`，永不在 `excluded`；`mustNotFit` = `stretch` 中 `whyStretch = "must-not-fit"` 的 id 集合。
2. `load.committed = Σ committed.estimate`，`load.committedRatio ≤ capacity.loadCeiling`（cold-start 时 ≤ 0.6）。
3. `status = "ready-for-commit"` ⇒ `goal.status = "ok"` ∧ `needsEstimate = []` ∧ `mustNotFit = []`。
4. `committed[].estimateSource ≠ "skill-proposed"`。
5. `goal.requirementIds ⊆ ⋃ committed.requirementIds`（W030）；直接调用时 `goal.anchors ⊆ goalAnchors`。
6. 若 committed 含依赖 shared-component X 的切片，则 X ∈ committed。
7. `mode = replan` ⇒ `goal.text = currentPlan.goal.text`。
8. 不出现 `priority`、`owner`、`assignee` 字段（决策 2）；`handoff.S142.candidates[].ownerHint` 恒为 `null`。
9. `handoff.S142.candidates` 的 id 集合 = `committed` 的 id 集合（stretch 不交接，见 P10）。

类型化错误：
| 错误码 | 触发条件 |
|---|---|
| `INPUT_INVALID` | schema 或输入不变式违例（含 `loadCeiling > 0.85`） |
| `PRECONDITION_NOT_READY` | W030 中 S067 非 ready，或 S076 为 not-ready，或 ready-with-gaps 未经人工接受 |
| `REF_NOT_FOUND` | 任一 `*Ref` 不存在或对调用方不可见（同一码，不泄露存在性） |
| `PRIORITY_STALE` | S068 输出的候选 id 集合与 S076 草稿 id 集合对不上（S068 基于旧草稿） |
| `CALENDAR_UNRESOLVED` | `market = CN` 缺 `workCalendarRef`，或日历版本未覆盖冲刺窗口 |
| `CARRYOVER_REASON_MISSING` | 结转条目缺 `carryReason` |
| `DEPENDENCY_CYCLE` | 候选之间依赖成环（成环条目同时进 `excluded(dependency-cycle)`，若为 must 则报错不出计划） |
| `ROSTER_MISMATCH` | 调用方声明的 `principalId` 不在服务端 roster 中 |

`over-scope`、`draft-needs-estimates` 是正常返回，不是错误；它们让 W030 的人工闸门有东西可决策。

## 7. 依赖（能力分类，ADR-120）
- **required**：无外部能力；容量与选择是纯计算。
- **conditional**：`knowledge.read`——W030 中读 S067 / S068 / S076 输出版本，读组织工作日历。该分类是否已在 ADR-120 目录登记：**UNVERIFIED**。
- **conditional**：`team.roster.read`——按 `teamId` 取成员与 allocation。当前没有「团队」实体承载 allocation：**proposed-unwired**。
- **conditional**：`sprint.history.read`——读历史冲刺完成点数。baseline 的任务模型没有估点或 sprint 字段（已读 `apps/api/src/application/board/create-task.ts`：`CreateTaskInput` 有 `ownerUserId` 等字段，无 estimate/sprint；S142 §5.3 也把 sprintId 放进 `unwiredFields`），因此历史速度只能由调用方声明：**proposed-unwired**，在接线之前 `velocityHistory` 视为 `declared-by-caller`。
- **optional**：`sandbox.exec` 运行 `scripts/check-sprint-plan.mjs`（`apps/skill-sandbox/` 目录存在；脚本 proposed-unwired）。
- 无写能力，riskClass = low。落卡是 S142 的事，并受 W030 人工闸门约束。

## 8. 授权边界（调用方声明 vs 服务端核实）
| 项 | 调用方可声明 | 服务端必须核实 |
|---|---|---|
| 能否调用 S070 | — | 直接调用：当前 Agent 已发布版本的 `agent_versions.skill_version_ids` 固定了 S070（字段见 `packages/contracts/src/identity.ts:363,430` 的注释，pin 写入路径 `apps/api/src/application/agent-skill-pins/set-agent-skill-pins.ts`，两处已核实存在）；W030 中：Agent 在 `workflowAllowlist` 里被允许运行该 W030 版本（ADR-118 决策 9）。运行时按 pin 拦截的代码位置：**UNVERIFIED**。 |
| 团队成员 | `members[].principalId` | 每个 principal 必须是 `teamId` 所在组织的活跃成员，否则 `ROSTER_MISMATCH`。roster 实体 proposed-unwired；接线前以组织成员表核实（identity 应用目录存在，具体查询函数 **UNVERIFIED**）。 |
| PTO / 会议 / on-call | 可声明 | 不核实真伪（无日历接线，proposed-unwired）；每条扣减标 `source = "declared-by-caller"`，review 模式在扣减全部来自声明且占比 > 40% 时给提示。**不读取**任何人的请假原因。 |
| 历史速度 | 可声明 | 接线前不可核实，`capacity.basis = "velocity"` 时仍在 `assumptions[]` 写「速度为调用方声明」。 |
| S067 / S068 / S076 引用 | 给 id | 服务端按调用者身份读版本；**不信**调用方内联的就绪状态或 `gapsAcceptedBy`，这两项只以服务端读到的值为准（防止绕过 W030 人工闸门）。 |
| 估点来源 | 可声明 `team` | 声明为 `team` 不做来源核实，但 W030 中 `team` 估点只能随人工闸门的「估点会结果」一起提交（W030 设计问题，见 §14 提议 2）。 |

## 9. CN / US 差异（实质性的）
- **工作日**：CN 有法定节假日**加调休上班日**（周末变工作日），不能按周一至周五推算，因此 `workCalendarRef` 必填、缺失即报错；国庆、春节前后的冲刺窗口经常横跨调休，E4 专测。US 按联邦/公司假日扣减，无调休概念，缺日历只降级为假设。
- **工时假设**：`hoursPerDay` 缺省 8，两地相同；Skill **不接受**用加班时间扩容（`hoursPerDay > 10` 为 `INPUT_INVALID`），CN 场景常见的「周末补一下」不计入容量——这与《劳动法》关于延长工时的限制一致，但 Skill 不做法律判断，只拒绝把加班写进计划基线。
- **休假形态**：US 常见大块 PTO 与感恩节/年末集中休假，P8 的 `end-of-sprint-absence` 更常触发；CN 常见春节前后集中请假拼假期，P2 需要逐日扣减而不是按天数平均。
- **目标句式**：zh-CN 目标以可观察结果开头（「让…能够…」），不以「完成 X、Y、Z」开头（后者触发 `is-list`）；en-US 对应检测 "Complete/Finish X, Y and Z" 结构。

## 10. 失败模式（S070 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 按 100% 名义容量排满 | `committedRatio > loadCeiling` | 不变式 2 拒绝；多出条目移入 stretch |
| F2 | 用 Skill 自己拍的估点做承诺 | committed 含 `skill-proposed` | 不变式 4；条目进 needsEstimate |
| F3 | 目标是清单 | P7 列表检测 | `goal.status = is-list`，`status = goal-invalid` |
| F4 | 目标靠 stretch 才能达成 | 目标 requirementIds 不被 committed 覆盖 | `depends-on-stretch` |
| F5 | 结转条目用原估点重复占容量 | carryover 的 `estimateSource ≠ carryover-remaining` | `INPUT_INVALID` |
| F6 | 慢性结转被静默续命 | `carryCount ≥ 2 ∧ carryReason = underestimated` | 强制 risk + 建议拆分 |
| F7 | 忘记调休，把补班日漏算/把假日算进 | CN 缺日历 | `CALENDAR_UNRESOLVED` |
| F8 | 切片进了冲刺但它依赖的共享组件没进 | 不变式 6 | 切片降为 stretch |
| F9 | must 装不下时 Skill 自作主张删掉或降级 must | 任一 must 出现在 `excluded`，或落在 stretch 却无 `whyStretch = must-not-fit` / 不在 `mustNotFit` | 禁止；must 只进 stretch(`must-not-fit`)，标 `over-scope` 交人工 |
| F10 | 冷启动团队照搬 80% | 无速度历史却 ratio > 0.6 | 不变式 2（cold-start 分支） |

## 11. 评测（`evals/work-stack/S070/`，ADR-119；夹具均为合成数据）
| # | 输入 | 通过标准 |
|---|---|---|
| E1 | 5 人、10 个工作日、无 PTO，速度历史 [30, 42, 34]（对应人日均为 50），must 共 24 点，should 共 12 点 | `baseVelocity = 34`；`capacity = 34`；committed = 全部 must + 不超过 3.2 点的 should（24 + ≤ 3.2 ≤ 27.2）；其余 should 在 stretch |
| E2 | 同 E1，但 1 人整冲刺 PTO、1 人 50% allocation | `totalPersonDays = 35`；`capacity = 34 × 35/50 = 23.8`；must 24 点装不下 → 装不下的 must 全在 stretch 且 `whyStretch = must-not-fit`、`mustNotFit` 与之相等且非空、`status = over-scope`，没有 must 出现在 excluded |
| E3 | 新团队，无 velocityHistory，候选均有 team 估点 | `basis = cold-start`、`unit = person-days`、`committedRatio ≤ 0.6`；risks 含 `no-velocity-baseline` |
| E4 | market = CN，冲刺 2026-09-28 至 2026-10-11，给出含国庆假期与调休上班日的 `workCalendarRef`；另一组不带日历 | 带日历组 `workingDays` 等于日历计算值（夹具内置期望值），调休上班日被计入；不带日历组返回 `CALENDAR_UNRESOLVED` |
| E5 | 一个 must 条目只有 `skill-proposed` 估点 5 | 该条进 `needsEstimate`；`status = draft-needs-estimates`；committed 中无 skill-proposed |
| E6 | 结转条目 C1：`carryReason = underestimated`、`carryCount = 2`、剩余 3 点；另一结转 C2 无 carryReason | 返回 `CARRYOVER_REASON_MISSING`（针对 C2）；去掉 C2 后 C1 进 committed 且 risks 含 `chronic-carryover` |
| E7 | S076 草稿：`shared-component` SC1（5 点）与依赖它的切片 V1（3 点），剩余容量只剩 4 点 | V1 与 SC1 都不在 committed；不出现「V1 committed 而 SC1 不在」 |
| E8 | 一个 should 条目依赖 `ext:payments-team`，status = open | 该条在 stretch，`whyStretch = external-dependency`，risks 含对方名称 |
| E9 | 候选里目标所需的 REQ-7 只存在于 stretch 条目 | `goal.status = depends-on-stretch`，`status ≠ ready-for-commit` |
| E10 | 调用方提议目标「完成登录、注册、找回密码、个人资料」 | `goal.status = is-list` |
| E11 | W030 上下文，S076 输出 `ready-with-gaps` 且 `gapsAcceptedBy = null`；调用方内联声称已接受 | `PRECONDITION_NOT_READY`；内联声明被忽略 |
| E12 | `prioritizationRef` 基于旧版草稿（含已删除的 draft D9） | `PRIORITY_STALE` |
| E13 | `mode = replan`，asOf = 第 6 天，插入一个 5 点紧急缺陷，且提议改写目标 | `goal.text` 不变；换出 ≥ 5 点的非目标条目；若无可换出条目则 `goal.status = invalidated` |
| E14 | `mode = review`（D015），给一份 ratio = 0.95、目标为空的手填计划 | 只返回 `SprintPlanReview`，findings 含 `OVER_CEILING` 与 `GOAL_MISSING`；无 committed 字段 |
| E15 | members 含另一组织的 principalId | `ROSTER_MISMATCH`，输出中不出现该 principal 的任何扣减信息 |
| E16 | 集成（W030 套件，不计入 G5 计数）：S076 输出 4 张草稿 → S070 → S142 | S142 收到的 candidates 数 = committed 数（stretch 不交接），id 集合与 committed 相等，且 `ownerHint` 全为 null；没有草稿之外的条目 |

打分：不变式 1–8、E1–E8、E11–E15 由脚本判定（算术与集合比较）；E9、E10 的目标文本判定由规则 + LLM-judge rubric，G5 前人工抽检 20%。

## 12. WorkspaceX 落位
- **Skill 包**：新建 `skills/standard-methods/sprint-planning/SKILL.md`（`skills/standard-methods/` 已存在，目前含 interview-synthesis、user-research-planning、maau-canvas、scripts；已列目录）。**proposed-unwired**。
- **容量计算**：`scripts/capacity.mjs`（P2/P3 纯函数）与 `scripts/check-sprint-plan.mjs`（不变式 1–8），在 `apps/skill-sandbox` 内执行。**proposed-unwired**。
- **类型复用**：S068 `handoff.S070`、S076 `workItemDrafts`、S067 `PrdReadiness`、S142 `WorkItemCandidate` 均直接引用各自文档 §6 的类型，不另定义第二份（四份相邻文档均已 Verdict: PASS，本文 §5/§6 已按其当前接口核对：S068 handoff 只含 `{ mustIds, shouldIds }`；S142 `WorkItemCandidate` 无 `unwiredFields`，其 `unwiredFields` 为输出且 `field ∈ {sprintId, sourceKind, originRefs}`）。
- **看板**：baseline 任务模型无 estimate / sprint 字段（已读 `apps/api/src/application/board/create-task.ts`）；S070 的计划作为 Artifact 草稿存放，写看板只经 S142。冲刺实体与估点字段：**proposed-unwired**。
- **日历**：CN 调休日历的数据来源与版本管理：**proposed-unwired**（与 S142 的 `workCalendarRef` 共用同一来源，避免两处声明）。

## 13. 决策
- **决策 1：输出是「预测」不是「合同」。** 采用 Scrum Guide 的 forecast 语义：committed 表示「在负载上限内有把握完成」，不是对人的绩效承诺。因此 `SprintPlan` 不含人名到条目的指派，review 模式也不评价个人。
- **决策 2：优先级只透传，不自评；负责人不指派。** 上游模板带 P0/P1/P2 列与 Owner 列。W030 已把 S068（排序）与 S142（负责人）列为独立 Skill，S070 再生成就是同一事实两处声明（AGENTS.md「同一事实不得声明在两处」）。S070 只记录 `s068Tier`。
- **决策 3：负载上限是硬门，缺省 0.8、上限 0.85、冷启动 0.6。** 上游 70–80% 与 lenny「75% weekly goals」两个独立来源相互印证；允许团队调到 0.85 是为了照顾速度数据稳定的团队，超过则一律拒绝——冲刺计划最常见的失败正是「这次我们加把劲」。
- **决策 4：承诺只接受团队估点。** Skill 可以给估点建议帮助讨论，但估点是团队对自己能力的判断，Skill 拍的数进 committed 会让速度历史失真并在下一轮放大误差。
- **决策 5：must 装不下时不自动裁剪。** 裁 must 是范围决定（回 S068）或时间决定（延长冲刺），两者都属于 W030 人工闸门；S070 只把冲突算清楚并标 `over-scope`。
- **决策 6：CN 缺调休日历即报错而不是假设。** 调休让「周一至周五」的推算系统性出错（节前补班日被漏算、节中工作日被多算），错误幅度可达 20% 以上人日，远大于其他假设的误差，因此不允许静默降级。

## 14. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **W030 内部顺序不一致**：S142 文档写 `S070 → S142 → S076`，S076 文档写 S076 产出草稿供 S070 与 S142 使用；本文按后者（S076 → S070 → S142）描述数据流。建议 W030 作者在阶段映射中裁定。
2. **W030 缺「估点会」人工闸门**：决策 4 要求 committed 估点来自团队，W030 应在 S076 与 S070 之间设一个 `ask` 级闸门收集团队估点。由 W030 作者决定。
3. **S142 `sourceRefs.kind` 缺 `s076-draft` / `s070-plan`**：当前枚举只有 `s068-backlog` 等，S070 交接时只能借用 `s068-backlog`。建议 S142 作者扩枚举。
4. **D015 gaps「Retrospective facilitation」**：S070 的结转原因（P5）是回顾的输入之一，但 S070 不做回顾；本文不认领该 gap。
5. **W053 Weekly PMO Review**：若 PMO 周报需要「本冲刺负载 vs 容量」，可考虑加 S070 的 review 模式；本文不假定。
6. **S142 输入缺 committed/stretch 区分**：S142 `WorkItemCandidate` 没有可标记 stretch 的输入字段（`unwiredFields` 是 S142 输出，`field` 只允许 sprintId/sourceKind/originRefs）。建议 S142 作者考虑在输入增加 `commitment: "committed" | "stretch"` 或等价标记。接线前的降级行为：S070 只交接 committed，stretch 只留在 `SprintPlan.stretch` 供人工闸门查看，不进看板。

## 15. 未决问题
- `knowledge.read`、`team.roster.read`、`sprint.history.read`、`sandbox.exec` 是否在 ADR-120 目录登记（UNVERIFIED）。
- 冲刺实体与估点字段落在 board 模型还是独立 project-planning 模型，需要 architecture 决策。
- `onCallDrag` 缺省 0.5 缺乏数据支撑，需在试点团队上校准。
- 若 §14 提议 6 被 S142 采纳，stretch 交接方式与不变式 9 需同步修改。
