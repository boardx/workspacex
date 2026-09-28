# W029 — Problem-to-PRD（从问题到 PRD）

> 类型：Reference Workflow · 域：Product · 作者化任务：AUTHOR-W029 · 状态：待独立评审
> **代码基线**：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文凡涉及现有 WorkspaceX 代码的陈述，均用 `git cat-file -e` / `git show <基线>:<path>` 核对过；没有核对过行为的标 **UNVERIFIED**；基线上不存在、或存在但尚未接线的能力标 **proposed-unwired**。
> **ADR 文本来源说明**：ADR-116～121 由提交 `fca04a62` 引入，该提交**不是**基线的祖先（`git merge-base --is-ancestor` 为假），基线 `docs/adr/` 止于 ADR-115。本文引用的 ADR 条款均读自工作树 HEAD `21a4331d`，属于「已定决策、尚未实现」，据此设计的运行时能力一律按 proposed-unwired 处理。
> 对齐的已 PASS 契约（只引用，不修改）：`skills/S064-problem-framing.md`、`skills/S065-opportunity-mapping.md`、`skills/S067-prd-spec-writing.md`、`skills/S068-prioritization.md`、`skills/S162-kpi-design.md`（五份的 `reviews/<ID>.review.md` 首行均为 `Verdict: PASS`）。结构参照已 PASS 的 `workflows/W001-research-to-brief.md`，正文不沿用。

## 1. 这个 Workflow 解决什么（边界）
W029 把**一个模糊的产品输入**（功能请求、抱怨、指标信号、一份已有综述）变成**一版经人签字的 PRD 版本**。这版 PRD 满足三条：
- 问题节逐字来自一份被人接受的 `ProblemFrame`；
- 方向来自一个被人接受的目标机会和一个被人选中的解法；
- 每条需求有稳定 `REQ-n` 与可判真假的验收条件，成功指标挂到 S162 的 KPI 节点上，而不是写死的数字。

W029 的终点是「PRD 某个版本 `approved` 并落盘」。它**不做**的事：
| 不做 | 归谁 |
|---|---|
| 原始访谈/反馈的洞察提炼（本行无 S063） | 上游 W027 / W028 的产物，只以 `synthesisRefs` 引用进来（决策 1） |
| 为机会发散解法（本行无 S066） | 调用方或上游提供解法；W029 只挂载、比较、选择（决策 2） |
| 需求级 MoSCoW 切分、sprint、建卡 | W030 PRD-to-Sprint（S068 `scope-cut`、S070、S142） |
| 对外发送 PRD、写入外部工单系统 | 不在 W029 内；W029 无 high-impact 阶段（决策 6） |

## 2. 组合图（精确 ID，来自两张矩阵，未推导、未修改）

### 2.1 参与 Skill（`WORKFLOW-SKILL-MATRIX.md` 第 35 行：`| W029 | Problem-to-PRD | Product | S064, S065, S067, S068, S162 |`）
| Skill | 名称 | 在 W029 中的调用方式 | 引用的对方契约 |
|---|---|---|---|
| S064 | Problem Framing | 输入 `rawInput`（+ `synthesisRefs`、`metricContext`、`constraints`）；`needs-choice` 时带 `previousFrameId + chosenProblemIndex` 重入；W029 阶段契约要求最终 `draft`（否则 `FRAME_INCOMPLETE`） | S064 §4 A1/D2、§5、§6 不变式 1–7、决策 2/5 |
| S065 | Opportunity Mapping | `mode: "build"`，`frameRef` 指向**已被 G1 接受**的 frame 版本；证据只经 `synthesisRefs` | S065 §5 I1–I4、§6 不变式 6/7/9、决策 5 |
| S068 | Prioritization | `mode: "solution-select"`，候选 = S065 `handoff.S068.solutionIds`，Effort 来源只能是 `estimate-by` | S068 §4.0、B1/B2、D1、决策 6、§14 提议 1 |
| S067 | PRD / Spec Writing | 先 `mode: "draft"`；KPI 绑定后 `mode: "revise"`（只带 `kpiRefs`，**永不带 `priorityRef`**，决策 4） | S067 §4 A1–A3、D2、§5、§6 不变式 1–8、决策 1–5 |
| S162 | KPI Design | `mode: "design-new"`，`scope: "initiative"`，`objective` 取 S065 `handoff.S162.outcome` | S162 §2.1 W029 行、§6 不变式、E4 |

Skill 版本由 `WorkflowDefinition(W029, v1).stages[*].skills[*] = {stableId, versionRange}` 在实例启动时解析并冻结（ADR-118 第 5 条）。按 ADR-118 第 9 条，发起 Agent **不需要**挂载上述 Skill，只需其 Workflow 白名单允许 W029 v1（ADR-116 第 3 条）。`workflowAllowlist` 在基线 `apps/`、`packages/` 中 `git grep` 无命中：**proposed-unwired**。

### 2.2 消费者（`DIGITALHUMAN-COMPOSITION-MATRIX.md` 中 Workflows 列含 W029 的行，共 4 个）
| DigitalHuman | 矩阵行 | 该行 Workflows | 在 W029 中的差异（只经 trigger 表达） |
|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | 缺省 `prdOwnerUserId = initiatorUserId`；G1–G4 批准人都可以是发起人本人 |
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | 缺省要求 trigger 带 `journeySteps`（透传 S065），因为该行 gaps 含「Persona/Journey facilitation」，W029 不补这项能力 |
| D039 Solution Architect | 第 45 行 | W029, W052, W003, W054 | 缺省 `prdOwnerUserId` **必填且 ≠ 发起人**：架构师发起的 PRD 由产品 owner 签 G4，避免技术方案自己签自己的需求 |
| D049 Business Analyst | 第 55 行 | W052, W029, W009, W055 | 同 D039，`prdOwnerUserId` 必填且 ≠ 发起人；该行 gaps 含「Acceptance criteria design」，W029 由 S067 §4 C 段承担验收条件，不认领这个 gap（§13 提议 5） |

各行 Skill 列只表示聊天直接调用（ADR-118 第 9 条），与能否运行 W029 无关，本文不提任何挂载边。

### 2.3 相邻 Workflow（划界）
- **W027 Discovery-to-Opportunity**：其终点也是被接受的目标机会，但证据恒为 provisional（W027 文档决策 2）。W029 可以引用 W027 的 frame / synthesis 作为 trigger 输入，但**不复用** W027 的 G6 目标接受回执——W029 自己重新跑 S065 并过 G2（决策 3）。
- **W030 PRD-to-Sprint**：消费 W029 的 `approved` PRD 版本（`prdRef: {documentId, versionId}`）。W029 **不自动启动** W030，只在终态产物里给出可一键发起的 `nextWorkflowSuggestion`（决策 6）。

## 3. 实体特有决策

**决策 1 — 本行没有 S063：证据只能以 `synthesisRefs` 从 trigger 进入，W029 不做研究；无证据时整条链路降级为「假设级 PRD」，而不是拒跑。**
S064 §14 提议 1 与 S067 §14 提议 1 都指出「W029 缺 S063 证据入口」，要求本文在「加边」和「写成触发前置条件」之间二选一。本文选**触发前置条件（可选输入）**，不提议加 S063 边：
- (a) W029 的职责是「问题 → 规格」，提炼洞察是 W027/W028 的职责，把 S063 塞进 W029 会让 W029 与 W028 重叠。
- (b) `trigger.synthesisRefs`（0–5）原样透传给 S064、S065，S067 的 `evidenceRefs` 取同一组；三者读到的都是服务端版本（S064 §8、S065 I3、S067 §8），W029 不内联任何 Finding 正文。
- (c) `synthesisRefs` 为空时：S064 的 `struggle` 全为 `assumption`；S065 在 `EVIDENCE_EMPTY` 时 W029 要求 trigger 提供 `seedOpportunities`，否则终态 `needs_evidence`；有种子时 S065 因不变式 6 必然给不出 `proposed`，此时 G2 允许**人工指定**目标机会，但 PRD 头部 `evidenceLevel = "assumption-only"`，并在 G4 表单上显式展示（E3）。
- (d) 引用的 synthesis 若来自 W027（`anyProvisional = true`），`evidenceLevel = "exploratory"`；只有全部 synthesis 为 final 时才是 `"reviewed"`。这个字段是 W029 自己的投影，只看 S065 输出的 `evidenceBasis.anyProvisional` 与 synthesis 个数，不重新评估证据强度。

**决策 2 — 本行没有 S066：解法只来自 S065 已挂载的解法；目标机会下无解法时停在人工补充，不让 S067 自己发明方向。**
S065 §14 提议 1 请 W029 评估是否需要 S066。本文不提议加边：W029 的输入通常已带有解法意图（功能请求被 S064 A1 剥离后，原请求就是一个候选解法）。落地规则：
- S064 输出 `strippedSolution.original` 非空时，W029 需要把这条原请求作为候选解法交给 S065。S065 输入契约没有专门的解法输入字段，W029 的做法是把原请求追加进 `seedOpportunities`：S065 的 B1 解法检测会把它识别为解法，并以 `origin = "reclassified-from-opportunity"` 挂到对应机会下，不会误当成机会。该行为依赖 S065 §4 B1 的重分类规则，在 S065 实现前 **UNVERIFIED**，以 E4 覆盖；若不成立，改为向 S065 提议 `seedSolutions` 字段（§15）。
- G2 之后若目标机会 `solutionCoverage = "none"`，进入 `awaiting_solutions`（ask 门）：人最多补 5 条解法文本，平台以 S065 `revise` 重跑挂载；仍为 none → 终态 `needs_solution_ideation`（建议另行发起含 S066 的流程，本文不指定具体 Workflow）。
- `solutionCoverage = "single"` 时跳过 S068（一个候选无从比较，S068 输入要求 2–150 个候选），G3 直接确认这唯一解法。

**决策 3 — 三个「接受」都由 W029 的人工门回执写入，且每个门写的是不同对象：G1 写 frame `accepted`，G2 写机会 `accepted`，G3 写解法 `selected`。任何 Skill 输出都不能越级。**
S064 决策 5、S065 决策 5、S068 D1 都把「接受/选定」留给 Workflow 门。W029 对应地：
- G1 只接受 `status = draft` 的 frame；`needs-choice` 时 G1 表单变成「选一个候选问题」，选择结果以 `chosenProblemIndex` 重入 S064（S064 E1→E2），重入最多 2 次；`too-broad` / `solution-in-disguise` 只能「补充输入后重跑」或「放弃」。
- G2 只能从 S065 `decision.proposedTarget` 或 frontier 内节点中选（`insufficient-evidence` / `needs-choice` 时从 `comparisons[].frontier` 选；决策 1(c) 的无证据情形例外，可选任一非 retired 顶层机会，且 `evidenceLevel` 强制为 `assumption-only`）。
- G3 只能从 S068 `cut.selected` 或 `bands[0].members` 中选；人选了非 `selected` 的候选时必须填理由（写入回执 `overrideReason`）。
- 回执对象在 frame / map / proposal 之外单独存储，Skill 产物本身不被改写（Skill 输出 schema 里没有 accepted/selected 以外的写入口）。

**决策 4 — W029 只用 S068 的 `solution-select`；PRD 需求不带优先级，`priorityRef` 永不传给 S067。**
S067 的 `priorityRef` 用于需求级优先级回填，其 `PRIORITY_MISMATCH` 规则要求 S068 结果与本版 `requirementId` 集合对齐。W029 中 S068 的候选是**解法**（`kind = "solution"`），与 `REQ-n` 不是同一粒度（S068 A1 禁止混排）。把它传给 S067 必然 mismatch。需求级 MoSCoW 属于 W030 的 `scope-cut`。因此 W029 产出的 PRD 中 `requirements[].priority` 恒不存在（schema 不变式 V4）。

**决策 5 — Effort 只能由具名估算人给；S065 → S068 之间插一个「估算收集」人工阶段，而不是让模型估。**
回应 S068 §14 提议 1（S068 决策 6：模型不估工作量；S065 不提供 Effort）。阶段 6 `estimate` 向 `trigger.estimators[]`（缺省为 `prdOwnerUserId`）发出估算表单，每个候选解法收一个 `{value, unit: "person-day" | "person-week", principalId}`；平台把它写成 S068 的 `{ kind: "estimate-by", principalId }`。服务端核实 `principalId` 是本组织成员且就是提交表单的人（S068 §8）。
- 超时（缺省 5 个工作日）未估的候选进入 S068 的 `unestimated`，不参与排名；若估完的候选 < 2，跳过 S068，G3 在已估候选中人工选择（E6）。
- Reach 不收集：W029 不传 `framework`，S068 B1 在无可溯源 Reach 时直接选 ICE；因为未指定 RICE，S068 §6 的 `frameworkDowngrade` 不会出现，W029 不展示它。ICE 的三个因子由同一估算表单收集：估算人对每个候选另填 `impact`、`confidence`、`ease`（各 1–10），平台同样写成 `source = { kind: "estimate-by", principalId }`（S068 B2）；某因子未填时按 `assumed` 处理，由 S068 B2 按 ICE 最低 Confidence 档计。

**决策 6 — W029 没有 high-impact 阶段；唯一的写效果是 PRD 版本落盘，且落盘前重查写权限。**
PRD 在这里是内部工作文档，对外沟通由 stakeholder 类流程负责。W029 的效果点只有：
- E-1：G1～G3 回执写入（平台内部写，written 为业务行）；
- E-2：PRD `approved` 版本落盘为 artifact 新版本（`artifact.write`）；
- E-3（可选）：G4 通过后在 PRD 所在项目发一条站内通知给 `watchers[]`（`notify.inapp`，write 类，不是对外发送）。
不自动启动 W030、不建工作项、不发邮件。这让 W029 的撤销成本始终是「删一个 artifact 版本」级别。

**决策 7 — KPI 绑定是一个人工 `ask` 步骤，S067 的 revise 只允许改 `goals`；revise 前后的 diff 由平台机械核对，超出范围即作废 revise。**
S067 `kpiRefs` 需要 `{kpiId, goalId}` 配对，而 goalId 属于 PRD、kpiId 属于 S162 树，二者的对应是产品判断，模型配对会制造「看起来有指标」的假象。阶段 9 `kpi_bind` 把 S067 `goals[]` 与 S162 中 `role ∈ {target, input}` 的节点并列展示，由人为每个 goal 选 ≤1 个 kpiId 或留空（留空的 goal 保持 `metricPending: true`）。随后 S067 `revise` 的 `changeRequest` 由平台按模板生成（只含绑定清单），并做 **revise diff 核对**：新版与草稿版相比，除 `goals[].kpiRef`、`goals[].metricPending`、`baseVersionId`，以及 `requirements[].changeKind`（S067 §6 规定 revise 时必填；此处每条需求只允许取「未改动」语义的值，出现其他取值即视为越界）外任何字段变化 → 丢弃该 revise 输出，重试 1 次，仍越界则保留草稿版进入 G4 并在表单标注「KPI 未能自动回填」。

**决策 8 — 每个效果点、每次跨门继续前重查权限；不沿用门之前的读取结果。**
权限是时点事实。W029 的人工门可能等很久（G1/G2/G3 各 7 天、估算 5 个工作日），期间引用的 synthesis、frame、目标项目的 ACL 都可能变化。重查点 **P1–P6**（全部落事件）：
- **P1 每个人工门批准后、下一阶段开始前**：以发起人身份重读本实例引用的全部 `synthesisRefs` 与上一阶段产物（frame / map / proposal 的版本）；任一 `*_NOT_FOUND`（S064/S065/S067 对「不存在」与「不可见」同码）→ 被撤引用从证据集删除，受影响阶段起全部标 stale 重跑（决策 1 规则重新计算 `evidenceLevel`），并**重新走**该阶段后的门。
- **P2 估算表单提交时**：核实提交人 = 表单收件人且仍是组织成员；否则该估算作废。
- **P3 G4 批准后、E-2 落盘前**：核实发起人（`agent_request` 时为背后的人）对 `trigger.targetProjectId` 仍有写权限，并对 PRD 中全部 `rationale.findingIds` 所属 synthesis 重读一次；写权限失败 → 终态 `blocked_no_write_access`，不换其他项目；synthesis 失效 → 回到阶段 8（S067 revise 删去对应 rationale）并重新走 G4。
- **P4 E-2 落盘时**：带 `expectedHeadVersion` 写入（基线 `apps/api/src/application/artifact/upload-new-version.ts` 已读：`UploadNewVersionInput.expectedHeadVersion`、内容哈希幂等、并发冲突返回 `VERSION_CHANGED`）。`VERSION_CHANGED` 表示有人在 G4 之后改了同一文档 → 不覆盖，回 G4 让批准人看差异。
- **P5 E-3 通知前**：逐个 watcher 重查其对 `targetProjectId` 的读权限，无权者不通知（不泄露 PRD 存在性）。
- **P6 崩溃恢复**：先对全部引用批量重读（同 P1），再从最早 stale 阶段继续。
P1/P3 的「以发起人身份重读引用」需要一个按主体重读版本化引用的端口，基线未见统一实现：**proposed-unwired**。W029 不把任何读权限结果缓存超过一次门等待。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts（ADR-118 规划；**proposed-unwired**，基线不存在）中 W029 的 trigger 输入
const W029Trigger = z.object({
  kind: z.enum(["manual", "agent_request", "handoff"]),       // 不支持 schedule / webhook：PRD 不是周期产物，也不应由外部事件无人发起
  requestId: z.string().uuid(),                               // 实例幂等键的一部分
  orgId: OrgId,
  initiatorUserId: UserId,                                    // 权限主体；agent_request 时仍是背后的人
  initiatorAgentVersionId: z.string().nullable(),             // 须在该 Agent 的 Workflow 白名单内（ADR-116 第 3 条；proposed-unwired）
  rawInput: z.string().min(1).max(2000),                      // 透传 S064 rawInput
  metricContext: z.object({ name: z.string(), direction: z.enum(["down", "up", "flat"]), window: z.string(), source: z.string().optional() }).optional(),
  synthesisRefs: z.array(z.object({ skill: z.literal("S063"), synthesisId: z.string() })).max(5).default([]),   // 决策 1
  existingFrameRef: z.object({ frameId: z.string(), version: z.number().int() }).optional(),  // handoff：复用上游 frame，仍须过 G1
  seedOpportunities: z.array(z.string().max(120)).max(15).default([]),
  journeySteps: z.array(z.string()).min(3).max(9).optional(), // D011 发起时必填（§2.2）
  constraints: z.array(z.object({ text: z.string(), kind: z.enum(["hard", "soft"]) })).max(20).default([]),
  targetPlatforms: z.array(z.enum(["web-desktop", "web-mobile", "ios", "android", "mini-program"])).default([]),
  targetProjectId: z.string(),                                // PRD 落盘处；启动时即核写权限（快速失败），P3 再核一次
  existingPrdRef: z.object({ documentId: z.string(), versionId: z.string() }).optional(), // 给已有 PRD 出新版本而非新文档
  prdOwnerUserId: UserId.optional(),                          // G4 批准人；D039/D049 发起时必填且 ≠ initiatorUserId
  estimators: z.array(UserId).max(10).default([]),            // 决策 5；空 = [prdOwnerUserId ?? initiatorUserId]
  watchers: z.array(UserId).max(30).default([]),              // E-3，可空
  locale: z.enum(["zh-CN", "en-US"]),
  market: z.enum(["CN", "US", "global"]).default("global"),
});
```
Trigger 不变式（进门校验，失败即 `TRIGGER_INVALID`，不建实例）：
- **T1** `kind = "handoff"` ⇒ `existingFrameRef` 或 `synthesisRefs.length ≥ 1` 至少一个。
- **T2** `initiatorAgentVersionId` 对应 D039/D049 时，`prdOwnerUserId` 必填且 `≠ initiatorUserId`（§2.2）。
- **T3** `existingPrdRef` 出现时，该文档必须位于 `targetProjectId`，且服务端读到的 head 版本就是 `versionId`（否则 `PRD_HEAD_MOVED`）。
- **T4** trigger 中不接受任何内联的 Finding 正文、`ceiling`、`priority`、KPI 目标数字（与 S064/S067 的授权边界一致）。

## 5. 阶段表
状态机：
`requested → framing → [G1 frame] → mapping → [G2 target] → (awaiting_solutions) → estimating → prioritizing → [G3 solution] → drafting → kpi_designing → [kpi_bind ask] → revising → [G4 PRD approve] → P3/P4 → persisting → prd_approved → (E-3 notify) → closed`

| # | stage | Skill IDs | 工具能力分类（ADR-120 提案名，均 UNVERIFIED 是否登记） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 0 | intake | —（平台：trigger 校验 + 目标项目写权限快速核查） | `project.read` | requested → framing ｜ → failed(`TRIGGER_INVALID`) | read | none |
| 1 | frame | S064 | 条件：`knowledge.read`（有 synthesisRefs / existingFrameRef 时，S064 §7） | framing → framed(draft ｜ needs-choice ｜ too-broad ｜ solution-in-disguise) | read | none |
| 2 | frame_gate | —（回执写 frame `accepted`） | — | framed → frame_accepted ｜ reenter → framing（≤2 次）｜ revise_input → framing ｜ abandon → abandoned | write（回执） | **G1 required**。之后 **P1** |
| 3 | map | S065（`build`；无证据有种子时仍 build） | 条件：`knowledge.read` | frame_accepted → mapping → mapped ｜ → needs_evidence（`EVIDENCE_EMPTY` 且无种子） | read | none |
| 4 | target_gate | —（回执写机会 `accepted`） | — | mapped → target_accepted ｜ → abandoned ｜ → framing（人判定框定错误，frame 版本 +1，重新 G1） | write（回执） | **G2 required**。之后 **P1** |
| 5 | solutions_fill | S065（`revise`，仅在 `solutionCoverage = none` 时） | 条件：`knowledge.read` | target_accepted → awaiting_solutions → mapped_with_solutions ｜ → needs_solution_ideation | read | ask（决策 2） |
| 6 | estimate | —（平台：估算表单） | `notify.inapp`（发表单） | → estimating → estimated（全部回收或超时） | write（通知） | ask（逐估算人，决策 5）。每份提交 **P2** |
| 7 | prioritize | S068（`solution-select`；已估候选 < 2 或 `single` 时跳过） | 条件：`knowledge.read` | estimated → prioritizing → prioritized ｜ skipped | read | none |
| 8 | solution_gate | —（回执写解法 `selected`） | — | prioritized → solution_selected ｜ → target_gate（人认为应换目标）｜ → abandoned | write（回执） | **G3 required**。之后 **P1** |
| 9 | draft | S067（`draft`） | `knowledge.read`（S067 §7 required） | solution_selected → drafting → drafted ｜ → failed(`DIRECTION_OUT_OF_FRAME` 见 F4) | read | none |
| 10 | kpi | S162（`design-new`，`scope: "initiative"`） | 无必需（S162 只读；`definitionRef` 不传） | drafted → kpi_designing → kpi_designed ｜ `ObjectiveUnmeasurable` → kpi_bind 以「全部留空」进入 | none | none |
| 11 | kpi_bind | —（平台：goal↔kpi 绑定表单） | — | kpi_designed → awaiting_kpi_bind → bound | none | ask（决策 7；超时 3 天视为全部留空） |
| 12 | revise | S067（`revise`，只带 `kpiRefs`） | `knowledge.read` | bound → revising → revised ｜ diff 越界 → revised(=草稿版) | read | none |
| 13 | prd_gate | —（回执写 PRD `approved`） | — | revised → awaiting_approval → approved ｜ request_changes → revising（S067 revise，人写 changeRequest，D2 守恒生效）｜ reject → rejected | write（回执） | **G4 required**，批准人 = `prdOwnerUserId ?? initiatorUserId`。之后 **P3** |
| 14 | persist | —（E-2） | `artifact.write`（平台内部写） | approved → persisting → prd_approved ｜ `VERSION_CHANGED` → prd_gate ｜ 写权限失败 → blocked_no_write_access | write | none（G4 覆盖；P3/P4 在此前/此时执行） |
| 15 | notify | —（E-3，可选） | `notify.inapp` | prd_approved → closed | write | none；逐 watcher **P5** |

阶段说明（只写 W029 特有的接线）：
- **阶段 1**：`existingFrameRef` 存在时不调用 S064，由平台按 `existingFrameRef.{frameId, version}` 直接读取该 frame 版本进入 G1（S064 §5 没有只读模式，`previousFrameId` 只用于重入/修订并产出 version+1）；该 frame 若 `status ≠ draft`，才调用 S064 并传 `previousFrameId = existingFrameRef.frameId`，按 S064 重入规则处理。S064 在 W029 中被要求最终 `draft`，两轮 C1 后仍不满足时 S064 返回 `FRAME_INCOMPLETE`，W029 把它当作 `too-broad` 呈现给 G1。
- **阶段 3 输入映射**：`frameRef = {skill:"S064", frameId, version}`（G1 接受的那一版，**必须带 version**，不用「省略取最新」，否则 G1 之后 frame 被别人修订会让 S065 读到未接受的版本）；`synthesisRefs` 原样；`journeySteps`、`constraints`、`seedOpportunities`（含决策 2 的剥离原请求）原样；`locale`、`market` 透传。
- **阶段 7 输入映射**：`candidates[]` = S065 `handoff.S068.solutionIds` 中已估算的解法（handoff 为空或不对应 G2 目标时——即 G2 从 `comparisons[].frontier` 选目标或决策 1(c) 情形——改取 S065 opportunity map 中挂在 G2 目标机会下的全部解法节点），`kind = "solution"`，`sourceRef = {skill:"S065", artifactId: mapId, itemId: solutionId}`，`factors.effort.source = {kind:"estimate-by", principalId}`；不传 `framework`（让 S068 B1 规则决定）；`appetite` 不传（solution-select 不装箱，除非 trigger 的 hard constraint 给出时长上限，此时换算为 `appetite` 传入）。
- **阶段 9 输入映射**：`frameRef` = G1 版本；`direction`：S067 契约只有 `{source:"S065", opportunityId}` 或 `{source:"caller", text}`，**没有**解法引用字段。W029 传 `{source:"S065", opportunityId: G2 目标}`，并把 G3 选中解法以 `constraints: [{kind:"hard", text:"采用解法：<solution.text>（solutionId=<id>）"}]` 注入；解法 id 与 PRD `documentId` 的对应关系记在 W029 的阶段输出里。这是契约缺口下的适配，见 §13 提议 1。`evidenceRefs` = `trigger.synthesisRefs`（P1 过滤后）；`kpiRefs` 不传；`targetPlatforms`、`locale`、`market` 透传。
- **阶段 10 输入映射**：`objective = S065 handoff.S162.outcome`，仅当 G2 接受的正是 `decision.proposedTarget` 时可用（S065 §6 不变式 9 只保证 `decision.status = proposed` 时 handoff 非空）；以下情形 handoff 为空或不对应 G2 目标——决策 1(c) 人工指定目标、`needs-choice` / `insufficient-evidence` 时 G2 从 `comparisons[].frontier` 选目标——W029 用 frame 的 `outcomeSignals` 拼接 G2 目标机会文本作为 objective；`reviewCadence = "weekly"`；`constraints.maxKpis = 8`（单一 initiative 的 PRD 不需要 12 个指标）；`owners` 取 `watchers ∪ {prdOwnerUserId}` 的团队标签（不含个人数据）；`jurisdiction` = `market` 映射（global → other）。S162 E4 保证无基线时 `target.value = null`、`basis = unknown`，W029 不补数字。
- **阶段 13**：G4 表单必须同时展示：`evidenceLevel`、S068 的 `framework.used` 与 `unestimated`（若有）、S162 `measurementPlan` 中的 `establish-baseline` 条目、未绑定 KPI 的 goals、S067 `openQuestions` 中 `blocking = true` 的条目。blocking 问题存在时 G4 仍可批准（PRD 可以带着问题被接受），但 PRD 头部 `readinessHint = "has-blocking-questions"`，W030 的 readiness 会把它当 blocker（S067 D4）。

## 6. 产出 schema
W029 不重新定义 frame / map / proposal / PRD / KPI 树的字段，只定义把它们串起来的**实例产物**与**门回执**。
```ts
const W029GateReceipt = z.object({
  receiptId: z.string(), instanceId: z.string(),
  gate: z.enum(["G1", "G2", "G3", "G4", "kpi_bind", "estimate", "solutions_fill"]),
  decidedBy: UserId, decidedAt: z.string().datetime(),
  subject: z.discriminatedUnion("gate", [
    z.object({ gate: z.literal("G1"), frameId: z.string(), frameVersion: z.number().int(), outcome: z.enum(["accepted", "reenter", "revise_input", "abandon"]), chosenProblemIndex: z.number().int().optional() }),
    z.object({ gate: z.literal("G2"), mapId: z.string(), mapVersion: z.number().int(), oppId: z.string().nullable(), outcome: z.enum(["accepted", "reframe", "abandon"]), pickedOutsideProposal: z.boolean() }),
    z.object({ gate: z.literal("G3"), proposalId: z.string().nullable(), solutionId: z.string().nullable(), outcome: z.enum(["selected", "change_target", "abandon"]), overrideReason: z.string().max(500).optional() }),
    z.object({ gate: z.literal("G4"), documentId: z.string(), versionId: z.string(), contentHash: z.string(), outcome: z.enum(["approved", "request_changes", "reject"]), changeRequest: z.string().max(2000).optional() }),
    z.object({ gate: z.literal("kpi_bind"), bindings: z.array(z.object({ goalId: z.string(), kpiId: z.string().nullable() })) }),
    z.object({ gate: z.literal("estimate"), solutionId: z.string(), value: z.number().positive(), unit: z.enum(["person-day", "person-week"]), principalId: UserId }),
    z.object({ gate: z.literal("solutions_fill"), texts: z.array(z.string().max(300)).max(5) }),
  ]),
  permissionCheck: z.object({ point: z.enum(["P1", "P2", "P3"]), passed: z.boolean(), revokedRefs: z.array(z.string()) }),
});

const W029Outcome = z.object({
  instanceId: z.string(), definitionVersion: z.string(), skillVersions: z.record(z.string(), z.string()), // S064..S162 冻结版本
  terminal: W029TerminalState,                       // §7
  evidenceLevel: z.enum(["reviewed", "exploratory", "assumption-only"]),   // 决策 1(c)(d)
  frame: z.object({ frameId: z.string(), version: z.number().int() }).nullable(),       // G1 接受的版本
  target: z.object({ mapId: z.string(), mapVersion: z.number().int(), oppId: z.string() }).nullable(),
  solution: z.object({ solutionId: z.string(), via: z.enum(["S068-selected", "S068-override", "single-candidate", "manual-unranked"]) }).nullable(),
  prioritization: z.object({ proposalId: z.string(), version: z.number().int(), frameworkUsed: z.enum(["RICE", "ICE"]), unestimated: z.array(z.string()) }).nullable(),
  kpi: z.object({ designRef: z.string(), boundGoals: z.number().int(), pendingGoals: z.number().int() }).nullable(),
  prd: z.object({
    documentId: z.string(), versionId: z.string(), artifactId: z.string(), artifactVersionNumber: z.number().int(),
    contentHash: z.string(), readinessHint: z.enum(["no-blocking-questions", "has-blocking-questions"]),
  }).nullable(),
  nextWorkflowSuggestion: z.object({ workflowId: z.literal("W030"), prdRef: z.object({ documentId: z.string(), versionId: z.string() }) }).nullable(),
  receipts: z.array(z.string()),                     // W029GateReceipt.receiptId，按时间序
  stopReason: z.object({ code: z.string(), detail: z.string().max(500) }).nullable(),
});
```
Schema 不变式（`evals/work-stack/W029/check-outcome.mjs` 机械核对，**proposed-unwired**）：
- **V1** `terminal = "prd_approved"` ⇔ `prd ≠ null` ∧ 存在 `gate = G4, outcome = approved` 的回执，且该回执 `contentHash` = `prd.contentHash`（批准的就是落盘的那一版）。
- **V2** `prd ≠ null` ⇒ `frame`、`target`、`solution` 均非空，且各自有对应 G1/G2/G3 回执；`solution.via = "S068-override"` ⇔ G3 回执有 `overrideReason`。
- **V3** `terminal ∉ {prd_approved}` ⇒ `prd = null` 且 `nextWorkflowSuggestion = null`（未批准的草稿版本保留为阶段输出，不作为产物）。
- **V4** 落盘 PRD 中每条 `requirements[].priority` 不存在（决策 4）；`goals[].kpiRef` 非空的 goal 数 = `kpi.boundGoals`。
- **V5** `evidenceLevel = "assumption-only"` ⇔ 引用的有效 synthesis 数为 0（P1 过滤后）；此时 PRD 所有 `rationale.kind ∈ {"frame-struggle", "assumption"}`。
- **V6** `prioritization = null` ⇔ `solution.via ∈ {"single-candidate", "manual-unranked"}`。
- **V7** 每个 `permissionCheck.passed = false` 的回执之后，实例状态必须出现回退或终止事件（不得静默继续）。

## 7. 终态
| 终态 | 条件 | 效果（已发生的写） | 产物 |
|---|---|---|---|
| `prd_approved` | G4 approved、P3 通过、E-2 成功（E-3 可选） | 回执 + artifact 新版本（+ 站内通知） | `W029Outcome.prd` + `nextWorkflowSuggestion` |
| `rejected` | G4 reject | 仅回执 | 各阶段产物保留 30 天；无 artifact 版本 |
| `abandoned` | G1/G2/G3 任一选 abandon，或门超时 7 天 | 仅回执 | 同上 |
| `needs_evidence` | S065 `EVIDENCE_EMPTY` 且 trigger 无 `seedOpportunities`（决策 1(c)） | 仅 G1 回执 | 建议先跑 W027 或 W028；附已接受的 frame |
| `needs_solution_ideation` | 目标机会补充解法后仍 `solutionCoverage = none`（决策 2） | G1/G2 回执 | 附 frame + 目标机会 |
| `blocked_no_write_access` | P3 发现对 `targetProjectId` 无写权限 | 回执（含 P3 失败） | 已批准内容保留为阶段输出，**不**写入其他项目 |
| `cancelled` | 发起人取消（任一非终态） | 已写回执不回滚 | 已产生的阶段输出保留 |
| `failed` | 不可重试错误：`TRIGGER_INVALID`、Skill 版本被撤且无兼容版本、组织撤销 W029 授权、S067 `DIRECTION_OUT_OF_FRAME` 两次（F4） | 视失败点 | 失败原因码 |

**终态与效果的不变式**：只有 `prd_approved` 允许存在 E-2（artifact 写）与 E-3（通知）的成功 receipt；其余终态若出现 E-2/E-3 成功 receipt 即为缺陷（E14 覆盖）。回执写入（E-1）在任何终态都可能存在，且永不删除。

## 8. Receipts、幂等与崩溃恢复
沿用 ADR-118 第 3 条的统一 receipt 形状（基线 `apps/api/src/application/research/guided-workflow-receipt-ports.ts` 已读：`find / begin / finalize`，`begin` 带 `payloadFingerprint`，`finalize` 带 `checkpointId`、`graphVersion`、`stableResponse`；泛化到通用 workflow 为 **proposed-unwired**）。W029 特有：
- **实例幂等键** `(orgId, initiatorUserId, requestId)`；同键不同 `payloadFingerprint` → `IDEMPOTENCY_KEY_REUSED`。
- **Skill 调用幂等**：每次 Skill 调用一个 receipt，键 = `hash(instanceId, stage, attempt, inputFingerprint)`。S064 重入（`chosenProblemIndex`）是新的 attempt，不复用 G1 之前那次的 receipt。已 finalize 的 Skill 输出在恢复时直接复用，**不重跑**——S065 的 `oppId`、S067 的 `REQ-n` 在同一实例内必须稳定，重跑会产生新的 id 集合，使 G2/G3 回执引用的 id 失效。
- **门回执幂等**：键 = `hash(instanceId, gate, subjectVersion)`；同一门对同一版本的重复提交返回首个回执（防双击），对不同版本的提交视为新决定。
- **估算表单**：键 = `hash(instanceId, solutionId, principalId)`；同一人重复提交覆盖前值，最后一次在截止前的提交生效，写入回执历史。
- **E-2 落盘**：`upload-new-version` 以内容哈希幂等（基线已读：重复上传与 head 同哈希的内容不产生新版本），W029 以 `hash(instanceId, G4 回执 id)` 作为 receipt 键，崩溃后重试先 `find`：已 finalize 直接返回版本号；`begin` 未 finalize 时带同一 `expectedHeadVersion` 重试——若 head 已是本实例写入的内容（哈希相同）视为成功，若 head 是别人写的则 `VERSION_CHANGED` → 回 G4。
- **E-3 通知**：每 watcher 一个 receipt，键 = `hash(instanceId, prdVersionId, watcherId)`；站内通知失败最多重试 3 次，失败不影响 `prd_approved`。
- **业务行**：frame / map / proposal / PRD 各版本 / KPI 树 / 回执写入 ADR-118 第 4 条的业务行，checkpoint 只存指针；具体表名未定（**proposed-unwired**，不在此臆造）。
- **恢复顺序**：P6 重查 → 标 stale → 从最早 stale 阶段继续；处于人工门等待中的实例恢复后仍停在该门，不重发门通知（除非通知 receipt 未 finalize）。
- **重试预算**：Skill 结构化输出失败 ≤ 2 次（S162 `OutputInvariantViolation` 按其契约只重试 1 次）；S064 重入 ≤ 2 次；阶段 12 revise diff 越界重试 1 次；G4 `request_changes` 回环 ≤ 5 次，第 6 次强制 `rejected`，理由「多轮修改未收敛，建议重新框定」。
- 权限被拒后不得换同分类供应商重试（ADR-120 第 3 条）。

## 9. 失败模式（W029 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | frame 在 G1 后被修订，S065 读到未接受的版本 | 阶段 3 `frameRef.version` ≠ G1 回执 `frameVersion` | 始终传 G1 回执中的版本（§5 阶段 3），E7 |
| F2 | 把 S068 的解法排序当需求优先级塞进 PRD | 阶段 9/12 输入含 `priorityRef` 或 PRD 出现 `priority` | 决策 4；V4 拒绝 |
| F3 | 模型替估算人填 Effort | S068 输入的 effort `source.kind ≠ estimate-by`，或 `principalId` ≠ 表单提交人 | 决策 5；P2；S068 II5 同时拦截 |
| F4 | 选中的解法与 frame 的 `outOfScope` 冲突，S067 返回 `DIRECTION_OUT_OF_FRAME` | S067 错误码 | 第一次：回 G3 让人换解法或回 G2；第二次：`failed`，提示重新框定 |
| F5 | KPI 被模型配对到 goal，制造「有指标」假象 | kpi_bind 回执缺失却出现 `kpiRef` | 决策 7；diff 核对 |
| F6 | revise 借 KPI 回填偷改需求 | 阶段 12 diff 核对越界 | 丢弃 revise 输出；E9 |
| F7 | 无证据 PRD 被当作已验证需求流向 W030 | `evidenceLevel` 缺失或与 synthesis 数不符 | V5；G4 表单强制展示 |
| F8 | G4 批准后文档被他人修改，批准的与落盘的不是同一版 | `VERSION_CHANGED` 或 V1 哈希不等 | 回 G4；E12 |
| F9 | 门等待期间引用 synthesis 被撤权，PRD 仍引用其 Finding | P1/P3 读回 `*_NOT_FOUND` | 删引用、stale 重跑、重新过门；E10 |
| F10 | 架构师/BA 发起并自签 PRD | T2；G4 `decidedBy = initiatorUserId` 且发起 Agent 为 D039/D049 | 进门拒绝 / 门拒绝；E13 |

## 10. CN / US 差异（仅列实质性的）
- **合规提示的归属**：S067 `complianceNotes` 只挂在具体 `requirementIds` 上（S067 §9）。W029 在 G4 表单上对 `market = CN` 且 `targetPlatforms` 含 `mini-program` 的 PRD 额外展示「平台审核约束」的 complianceNote 计数；为 0 时提示「未识别到平台审核相关需求」，由人判断，不自动加需求。US 对面向公众的 web PRD 同样展示 WCAG/ADA 相关 note 计数。W029 不新增任何合规规则，只把 S067 已有的提示放到签字位置。
- **批准人结构**：CN B2B 团队中常见「老板要求上线」作为入口（S064 §9）；W029 不允许把该要求当作 G2/G3 的依据——G3 选择非 S068 `selected` 候选时必须填 `overrideReason`，且理由写「领导要求」时表单提示 S068 决策 5（口头指令不是 strategy-shift）。US 无此额外提示。
- **估算单位**：CN 团队常用「人天」，US 常用 person-week 或 story point；W029 估算表单只收 `person-day | person-week`，不收 story point（S068 §9「投入单位」不接受 story point），US 团队需自行换算，表单给出提示。
- **语言**：`locale` 贯穿五个 Skill；混合语言团队不在一个实例内切换 locale，要换语言需以 `existingPrdRef` 另起实例（S067 的模糊词表按 locale 分开，混用会漏检）。

## 11. WorkspaceX 落点（基线 `30c1c4332025151610502988b0379b95ff7298c7`）
- **运行时**：W029 落在 ADR-118 规划的 `apps/api/src/{domain,application,infrastructure}/workflow/`——基线无此目录（**proposed-unwired**）。`packages/contracts/src/workflow-definition.ts` 基线不存在（**proposed-unwired**）。
- **receipt 形状样板**：`apps/api/src/application/research/guided-workflow-receipt-ports.ts`（已读，见 §8）。
- **PRD 落盘**：`apps/api/src/application/artifact/upload-new-version.ts`（已读：`UploadNewVersionInput.expectedHeadVersion`、`computeContentHash` / `versionContentHash` 的内容哈希幂等、`VERSION_CHANGED`）。PRD 结构化 JSON 能否作为 artifact 版本内容、`documentId ↔ artifactId` 映射：**proposed-unwired**（与 S067 §12 同一未决点）。
- **Skill Pin 与白名单**：`apps/api/src/application/agent-skill-pins/set-agent-skill-pins.ts` 存在（已核）；W029 不依赖它（ADR-118 第 9 条）。`workflowAllowlist` 基线 `git grep` 无命中：**proposed-unwired**。
- **工具副作用值域**：`packages/contracts/src/agent-runtime.ts` 与 `apps/api/src/application/mcp/ports.ts` 存在（已核存在性）；W029 的 `artifact.write`、`notify.inapp` 是否经 MCP：**UNVERIFIED**，本文按平台内部写设计。
- **Skill 包**：`skills/standard-methods/` 目录存在（已核）；五个 Skill 包本身均 proposed-unwired（见各 Skill 文档 §12）。
- **评测**：`evals/work-stack/W029/`——基线不存在（**proposed-unwired**，ADR-119 第 1 条）。
- **proposed-unwired 汇总**：`workflow/` 目录、`workflow-definition.ts`、通用 receipt 表、业务行表、门回执存储、按主体重读引用的端口（P1/P3/P6）、`workflowAllowlist`、估算表单、kpi_bind 表单、revise diff 核对器、`check-outcome.mjs`、`evals/work-stack/W029/`。

## 12. 外部参考与溯源
| 来源 | 路径 | commit | 许可证（artifact 级） | 取用内容 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `product-management/skills/write-spec/SKILL.md` 的「Workflow」节（:19–75：Understand → Gather Context → Pull Context → Generate the PRD → Review and Iterate） | `da38ec1ee89d41e5380e652a97382695003396e7`（克隆 `scratchpad/upstream/knowledge-work-plugins` HEAD） | Apache-2.0（`product-management/LICENSE`） | **reference-only 控制流**。上游是单 Agent 对话式五步，PRD 各节在「Generate」一步内一起写出、「Review and Iterate」是非结构化的询问。W029 的差异：把问题、机会、解法、指标拆成独立 Skill 与独立人工门（决策 3），优先级与目标数字移出 PRD（决策 4、7），迭代改为带守恒规则的 revise（S067 D2）。不复制任何段落。 |
| anthropics/knowledge-work-plugins | `product-management/skills/roadmap-update/SKILL.md`（RICE/ICE 定义，经 S068 采用） | 同上 | Apache-2.0 | 不直接取用，仅经 S068 间接依赖；列出以便溯源链完整 |

各 Skill 自身的上游（S064/S067 的 write-spec 节选、S065 的 OST 来源、S068 的 roadmap-update、S162 的 metrics-review 与 lenny-skills north-star-metrics）以各 Skill 文档 §3 为准，W029 不重复声明。W029 不进入任何 `provenance[].copied`。

## 13. 评测（`evals/work-stack/W029/`（proposed-unwired），确定性 case 跑回环模型，夹具均为合成数据）
基线（ADR-119 G5）：同一输入交给挂载了 S067 但不运行 W029 的通用 Agent，一次对话直接写 PRD。

| # | 输入（fixture） | 通过判据（规则 grader） |
|---|---|---|
| E1 | `rawInput`「审批页加一键催办按钮」，`synthesisRefs=[syn-A]`（final，含 F2「部分发起人在审批卡住时反复私聊审批人」ceiling=likely），D003 发起 | S064 首轮 `needs-choice`；G1 选候选 0 重入后 `draft`；最终 PRD `problem.text` 逐字等于 G1 接受版本的 `problemSection`；PRD 正文 statement 不含「催办按钮」；`evidenceLevel=reviewed`；V1–V7 全过 |
| E2 | 同 E1，但 G2 之后人把 `synthesisRefs` 的 syn-A 设为发起人不可读，然后在 G3 批准 | P1 触发：syn-A 被删，S065 起 stale 重跑，重新走 G2；最终 `evidenceLevel=assumption-only` 或实例停在 G2；PRD 中无 F2 引用 |
| E3 | 无 synthesis，`seedOpportunities=["新成员不知道找谁要权限","文档目录层级太深"]` | S065 不产出 `proposed`；G2 允许人工指定目标；PRD 头部 `evidenceLevel=assumption-only`；所有 rationale ∈ {frame-struggle, assumption}（V5） |
| E4 | 输入「给团队空间加入职清单」，无 seed，有 synthesis | 剥离出的原请求以 seed 形式进入 S065，被重分类为 `origin=reclassified-from-opportunity` 的解法挂在目标机会下；G3 的候选中包含它（依赖 S065 B1，未实现前该 case 标 pending） |
| E5 | 目标机会下 3 个解法，`estimators=[U1]`，U1 只估了 2 个 | S068 收到 2 个候选、1 个 `unestimated`；所有 effort `source.kind=estimate-by, principalId=U1`；输出无模型生成的 Effort |
| E6 | 3 个解法，估算超时仅 1 个被估 | 跳过 S068；`solution.via=manual-unranked`；`prioritization=null`（V6） |
| E7 | G1 接受 frame v2 后，另一用户把该 frame 修订为 v3 | S065 的 `frameRef.version=2`；PRD `problem.frameRef` = `frameId@2` |
| E8 | 模拟模型在阶段 9 输出中带 `priority: "must"` 的需求 | V4 拒绝；阶段 9 重试；最终 PRD 无 `priority` 字段；S067 输入从未含 `priorityRef` |
| E9 | kpi_bind 绑定 G1→K2 后，模拟 S067 revise 同时把 REQ-3 文本改写 | diff 核对越界 → 丢弃，重试 1 次仍越界 → 以草稿版进入 G4，表单标「KPI 未能自动回填」；REQ-3 文本 = 草稿版 |
| E10 | G4 等待期间撤销 PRD 某 `rationale.findingIds` 所在 synthesis 的读权限，然后批准 | P3 触发：不落盘，回阶段 12 删 rationale，重新走 G4；最终落盘版本无该 findingId |
| E11 | G4 批准后、落盘前撤销发起人对 `targetProjectId` 的写权限 | 终态 `blocked_no_write_access`；无 artifact 新版本；没有写入其他项目 |
| E12 | G4 批准时 head=v4，落盘前另一用户上传 v5 | `VERSION_CHANGED` → 回 G4；V1：最终批准回执的 `contentHash` = 落盘版本哈希 |
| E13 | D039 发起，`prdOwnerUserId` 缺省 | `TRIGGER_INVALID`（T2），不建实例；补 `prdOwnerUserId=发起人` 同样被拒 |
| E14 | 在 `rejected`、`abandoned` 终态上检查 receipt | 无 E-2/E-3 成功 receipt；G 回执存在 |
| E15 | 同 requestId 同 payload 重放；再以同 requestId 改 rawInput 重放 | 前者返回同一实例、零新 receipt；后者 `IDEMPOTENCY_KEY_REUSED` |
| E16 | 阶段 9 完成后模拟崩溃，恢复 | 不重跑 S067；`REQ-n` 集合与崩溃前相同；G 回执引用的 id 均有效 |
| E17 | 选中解法「按员工定位自动签到」，frame.outOfScope 含「员工位置追踪」 | S067 `DIRECTION_OUT_OF_FRAME` → 回 G3；再次选同类解法 → `failed`（F4） |
| E18 | 新功能无任何历史数据，market=CN，zh-CN | S162 所有节点 `target.value=null`、`basis=unknown`；PRD goals 无数字；G4 表单列出 `establish-baseline` 条目 |
| E19 | market=CN，`targetPlatforms=["mini-program"]`，需求中无平台审核相关内容 | G4 表单显示平台审核 note 计数 0 与提示；PRD 未被自动加需求 |
| E20 | G4 `request_changes` 循环第 6 次 | 终态 `rejected`，理由为多轮未收敛 |

G5 对比判据：在 E1/E3/E8/E9/E10/E18 上，基线至少失败 3 条（典型：基线会自带 P0/P1 优先级、编目标百分比、把请求原文写成问题），而 W029 全过，才能标 verified。

## 14. Graph change proposals（只提议，不修改矩阵，不假定采纳）
1. **S067 输入缺「选中解法」字段**（改 S067 契约，不改矩阵）：S067 `direction` 只能引用 S065 机会或 caller 文本，W029 目前把 G3 选中的解法以 hard constraint 注入（§5 阶段 9）。建议 S067 增加 `solutionRef?: { skill: "S068" | "S065"; id: string }`，由服务端读取解法文本。由 S067 owner 决定。
2. **不加 S063 边**（回应 S064 §14 提议 1、S067 §14 提议 1）：本文选「触发前置条件」方案（决策 1）；若矩阵 owner 仍希望 W029 自带研究，应加 S063 并同时评估 S171（参考 W027 文档 §13 提议 1 的同类讨论）。
3. **不加 S066 边**（回应 S065 §14 提议 1）：决策 2 以 `needs_solution_ideation` 终态显式暴露缺口；若该终态在评测或试用中占比高（建议阈值 >20%），再提议加 S066。
4. **不加 S075**（回应 S067 §14 提议 3 所述 S075 文档的提议）：W029 的终点是签字的 PRD；S075 若加入，应作为 G4 之前的只读检查，并读 `prdRef` 版本。本文不附议。
5. **D049 gaps「Acceptance criteria design」**：S067 §4 C1–C3 已提供验收条件的结构与检查；该 gap 是否因此关闭由 D049 作者判断，本文不认领。
6. **S068 solution-select 的 `appetite`**：本文仅在 trigger 有时长 hard constraint 时传 appetite；若 S068 owner 认为 solution-select 不应装箱，请在 S068 中明确，W029 随之删除该映射。

## 15. 未决问题
- 能力分类名（`knowledge.read`、`artifact.write`、`notify.inapp`、`project.read`）是否在 ADR-120 目录登记：UNVERIFIED。
- ADR-116～121 不在基线内；若实现 PR 对 ADR-118 第 3/4/5/6/9 条有修订，本文 §2、§8 需同步复核。
- S065 以 seed 送入的解法文本能否被 B1 稳定重分类（决策 2、E4）需在 S065 实现后确认；否则需要 S065 增加显式的 `seedSolutions` 输入（届时作为 S065 契约提议提出）。
- 门超时（G 门 7 天、估算 5 个工作日、kpi_bind 3 天）是否上升为组织策略；本文取值只在本节与决策 5/§5/§7 使用，实现时应收敛为 `WorkflowDefinition` 的单一字段。
- PRD 以 artifact 版本落盘的形态（结构化 JSON 或渲染文档 + JSON 附件）需与 artifact 模块确认（S067 §15 同一问题）。
