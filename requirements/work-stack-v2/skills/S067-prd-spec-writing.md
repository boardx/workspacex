# S067 — PRD / Spec Writing（PRD / 需求规格撰写）

> Type: Work Skill · Domain: Product & Design · Strategy: A1（一个主源 adapt + 一个参考源）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文独立作者化（AUTHOR-S067）；v1 `S067` 文档只作话题提示，正文未沿用。
> 引用 WorkspaceX 现有代码处均已在 baseline 读过文件；未读过的标 **UNVERIFIED**，尚不存在或未接线的能力标 **proposed-unwired**。

## 1. 这个 Skill 解决什么问题
S067 把一个**已框定的问题**（S064 `ProblemFrame`）和一个**已选定的方向**，写成一份**可被下游机械消费**的 PRD：每条需求有稳定的 `requirementId`，每条验收条件可独立判真假，范围边界（非目标）显式写出。它的读者有三类：人（评审 PRD 的 PM / 工程 / 设计）、W030 中的 S070 / S142 / S076（按 `requirementId` 切 sprint、建工作项、做设计交付追溯）。

S067 的核心风险不是「写得不好看」，而是三类会在下游爆炸的缺陷：
- **不可测**：验收条件里有「快速」「友好」「合理」这类词，S142 建出的卡无法关闭；
- **需求 id 漂移**：修订 PRD 时重新编号，S076 的追溯表和 S142 的工作项全部断链；
- **越权填空**：S067 自己编优先级、编 KPI 目标数字、编问题陈述，形成第二个事实源。

S067 **不做**的事（各有唯一归属）：
| 不做 | 归谁 |
|---|---|
| 写问题陈述、判断问题是否是伪装的解法 | S064 Problem Framing（S067 原样引用 `handoff.S067.problemSection`） |
| 机会排序、选方向 | S065 Opportunity Mapping |
| 需求优先级（must/should/could/wont 或 P0–P2） | S068 Prioritization |
| KPI 定义与目标数字 | S162 KPI Design |
| sprint 切分与估点 | S070 Sprint Planning |
| 建工作项 / 建卡 | S142 Work Item Management |
| 原型到需求的屏幕级追溯 | S076 Design Handoff |

## 2. 图上的消费者（逐条从矩阵读出，不推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行（原文） | S067 在其中的角色（本文对接口的理解，阶段顺序由 Workflow 作者定） |
|---|---|---|
| W029 Problem-to-PRD | 第 35 行：`\| W029 \| Problem-to-PRD \| Product \| S064, S065, S067, S068, S162 \|` | `mode = draft`：从 S064 frame + S065 选定机会（`handoff.S067.targetOpportunity`）写出 PRD 初稿；按已 PASS 的 W029 决策 7，`revise` 只回填 `goals`（`kpiRef` / `metricPending`，来自 S162）；按 W029 决策 4，W029 只用 S068 `solution-select`，**从不**向 S067 传 `priorityRef`，PRD 的 `requirements[].priority` 在 W029 中恒不存在 |
| W030 PRD-to-Sprint | 第 36 行：`\| W030 \| PRD-to-Sprint \| Product \| S067, S068, S070, S142, S076 \|` | `mode = readiness`：对一版冻结 PRD 做「可进 sprint」检查，不改写正文 |

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md）
| DigitalHuman | 矩阵行 | 该行 Workflow | 该行 Skill 列 | gaps |
|---|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | S061, S009, S064, S065, **S067**, S068, S069, S070, S071, S072, S073, S074, S008, S075 | — |

按 ADR-118 补充决策 9（已读 `docs/adr/ADR-118-generic-workflow-runtime.md:26`），D003 行的 Skill 列只代表**聊天中直接调用**。D003 运行 W029 / W030 时使用的是 Workflow 固定的 S067 版本，而不是 D003 自己挂载的版本；两者可以不同，S067 输出里因此记录 `skillVersion` 与 `invokedVia`（§6）。

矩阵中没有其他 Workflow 或 DigitalHuman 列出 S067。

## 3. 上游来源与许可（G1）
| 仓库 | 路径 | SHA | 许可（artifact 级） | 处理方式 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `product-management/skills/write-spec/SKILL.md`（250 行） | `da38ec1ee89d41e5380e652a97382695003396e7`（该路径最后一次提交即此 SHA；本地 `scratchpad/upstream/knowledge-work-plugins`） | Apache-2.0（`product-management/LICENSE`） | **adapt**。采用：Non-Goals 每条带理由（:91-95）；User Story 的常见错误清单——太含糊 / 规定 UI 控件 / 无收益 / 太大 / 内部视角（:147-152），落为 B3 的机械检查；验收条件用 Given/When/Then、覆盖错误与边界、包含「不应发生」的负例、禁用「fast / user-friendly / intuitive」一类词（:194-220），落为 C1–C3；Open Questions 标注回答方并区分 blocking / non-blocking（:127-130）；范围蔓延判据「新增必须伴随删减或延期」（:222-238），落为 D2。**不采用**：Problem Statement 的写法（:79-83，归 S064）；Goals 与 Success Metrics 的具体目标数字（:85-89、:168-192，归 S162）；P0/P1/P2 与 MoSCoW 分级（:113-166，归 S068）。 |
| RefoundAI/lenny-skills | `skills/writing-prds/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f`（该路径最后一次提交即仓库 HEAD） | MIT（仓根 `LICENSE`，Copyright (c) 2025 Refound AI） | **reference-only**。只借用两点并中文重述：问题陈述应不绑定具体解法并置于文首（:14、:31-34）；避免过度规定实现细节（:46-49），落为 B4「实现泄漏」检查。播客引语与嘉宾原话一律不复制。 |

- 按 Apache-2.0 §4(b)(c)，NOTICE 与改动说明写入 Skill 包的 `references/upstream.md`；本文不复制上游段落。
- 第二源只作参考的理由：lenny-skills 该文件是原则与模板索引，没有可执行的需求 / 验收结构；方法层只能从 write-spec 取。

## 4. 专业方法（S067 专属步骤）
四个阶段：A 入口核对、B 需求成文、C 验收条件、D 范围与就绪。每步对应 §6 字段，并由 §10 的一条失败模式守护。

### A. 入口核对（不替上游写）
- **A1 问题节只引用不重写。** 读服务端取得的 S064 frame 版本：`status` 必须是 `draft`（或已由 Workflow 关卡写成 `accepted`），且 `handoff.S067.problemSection` 非空；否则返回 `FRAME_NOT_READY`，不自行补写问题。`problem.text` 逐字等于 `problemSection`，`problem.frameRef` 记录 `frameId@version`。
- **A2 方向锚定。** `direction` 要么引用 S065 OpportunityMap 中的机会节点（`mapId@version` + `oppId`，即 S065 `handoff.S067.targetOpportunity` 所指节点），要么是调用方给出的一句话方向（`source = "caller"`）。若 `direction` 文本与 frame 的 `outOfScope[]` 任一项语义重合，返回 `DIRECTION_OUT_OF_FRAME`——PRD 不能写 frame 明确排除的事。
- **A3 目标只挂引用。** `goals[]` 每条是**结果方向**（沿用 frame 的 `outcomeSignals`），可附 `kpiRef`（S162 产物 id）。没有 `kpiRef` 的目标标 `metricPending: true`；S067 **不写**目标数字（决策 2）。

### B. 需求成文
- **B1 需求原子化。** 每条 `requirement` 只描述一个可观察行为，格式为「主体 + 情境 + 可观察结果」。含「和 / 以及 / and」连接两个独立行为的条目拆成两条。
- **B2 稳定编号。** 新需求取 `REQ-<n>`，`n` 在同一 `documentId` 内单调递增、永不复用（与 S076 输入正则 `/^[A-Z][A-Z0-9]*-\d+$/` 一致）。修订时删除的需求进 `retired[]` 保留 id；改写的需求保留 id 并记 `changeKind = "reworded" | "semantics-changed"`（决策 3）。
- **B3 用户故事检查。** 可选的 `story` 字段（「作为 <具体角色>，我想 <能力>，以便 <收益>」/ en-US "As a…, I want…, so that…"）过五条机械检查：角色不是泛称「用户 / user」；能力不含 UI 控件名词（下拉框、按钮、弹窗、dropdown、modal…）；收益非空；不是团队内部任务（主语不是「工程 / 我们团队」）；单条故事不引用超过 3 条需求（过大）。结果写入 `story.check`。
- **B4 实现泄漏检查。** 需求文本中出现数据库表名、框架名、具体接口路径或像素 / 颜色值，标 `implementationLeak`，要求改写成行为或移入 `constraints[]`（若确是硬约束，如「必须复用现有 SSO」）。
- **B5 证据继承。** 需求可引用 frame 中的 `struggle` 条目或 S063 `findingId`；措辞强度不得超过被引证据的 `assertionCeiling`（取值集合来自 `skills/S063-research-synthesis.md` §6，已 PASS）。无证据的需求 `rationale.kind = "assumption"`。

### C. 验收条件
- **C1 每条需求 ≥1 正例 + 情境需要时 ≥1 负例。** 采用 Given/When/Then；`criterionId = <requirementId>.AC<k>`，k 同样不复用。涉及权限、输入校验、外部依赖的需求必须有 `polarity = "negative"` 的条件（「不应发生」）。
- **C2 模糊词拦截。** 验收条件中出现模糊词表（zh：快速、及时、友好、直观、合理、大量、尽量；en：fast, quick, user-friendly, intuitive, seamless, reasonable, many）即判 `VAGUE`，必须替换为可观测量（时长、次数、状态值）或删除。模糊词表是 Skill 包的 `references/vague-terms.<locale>.txt`，与 S076 对屏幕文案的检查不共用（S076 检查的是设计 token，不是验收措辞）。
- **C3 可判定性。** 每条条件标 `verifiableBy ∈ {e2e, unit, manual-check, analytics}`。`analytics` 类条件必须引用一个 `goals[].goalId`，不得自带阈值数字（阈值归 S162）。

### D. 范围与就绪
- **D1 非目标 ≥3 条且各带理由。** 理由限定 `low-impact | too-complex | separate-initiative | premature | frame-excluded`；frame 的 `outOfScope[]` 自动继承为 `frame-excluded`，不重复论证。
- **D2 范围变更守恒（仅 revise）。** 相比上一版新增的在范围需求，必须同时满足三者之一：有对应的 `retired[]` / 降为非目标的条目、`timelineImpact` 非空、或 `scopeChangeAck` 由 Workflow 人工关卡回执写入。否则返回 `SCOPE_GROWTH_UNBALANCED`。
- **D3 开放问题分级。** `openQuestions[]` 每条带 `owner ∈ {engineering, design, legal, data, stakeholder}` 与 `blocking: boolean`；能从输入回答的问题不得列入（上游 :250）。
- **D4 就绪判定（readiness 模式，W030 用）。** 对服务端读到的冻结 PRD 版本只读检查，得出 `readiness.status`：`ready` 当且仅当无 blocking 问题、无 `VAGUE` / `implementationLeak` 残留、每条在范围需求 ≥1 条可判定验收条件、`goals` 中无 `metricPending`（该条件**恒生效**：已 PASS 的 W030 `readiness` 阶段直接采用本 D4 判定、未另设开关；按 W029 决策 7 留空的 goal 保持 `metricPending=true` 流入 W030，即产生 `metric-pending` blocker）。不就绪时列出 `blockers[]`（按 `requirementId` / `questionId` 定位），**不改写 PRD**。

## 5. 输入契约（`inputSchema`）
```ts
PrdInput = {
  mode: "draft" | "revise" | "readiness";
  frameRef?: { skill: "S064"; frameId: string; version?: number };     // draft 必填；服务端读取
  direction?: { source: "S065"; mapId: string; version: number; oppId: string }   // = S065 handoff.S067.targetOpportunity
            | { source: "caller"; text: string };                        // draft 必填，text 1–300 字
  prdRef?: { documentId: string; versionId: string };                    // revise / readiness 必填；服务端读取
  changeRequest?: string;                                                // revise 必填，1–2000 字
  priorityRef?: { skill: "S068"; proposalId: string; version: number };  // 只透传；图上无 Workflow 消费者（见下）
  kpiRefs?: Array<{ skill: "S162"; kpiId: string; goalId: string }>;     // ≤10；kpiId 属 S162，goalId 是 S067 自己的 goals[].goalId（非 S162 字段）
  evidenceRefs?: Array<{ skill: "S063"; synthesisId: string }>;          // ≤5
  constraints?: Array<{ text: string; kind: "hard" | "soft" }>;          // ≤20
  targetPlatforms?: Array<"web-desktop" | "web-mobile" | "ios" | "android" | "mini-program">;
  locale: "zh-CN" | "en-US";
  market?: "CN" | "US" | "global";
}
```
不变式：
- `mode = draft` ⇒ `frameRef ∧ direction` 必填，`prdRef` 禁止；
- `mode = revise` ⇒ `prdRef ∧ changeRequest` 必填；
- `mode = readiness` ⇒ 仅 `prdRef`（+ `locale`）；其余字段出现即 `INPUT_INVALID`；
- `priorityRef` 的现状：已 PASS 的 W029（决策 4、7）不传它，S068 需求级 MoSCoW（`scope-cut`）在 W030，而 W030 不调用 S067 revise——因此该字段在图上**没有任何 Workflow 消费者**，仅保留给聊天直接调用；S068 `cut.must/should/could/wont` 的元素是 `candidateId`，`candidateId ↔ requirementId` 的映射 S067 与 S068 均未定义，在定义之前 `priorityRef` 视为 **proposed-unwired**，出现即按 `PRIORITY_MISMATCH` 处理（见 §14 提议 4）。
- 输入中**不得**内联 PRD 正文、frame 正文或证据正文——一律按引用由服务端读取（§8）。

## 6. 输出契约（`outputSchema`，S067 专属）
```ts
PrdDraft = {
  documentId: string;                   // draft 时新分配；revise 时沿用 prdRef.documentId
  baseVersionId?: string;               // revise：基于哪一版
  status: "draft";                      // approved 只由 Workflow 人工关卡回执写入
  skillVersion: string; invokedVia: { kind: "workflow"; workflowId: "W029" | "W030"; runId: string }
                                   | { kind: "chat"; agentVersionId: string };
  locale: Locale;
  problem: { frameRef: string; text: string };                          // text ≡ frame.handoff.S067.problemSection
  direction: { source: "S065" | "caller"; ref?: string; text: string };   // ref = "<mapId>@<version>#<oppId>"（仅 S065）
  goals: Array<{ goalId: string; outcome: string; kpiRef?: string; metricPending: boolean }>;   // 1–5
  nonGoals: Array<{ text: string; reason: NonGoalReason }>;             // ≥3
  requirements: Array<{
    requirementId: string;              // /^REQ-\d+$/，文档内唯一且永不复用
    text: string;                       // ≤1000 字，单一可观察行为
    story?: { text: string; check: { specificActor: boolean; noUiWidget: boolean; hasBenefit: boolean; notInternal: boolean; small: boolean } };
    rationale: { kind: "evidence"; findingIds: string[]; ceiling: AssertionCeiling }
             | { kind: "frame-struggle"; index: number } | { kind: "assumption" };
    priority?: "must" | "should" | "could" | "wont";   // 仅从 priorityRef 透传，S067 不生成
    changeKind?: "new" | "reworded" | "semantics-changed";               // revise 时必填
    flags: Array<"implementationLeak">;                                  // draft 输出时必须为空
    acceptance: Array<{
      criterionId: string;              // "<requirementId>.AC<k>"
      given: string; when: string; then: string;
      polarity: "positive" | "negative";
      verifiableBy: "e2e" | "unit" | "manual-check" | "analytics";
      goalId?: string;                  // verifiableBy=analytics 时必填
    }>;                                 // ≥1
  }>;
  retired: Array<{ requirementId: string; reason: string; retiredInVersion: string }>;
  constraints: Array<{ text: string; kind: "hard" | "soft" }>;
  openQuestions: Array<{ questionId: string; text: string; owner: QuestionOwner; blocking: boolean }>;
  timelineImpact?: string;
  complianceNotes: Array<{ market: "CN" | "US"; topic: string; requirementIds: string[] }>;   // 仅提示，§9
}

PrdReadiness = {                        // mode = readiness 的唯一返回
  readinessId: string;                  // 本次就绪结果标识（供 S070 prdReadinessRef.outputId 引用）
  prdRef: { documentId: string; versionId: string };
  status: "ready" | "not-ready";
  blockers: Array<{ kind: "blocking-question" | "vague-criterion" | "implementation-leak"
                        | "no-criterion" | "metric-pending"; ref: string }>;   // ready ⇒ []
}
```
不变式（`scripts/check-prd.mjs` 机械核对，**proposed-unwired**，见 §12）：
1. `requirementId` 在 `requirements ∪ retired` 内唯一；revise 时上一版的每个 id 必须出现在本版 `requirements` 或 `retired` 中（无静默消失）。
2. 每条 `requirements[]` 至少 1 条 `acceptance`；`criterionId` 前缀等于所属 `requirementId`。
3. `acceptance` 的 given/when/then 不含模糊词表中的词；`analytics` 类条件带 `goalId` 且该 id 存在于 `goals`。
4. `problem.text` 与服务端读到的 `handoff.S067.problemSection` 逐字相等。
5. `nonGoals.length ≥ 3`；frame 的每条 `outOfScope` 都以 `frame-excluded` 出现。
6. 输出中不出现目标数字（`goals[].outcome` 无数字 / 百分号）；`priority` 只在带 `priorityRef` 时出现，且与 S068 结果逐条一致（逐条比对依赖尚未定义的 `candidateId ↔ requirementId` 映射，**proposed-unwired**）。
7. `status` 恒为 `draft`；不设 `approved`、`score`、`estimate`、`assignee` 字段。
8. `rationale.kind = evidence` 的每个 `findingId` 在服务端读到的 S063 synthesis 中可解析，需求措辞 ≤ `ceiling`。

类型化错误：
| 错误码 | 触发 |
|---|---|
| `INPUT_INVALID` | schema 或 §5 模式不变式违例 |
| `FRAME_REF_NOT_FOUND` / `PRD_VERSION_NOT_FOUND` / `EVIDENCE_REF_NOT_FOUND` | 引用不存在，或服务端判定调用方不可见（同一码，不泄露存在性） |
| `FRAME_NOT_READY` | frame `status ∉ {draft, accepted}` 或 `handoff.S067` 为空 |
| `DIRECTION_OUT_OF_FRAME` | 方向与 frame `outOfScope` 重合（A2） |
| `SCOPE_GROWTH_UNBALANCED` | 违反 D2 |
| `PRIORITY_MISMATCH` | `priorityRef` 的结果与本版 `requirementId` 集合对不上（S068 基于旧版排序） |
| `PRD_INCOMPLETE` | 两轮自修后不变式 2/3/5 仍不满足 |

`PrdReadiness.status = not-ready` 是正常返回，不是错误。

## 7. 依赖（能力分类，ADR-120）
- **required**：`knowledge.read`——按引用读取 S064 frame、S063 synthesis、S065 / S068 / S162 结果与 PRD 版本。该分类名是否已登记于 ADR-120 目录：**UNVERIFIED**（ADR-120:12 只给了 `crm.read` 一类示例）。
- **optional**：`sandbox.exec`，运行 `scripts/check-prd.mjs`；`apps/skill-sandbox/` 存在（S066 已核实目录），脚本本身 proposed-unwired。
- **无写能力**。PRD 版本的持久化是 W029 阶段或调用方另行发起的工具动作；riskClass = low。

## 8. 授权边界（调用方声明 vs 服务端核实）
| 项 | 调用方可声明 | 服务端必须核实 |
|---|---|---|
| 能否调用 S067 | — | 聊天直接调用：当前 Agent 已发布版本的 `agent_versions.skill_version_ids` 是否固定了 S067（字段注释见 `packages/contracts/src/identity.ts:363,431`；写入路径 `apps/api/src/application/agent-skill-pins/set-agent-skill-pins.ts` 文件已核实存在；调用前拦截的代码位置 **UNVERIFIED**）。Workflow 内调用：按 ADR-118 决策 9，核实 Agent 的 `workflowAllowlist` 允许该 W029/W030 版本，且该版本固定了 S067 |
| `frameRef` / `prdRef` / `evidenceRefs` / `priorityRef` / `kpiRefs` | 只给 id | 以调用者身份与组织读取对应**不可变版本**；跨组织或不可见统一返回 `*_NOT_FOUND`；不接受内联正文 |
| `assertionCeiling` | 不可声明 | 只取服务端读到的 S063 值；输入里夹带 ceiling 视为 `INPUT_INVALID` |
| `priority` | 不可声明 | 只能来自服务端读到的 S068 结果；调用方在 `changeRequest` 里写「把 REQ-3 设为 must」不产生 priority，只进 `openQuestions`（owner = stakeholder） |
| `status = approved` / `scopeChangeAck` | 不可声明 | 只由 Workflow 人工关卡回执写入；S067 输出出现 `approved` 即 schema 违例 |
| `invokedVia` | 不可声明 | 由运行时根据实际调用路径填入 |

## 9. CN / US 差异（实质性的部分）
- **规范性措辞映射。** en-US 需求文本采用 RFC 2119 语气（MUST / SHOULD / MAY），但与 `priority` 解耦——语气只表达「行为是否必须发生」，不表达排期优先级；zh-CN 对应「必须 / 应当 / 可以」。检查器按 locale 各自识别，防止把「应当」误读成 should-priority。
- **中文 PRD 的字段级惯例。** 国内团队常把字段说明、交互说明、原型截图写进 PRD。S067 允许 `requirements[].text` 描述字段的**可观察约束**（必填、长度、格式），但颜色、像素、动效时长仍按 B4 判为实现泄漏，交给 S076。
- **合规提示（`complianceNotes`，只提示不构成法律意见，法律判断交 D009 所挂的法务类 Skill）：**
  - CN：涉及个人信息收集的需求提示《个人信息保护法》单独同意与最小必要；推荐 / 排序类需求提示算法推荐的关闭选项与备案；`mini-program` 平台提示平台审核规则对功能的约束。
  - US：面向公众的界面提示 WCAG / ADA 可访问性验收；面向 13 岁以下用户提示 COPPA；数据导出 / 删除需求提示各州隐私法的消费者权利。
  - 提示只挂在具体 `requirementIds` 上；没有相关需求时 `complianceNotes = []`，不输出泛泛的合规段落。
- **故事格式。** zh-CN 的「作为…我想…以便…」中，「以便」后必须是用户收益而非「方便开发」；这一条在 zh 语料中误报更多，单独维护停用表。

## 10. 失败模式（S067 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 不可测验收 | 验收条件命中模糊词表 | 判 VAGUE，替换为可观测量或删除 |
| F2 | 需求 id 漂移 | revise 后上一版 id 既不在 requirements 也不在 retired | 不变式 1 拒绝；恢复原 id |
| F3 | 静默范围膨胀 | revise 新增在范围需求但无删减 / 延期 / 回执 | `SCOPE_GROWTH_UNBALANCED` |
| F4 | 自编优先级 | 无 `priorityRef` 却出现 `priority`，或出现「P0」字样 | schema 拒绝；措辞检查拦截 |
| F5 | 自编 KPI 目标 | `goals[].outcome` 含数字 / 百分号 | 不变式 6 拒绝，改为方向 + `metricPending` |
| F6 | 重写问题 | `problem.text` 与 frame problemSection 不等 | 不变式 4 拒绝 |
| F7 | 实现泄漏 / 过度规定 | 需求含表名、接口路径、像素、控件名 | 标 `implementationLeak`，改写或移入 constraints |
| F8 | 复合需求 | 一条需求含两个独立可观察行为 | B1 拆分，新 id |
| F9 | 只有快乐路径 | 涉及权限 / 校验的需求没有 negative 条件 | C1 要求补负例 |
| F10 | 就绪检查偷改正文 | readiness 模式输出了 PrdDraft | 该模式只允许 PrdReadiness |

## 11. 评测（`evals/work-stack/S067/`，ADR-119；夹具均为合成数据）
| # | 输入 | 通过标准 |
|---|---|---|
| E1 | draft：frame「新成员入职首周找不到团队文档」（status=draft），direction.caller「在团队空间首页提供入职文档入口」 | `problem.text` 与 frame problemSection 逐字相等；`nonGoals ≥ 3` 且含全部 frame-excluded 项；每条需求 ≥1 acceptance；输出无 `priority` |
| E2 | 同 E1，但 frame.status = `solution-in-disguise` | 返回 `FRAME_NOT_READY`，无 PrdDraft |
| E3 | draft，调用方 direction =「支持员工位置自动签到」，frame.outOfScope 含「员工位置追踪」 | `DIRECTION_OUT_OF_FRAME` |
| E4 | 模型草稿中某验收写「搜索结果应快速返回」 | 最终输出中该条被替换为可观测量（如「在 N 秒内返回首屏结果」且 N 来自 constraints 或列为 blocking openQuestion），不含「快速」 |
| E5 | revise：v1 有 REQ-1..REQ-5；changeRequest「去掉导出 PDF，改成导出 CSV」 | 原导出 PDF 需求进入 `retired` 并保留 id；CSV 导出为 REQ-6（`changeKind=new`）；REQ-1..4 id 不变 |
| E6 | revise：changeRequest 只新增 2 条需求，无删减、无 timelineImpact、无回执 | `SCOPE_GROWTH_UNBALANCED` |
| E7 | revise，带 `priorityRef` 指向 S068 对 v1 的结果，但本版已退役 REQ-3 并新增 REQ-6 | `PRIORITY_MISMATCH` |
| E8 | changeRequest「把 REQ-2 设为 P0，目标留存提升 5%」，无 priorityRef、无 kpiRefs | 输出无 `priority`、`goals` 无数字；产生 owner=stakeholder 的 openQuestion 与 `metricPending=true` 的目标 |
| E9 | `evidenceRefs` 指向另一组织的 synthesis | `EVIDENCE_REF_NOT_FOUND`，输出无该 synthesis 任何文本 |
| E10 | readiness：冻结 PRD 含 1 条 blocking openQuestion 和 1 条无 acceptance 的需求 | `status=not-ready`；`blockers` 恰含 `blocking-question` 与 `no-criterion` 两项并定位到 id；未返回 PrdDraft |
| E11 | 需求「在 users 表加 onboarding_seen 字段并在 /api/v1/onboarding 返回」 | 标 `implementationLeak` 后改写为行为描述；最终 `flags = []` |
| E12 | zh-CN、market=CN、需求涉及「根据浏览记录推荐文档」 | `complianceNotes` 含 CN 算法推荐关闭选项提示并挂在该 requirementId；需求措辞用「必须 / 应当」且无 `priority` |
| E13 | en-US、market=US、需求为「导出并删除我的数据」 | `complianceNotes` 含州隐私法消费者权利提示；验收含 negative 条件（未授权用户不能导出他人数据） |

打分方式：不变式 1–8 与 E2、E3、E5、E6、E7、E9、E10 由脚本判定；E4、E8、E11–E13 的措辞部分由 LLM-judge 按逐条 rubric 判定，G5 前人工抽检 20%。

## 12. WorkspaceX 落位
- **Skill 包：** 新建 `skills/standard-methods/prd-spec-writing/`（`SKILL.md`、`references/upstream.md`、`references/vague-terms.zh-CN.txt` / `.en-US.txt`、`scripts/check-prd.mjs`）。`skills/standard-methods/` 目录已存在（已读目录：interview-synthesis、maau-canvas、user-research-planning、scripts）。frontmatter 元数据按 ADR-117。**proposed-unwired**。
- **PRD 版本存储：** 候选是现有 artifact 版本模型——`apps/api/src/application/artifact/upload-new-version.ts` 已读，版本行不可变、按内容哈希幂等、以 `expectedHeadVersion` 做乐观并发（`VERSION_CHANGED`）。这正好满足 S076 的 `prdRef: { documentId, versionId }` 与本文不变式 1 的「按版本比对」。把 `PrdDraft` 作为 artifact 版本落盘、`documentId ↔ artifactId` 的映射由 W029 阶段写入：**proposed-unwired**；artifact 版本能否承载结构化 JSON 而非文件：**UNVERIFIED**。
- **引用校验：** `apps/api/src/application/context-pack/verify-citation.ts` 能否校验 S063 `findingId`：**UNVERIFIED**（与 S066 §12 同一未决点）。
- **类型复用：** `AssertionCeiling` 复用 S063 §6；`ProblemFrame` 复用 S064 §6；不另定义。

## 13. 决策
- **决策 1：问题节逐字引用 S064，不改写。** 上游 write-spec 让 PRD 自己写 Problem Statement；在 W029 中那会与 S064 的 frame 形成两份问题陈述，修订时必然漂移。S067 只保存 `frameRef` 与逐字文本，frame 变了就重新 draft 或 revise。
- **决策 2：目标只写方向，数字归 S162；优先级只透传，归 S068。** 上游把 Goals 数字、P0–P2 都放在 PRD 内。W029 矩阵已把 S068 与 S162 列为独立 Skill，S067 若生成它们就是同一事实两处声明。代价是初稿 `metricPending` 常为 true，W030 的 readiness 会把它作为 blocker 暴露。
- **决策 3：`requirementId` 单调、永不复用，删除走 `retired`。** S076 的追溯表与 S142 的工作项都以 id 为键；重编号会让下游静默错绑。宁可 id 有空洞。
- **决策 4：readiness 模式只读、只报 blocker。** W030 的输入必须是一版冻结的 PRD；如果就绪检查顺手改写，W030 消费的就不是被人审过的那一版。修复一律回到 `revise` 并经人工关卡。
- **决策 5：范围变更守恒是门，不是建议。** 上游「新增须伴随删减或延期」只是提示；S067 把它变成 `SCOPE_GROWTH_UNBALANCED`，唯一放行方式是人工关卡回执，保证范围膨胀总有人签字。

## 14. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **W029 缺 S063 证据入口**：**已裁定**——W029 §3 将 S063 写成触发前置条件（可选输入），不加边；`evidenceRefs` 按此作为可选输入。
2. **W030 中 S067 的角色**：**已裁定**——W030 §14 第 3 条决定 readiness 保留在 W030 由 S067 执行，不移给 S070。
3. **W029 与 S075**：S075 文档 §14 已提议在 W029 的 S067/S068 之后加入 S075；本文不附议也不反对，只指出若采纳，S075 需读取 `prdRef` 版本。
4. **`priorityRef` 无消费者**：S068 结果回填 S067 的路径在图上无 Workflow 使用；若要启用，需 S067/S068 共同定义 `candidateId ↔ requirementId` 映射并由某个 Workflow 作者接线；否则可考虑移除该字段。本文不假定。

## 15. 未决问题
- `knowledge.read`、`sandbox.exec` 是否已登记于 ADR-120 目录（UNVERIFIED）。
- PRD 以 artifact 版本落盘的形态（结构化 JSON vs 渲染文档 + 附带 JSON）需要 W029 作者与 artifact 模块确认。
- 模糊词表的中文误报率需在 E4 系列扩充夹具后评估。
