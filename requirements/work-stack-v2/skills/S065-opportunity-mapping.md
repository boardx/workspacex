# S065 — Opportunity Mapping（机会地图）

> Type: Work Skill · Domain: Product & Design · Strategy: A1（一个 adapt 主源 + 两个 reference-only 源）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文由 AUTHOR-S065 独立作者化；v1 同名文件只当话题清单用，正文没有沿用。
> 凡是提到 WorkspaceX 现有代码的地方，都在 baseline 上读过文件或目录；没读过的标 **UNVERIFIED**，还不存在或没接线的能力标 **proposed-unwired**。

## 1. 这个 Skill 解决什么问题
S065 接收一个已经框定的问题（或一个明确的产品结果），把它展开成一棵**机会解法树**（Opportunity Solution Tree，OST）：
- 根：要推动的结果（outcome）；
- 机会层：未被满足的需要、痛点、渴望。按用户旅程的步骤组织，越往下越具体；
- 解法层：挂在某个机会下的候选解法。S065 只挂载，不生成；
- 假设层：每个被挂载解法最危险的那条假设，只作线索交给下游。

然后在**同一父节点下的兄弟机会之间**做比较，给出一个**建议目标机会**（`proposedTarget`）。「选定」要等人确认。

在 S061、S063、S064、S066 这四篇已写成的文档里，「机会排序」都被明确划归 S065（S061 决策 5、S063 §1、S064 §1、S066 决策 4）。所以 S065 是整个产品链路中**唯一**在问题空间里做排序的环节。

S065 **不做**的事：
| 不做 | 归谁 |
|---|---|
| 从访谈 / 反馈原文提炼洞察 | S063 Research Synthesis（S065 只引用 `findingId`） |
| 写问题陈述、定证伪条件 | S064 Problem Framing（S065 以 `ProblemFrame.handoff.S065.rootProblem` 为根） |
| 为某个机会发散出多个解法 | S066 Product Brainstorming（它不在 S065 所在的 Workflow 上，见 §14 提议 1） |
| 给解法或 backlog 条目按投入产出排序（RICE / ICE / MoSCoW） | S068 Prioritization（W029 中紧跟在 S065 之后） |
| 设计实验 | S071 Experiment Design |
| 定 KPI 口径与目标值 | S162 KPI Design |

它要防住的核心错误有三种：
- **把解法写成机会**：上游来源里有一个说法，绝大多数人写出来的「机会」其实是解法；
- **把小样本当市场规模**：W027/W028 的样本通常只有 5–15 人（S063 决策 4 的前提）；
- **用一个合成分数掩盖取舍**：分数一旦出现，下游 S067/S068 会把它当成事实。

## 2. 图上的消费者（逐条从矩阵读出，不推导）
### 2.1 Workflow（`WORKFLOW-SKILL-MATRIX.md`）
| Workflow | 矩阵行 | 该行 Skill 列（原样） | S065 在该行的位置 | 上游进来的是什么 |
|---|---|---|---|---|
| W027 Discovery-to-Opportunity | 第 33 行 | S061, S062, S009, S063, S064, S065 | 最后一个 | S064 `ProblemFrame`、S063 `ResearchSynthesis`（这条线里恒为 `provisional`，因为没有 S171）、S061 `DiscoveryReadout` |
| W028 Research-to-Insight | 第 34 行 | S062, S009, S063, S169, S171, S065 | 最后一个 | S063 synthesis（S171 复核后可以变成 `final`）、S169 的产物。**这一行没有 S064**，所以根只能来自调用方给的 `outcome`（见 §4 A1、§14 提议 2） |
| W029 Problem-to-PRD | 第 35 行 | S064, S065, S067, S068, S162 | 第 2 个 | S064 `ProblemFrame`；产物交给 S067（PRD 的问题 / 机会章节）、S068、S162 |

S169 Knowledge Synthesis 目前还没有 PASS 文档。S065 不假设它的输出 schema，在 W028 中只接受 S063 的 synthesis 作为证据（见 §5 不变式 I3）。

### 2.2 DigitalHuman（`DIGITALHUMAN-COMPOSITION-MATRIX.md`）
| DigitalHuman | 矩阵行 | 该行 Workflow | 该行 Skill 列 | gaps 列 |
|---|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | S061, S009, S064, **S065**, S067, S068, S069, S070, S071, S072, S073, S074, S008, S075 | — |
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | S062, S009, S064, **S065**, S066, S071, S063, S075, S018 | Persona/Journey facilitation; HMW framing; Prototype planning |

ADR-118 决策 9 写在 `docs/adr/ADR-118-generic-workflow-runtime.md:26`（已读）：DigitalHuman 行的 Skill 列只列「在聊天中直接调用」的 Skill。所以 D003 和 D011 行里的 S065 表示两人都可以**直接调用** S065。它们运行 W027/W028/W029 时，用的是 Workflow 锁定的 S065 版本，与这条挂载无关。

说明：本批次的闭包是 D001–D010，D011 不在其内，但它确实是矩阵上的消费者，这里原样列出。D011 的 gap「Persona/Journey facilitation」和 S065 的 A3 步（按旅程步骤组织机会）有交集，但 S065 **不认领**这个 gap：它只**消费**一份已有的旅程步骤列表，不负责引导用户画出旅程（§14 提议 3）。

## 3. 上游来源与许可（G1）
所有来源都已 clone 到 `scratchpad/upstream/`，SHA 取自 `git rev-parse HEAD`。

| 仓库 | 路径 | SHA | 许可（artifact 级） | 处理方式 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `product-management/skills/product-brainstorming/SKILL.md` 中的「Opportunity Solution Trees」小节（:108–131） | `da38ec1ee89d41e5380e652a97382695003396e7`（该文件最后一次提交也是这个 SHA） | Apache-2.0（`product-management/LICENSE`） | **adapt**。采用四层结构（结果 → 机会 → 解法 → 实验，:112–125），以及四条要点（:128–131）：机会必须能追溯到证据；每个机会要有多个解法；验证要找最便宜的方式；树是会更新的活文档。它们分别落到 A4、B3、C3 和 `revise` 模式。 |
| anthropics/knowledge-work-plugins | `product-management/skills/roadmap-update/SKILL.md` 的「Prioritization Frameworks」小节（RICE :139–147，ICE :159–166） | 同上 | Apache-2.0（同上） | **reference-only，而且是反面参照**。决策 2 说明了 S065 为什么**不在机会层用** RICE/ICE：这两者要求 Reach 用绝对数量、Confidence 用百分比，而 W027/W028 的访谈证据给不出这两种数。这类框架属于 S068。 |
| RefoundAI/lenny-skills | `skills/continuous-discovery/SKILL.md`（:16「Structure the opportunity space」，:21–24「Distinguish needs from solutions」，:83「Building for vocal minorities」）与 `skills/continuous-discovery/references/artifacts.md`（:88–91「Opportunity Solution Tree (Teresa Torres)」） | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`，Copyright (c) 2025 Refound AI） | **reference-only**。借用三个观点：机会是未满足的需要，而不是功能；顶层机会按用户旅程的步骤组织，越往下越具体、直到可以解决；要警惕只照顾声音最大的少数用户。分别落到 A3、B1、C1 的集中度检查。文中的播客引语**不复制**。 |

- 按 Apache-2.0 §4(b)(c) 的要求，NOTICE 和改动说明写进 SKILL 包的 `references/upstream.md`。本文所有上游要点都已经用中文重述，没有照搬原文。
- 为什么只有一个 adapt 源：在已 clone 的仓库里，只有 knowledge-work-plugins 这份给出了带许可的 OST 结构说明；lenny-skills 那份只是框架索引加引语，所以只作参考。Torres 的原著没有 clone 到可用的开源副本，本文**不引用**原著。

## 4. 专业方法（S065 专属步骤）
### A. 立根与收集
- **A1 立根。** 根 `outcome` 按以下优先级取：
  1. `frameRef` 指向的 S064 `ProblemFrame`，取其 `handoff.S065.rootProblem`，并由服务端读出该 frame。它的 `status` 必须是 `draft`，或者已经被 Workflow 人工关卡写成 `accepted`。如果是 `needs-choice`、`too-broad` 或 `solution-in-disguise`，按 S064 不变式 6，`handoff` 是空的，S065 直接返回 `FRAME_NOT_READY`。
  2. 调用方给出的 `outcome`（W028 走这一路，因为该行没有 S064）。这时要做三项检查：有没有行为主体、有没有可观察的行为、有没有方向（增加或减少）。缺任何一项都返回 `root.status = "unanchored"`，只输出机会**候选列表**，不建树、不排序。
  3. 两者都给了：以 frame 为准，把差异写进 `root.divergenceNote`。
- **A2 证据池。** 从 `synthesisRefs` 读出服务端版本的 S063 `ResearchSynthesis`。只取 `kind ∈ {claim, theme, conflict}` 的 Finding，保留它们的 `findingId`、`confidence`、`assertionCeiling`、`independentRootCount`、`prevalence` 和 `status`（`final` 或 `provisional`）。如果输入里还有 `readoutRef`（S061 `DiscoveryReadout`），把其中 `result ∈ {supported, refuted}` 的 verdict 当作对某些假设的**改判信号**，同时把 `candidateSolutions` 原样读入解法候选池。S065 不评价这些解法。
- **A3 旅程骨架。** 顶层机会必须挂在某个旅程步骤上：
  - 调用方给了 `journeySteps`，就直接使用；
  - 没给的话，从 Finding 的 `claim` 中抽出 3–7 个动作阶段作为**草拟骨架**，并标记 `journey.source = "inferred"`。

  inferred 骨架只用来归类。它会出现在输出里，由人确认；S065 不把它当作事实写进任何下游产物。

### B. 生成与检验机会节点
- **B1 需要化改写。** 每条候选机会写成「〈主体〉在〈情境〉下〈难以 / 想要 / 担心〉〈结果〉」的形式，然后跑**解法检测**：句子里出现构建动词（做 / 加 / 上线 / 支持 / build / add），或者出现产品界面名词（按钮 / 页面 / 开关 / 集成），就判定为解法伪装。命中的候选**不进入机会层**，而是作为解法挂到它背后的那个需要下面。如果找不到背后的需要，就放进 `unplaced[]`，理由写 `solution-without-need`。
- **B2 接地。** 每个机会节点带 `grounding`，有两种：
  - `evidence`：`findingIds` 非空，节点措辞的强度不得超过这些 Finding 中最弱的 `assertionCeiling`；
  - `assumption`：没有 Finding 支撑。这类节点可以留在树上，但**不能被选为 `proposedTarget`**（不变式 I6）。
- **B3 分层与切分。**
  - 父子关系必须是「子机会是父机会的一种具体表现」。检验方法是能否把子句读成「〈父〉，具体表现为〈子〉」而不别扭；读不通就说明是并列关系，要上移一层。
  - 深度上限 4 层（不含根）。
  - 同一父节点下兄弟节点的上限是 7 个；超过 7 个时，必须先找出共同的父机会，把它们归到下面。
  - 叶子机会必须**可解**：至少能想到一个团队可以在一个周期内做的动作。想不到的话，就标 `tooAbstract: true`，继续往下切。
- **B4 冲突保留。** 如果证据池里有 S063 `kind = conflict` 的 Finding，就生成一个成对的机会节点，写上 `conflictWith`，**不去调和**。例如「管理员想要集中控制」和「成员想要自助」这一对，两边都保留。

### C. 兄弟比较与建议目标
- **C1 逐维有序比较。** 只在同一父节点的兄弟机会之间比较，四个维度，每个维度只给「高 / 中 / 低 / 未知」这样的有序档，**不算数值总分**。
  - `evidenceStrength`：看 Finding 的 `confidence` 和 `independentRootCount`。只要引用了任何 `status = provisional` 的 Finding，这一档最高到「中」。
  - `breadth`：看 `prevalence.experienceParticipants / of`。**原样写成分数形式**（例如「5/8 名参与者」），禁止换算成百分比。如果某个机会的全部证据都来自同一位参与者或同一个客户账户，就标 `concentrated: true`，并把 `breadth` 降为「低」。这是针对「只照顾声音最大的少数」的机械化检查。
  - `severity`：取自 frame 的 `costOfInaction` 和 Finding 描述里的影响程度。frame 写的是 `unknown`，这一档就是「未知」。
  - `outcomeLink`：这个机会被解决后，是否会推动根 outcome 的方向。取值只有「直接 / 间接 / 未证」三种。
- **C2 支配关系与建议。**
  - 如果兄弟 A 在四个维度上都不低于兄弟 B，并且至少一维严格高于 B，就记 `A dominates B`。
  - 在顶层兄弟中，**没有被任何节点支配**的集合叫前沿（frontier）。
    - 前沿只有 1 个节点：`proposedTarget` 就是它，并写出支配依据。
    - 前沿有 2–3 个节点：`proposedTarget = null`，`decision.status = "needs-choice"`。对前沿中的每一对节点写出 `tradeoff`，说明在哪一维上各自占优。
    - 前沿超过 3 个节点：说明证据不够区分，`decision.status = "insufficient-evidence"`，同时把「用什么证据能拉开差距」写进 `researchQuestions[]`，交给 S062 或 S009。
  - 目标选定之后，递归到它的子层做同样的比较，直到叶子，得到一条 `targetPath`。
- **C3 解法挂载检查。** 被建议的目标机会下，如果挂载的解法少于 2 个，就标 `solutionCoverage = "single"` 或 `"none"`，并在 `handoff` 里提示需要先扩充解法。这对应上游「每个机会要有多个解法」。S065 自己**不补**解法（决策 3）。对每个已挂载的解法，只写一条 `riskiestAssumption` 线索，不设计实验。
- **C4 人工确认。** `decision.status` 在 S065 的输出里**只能**是 `proposed`、`needs-choice`、`insufficient-evidence` 三者之一。`accepted` 只能由 W027/W029 的人工关卡回执写入（§8）。

### D. 修订（`mode = "revise"`）
- **D1** 输入 `previousMapId`，服务端读出上一版，`version + 1`。
- **D2** 新的 Finding 或 readout 进来后，只重算受影响子树的 C1 档位。节点 id 保持稳定；被新证据推翻的机会标 `retired`，附上推翻它的 `findingId`，**不删除**。
- **D3** 如果 `proposedTarget` 相对上一版发生了变化，必须写 `changeLog[]`，说明是哪条证据引起的变化。用户在上一版中确认过的目标，被新证据降级时，结果是 `decision.status = "needs-choice"`，**不会**静默换掉目标。

## 5. 输入契约（`inputSchema`）
```ts
OpportunityMapInput = {
  mode: "build" | "revise";
  frameRef?: { skill: "S064"; frameId: string; version?: number };   // 省略 version 取最新
  outcome?: { actor: string; behavior: string; direction: "increase" | "decrease"; window?: string };
  synthesisRefs?: Array<{ skill: "S063"; synthesisId: string }>;    // 0–5
  readoutRef?: { skill: "S061"; planId: string; planVersion: number };
  journeySteps?: string[];                  // 3–9 条，按时间顺序
  seedOpportunities?: string[];             // 用户已有的机会表述，≤15；同样要过 B1 解法检测
  constraints?: Array<{ text: string; kind: "hard" | "soft" }>;    // ≤20；hard 约束命中的机会只能进 parked
  previousMapId?: string;                   // revise 必填
  locale: "zh-CN" | "en-US";
  market?: "CN" | "US" | "global";
}
```
不变式（输入）：
- **I1** `frameRef` 与 `outcome` 至少要有一个。
- **I2** `mode = "revise"` 时 `previousMapId` 必填，并且服务端读到的必须是这张地图的最新版本。
- **I3** 证据只从 `synthesisRefs` / `readoutRef` 进来。**不接受**内联的 Finding 正文、`confidence` 或 `prevalence`；这些值一律取服务端读到的版本。
- **I4** `synthesisRefs` 与 `readoutRef.synthesisId` 所指的对象必须属于同一组织。

## 6. 输出契约（`outputSchema`，S065 专属）
```ts
OpportunityMap = {
  mapId: string; version: number; mode: "build" | "revise"; locale: Locale; market: Market;
  root: { outcome: string; source: "S064-frame" | "caller-outcome";
          frameId?: string; frameVersion?: number;
          status: "anchored" | "unanchored"; divergenceNote?: string };
  journey: { steps: string[]; source: "caller" | "inferred" };
  evidenceBasis: { synthesisIds: string[]; anyProvisional: boolean; readout?: { planId: string; planVersion: number } };
  opportunities: Array<{
    oppId: string;                           // "O1".. 跨版本稳定
    parentId: string | "root";
    journeyStep?: string;                    // 顶层必填
    statement: string;                       // ≤120 字，需要句式（B1）
    grounding: { kind: "evidence"; findingIds: string[]; ceiling: AssertionCeiling }
             | { kind: "assumption" };
    conflictWith?: string;                   // 另一个 oppId
    tooAbstract: boolean;
    retired?: { byFindingIds: string[] };
    assessment?: {                           // 仅对参与 C1 比较的兄弟节点
      evidenceStrength: Level; severity: Level;
      breadth: { level: Level; fraction?: string /* 如 "5/8 participants"，禁止 % */; concentrated: boolean };
      outcomeLink: "direct" | "indirect" | "unproven";
    };
    solutions: Array<{ solutionId: string; text: string;
                       origin: "S061-candidate" | "user" | "reclassified-from-opportunity";
                       riskiestAssumption?: { text: string;
                         category: "desirability" | "viability" | "feasibility" | "usability" } }>;
  }>;
  comparisons: Array<{ parentId: string; frontier: string[];
                       dominance: Array<{ winner: string; loser: string; strictOn: Dimension[] }>;
                       tradeoffs: Array<{ a: string; b: string; aAhead: Dimension[]; bAhead: Dimension[] }> }>;
  decision: { status: "proposed" | "needs-choice" | "insufficient-evidence";
              proposedTarget: string | null; targetPath: string[];
              solutionCoverage?: "multiple" | "single" | "none" };
  unplaced: Array<{ text: string; reason: "solution-without-need" | "hard-constraint" | "off-outcome" | "duplicate" }>;
  researchQuestions: Array<{ text: string; discriminates: string[] /* oppIds */; suggestTo: "S062" | "S009" }>;
  changeLog: Array<{ fromVersion: number; change: string; causeFindingIds: string[] }>;
  handoff: {
    S067?: { targetOpportunity: string; evidenceFindingIds: string[]; alternativesConsidered: string[] };
    S068?: { solutionIds: string[] };        // 仅目标机会下的解法，供其按投入产出排序
    S162?: { outcome: string };
  };
}
type Level = "high" | "medium" | "low" | "unknown";
type Dimension = "evidenceStrength" | "breadth" | "severity" | "outcomeLink";
```
不变式由 `scripts/check-map.mjs` 机械核对（proposed-unwired，见 §12）：
1. `oppId` 构成一棵以 `root` 为根的树，没有环；深度 ≤ 4；每个父节点下未 retired 的子节点 ≤ 7。
2. 所有顶层机会的 `journeyStep` 都必须在 `journey.steps` 里。
3. 每个 `opportunities[].statement` 都要通过 B1 的解法检测（与 S064 不变式 2 使用同一套分词和停用词表，不另建一套）。
4. 所有 `findingIds` 都必须能在服务端读到的 synthesis 里解析出来；节点措辞强度 ≤ `ceiling`。
5. `evidenceBasis.anyProvisional = true` 时，所有 `assessment.evidenceStrength` 都不能是 `high`。
6. `decision.proposedTarget` 非空时，以下全部要满足：该节点的 `grounding.kind = evidence`；它在所在层的 frontier 中是唯一一个；它不是 `retired`，也不是 `tooAbstract`。
7. `decision.status = "proposed"` ⇔ `proposedTarget ≠ null`。当 `root.status = "unanchored"` 时，`comparisons = []`，`proposedTarget = null`。
8. 全部输出文本里**不得**出现 `%`、「百分之」、「大多数用户」、"most users"；**不设** `score`、`rank`、`riceScore`、`priority` 字段。
9. `decision.status ≠ "proposed"` 时 `handoff = {}`。没有确定的目标，就不往 PRD 流。

类型化错误：
| 错误码 | 触发条件 | 调用方可以做什么 |
|---|---|---|
| `INPUT_INVALID` | schema 违例，或违反 I1、I4 | 修正输入 |
| `FRAME_REF_NOT_FOUND` | frame 不存在，**或**服务端判定对调用方不可见（两种情况同一个码，避免泄露资源是否存在） | 确认 id 和权限 |
| `FRAME_NOT_READY` | frame 的 `status ∈ {needs-choice, too-broad, solution-in-disguise}` | 先回 S064 完成框定 |
| `SYNTHESIS_REF_NOT_FOUND` / `READOUT_REF_NOT_FOUND` | 同 `FRAME_REF_NOT_FOUND` 的规则 | **不得**换用别的 synthesis 静默重试 |
| `PREVIOUS_MAP_NOT_FOUND` / `MAP_VERSION_STALE` | 违反 I2 | 取最新版再做 revise |
| `EVIDENCE_EMPTY` | `mode = build`，证据池为空，并且 `seedOpportunities` 也为空 | 补证据，或者提供种子机会（此时全部节点都是 assumption，一定不会产出 proposed） |

`root.status = unanchored`、`needs-choice`、`insufficient-evidence` 都是**正常返回**，不算错误。

## 7. 依赖（能力分类，ADR-120）
- **required**：无写能力，核心是纯推理。
- **conditional**：`knowledge.read`（带 `frameRef`、`synthesisRefs`、`readoutRef` 或 `previousMapId` 时，用来读取服务端版本）。这个分类名是否已在 ADR-120 目录里登记：**UNVERIFIED**。S063、S064、S066 三篇文档记录了同一个未决问题。
- **optional**：`sandbox.exec`，在 `apps/skill-sandbox/`（baseline 上已列出该目录）里运行 `scripts/check-map.mjs` 和 `scripts/dominance.mjs`（C2 的支配与前沿计算，确定性，不调用模型）。两个脚本都是 **proposed-unwired**。
- riskClass = low。地图的持久化（按 `mapId + version` 不可变保存）是 **proposed-unwired**：baseline 上没有机会地图的表，也没有对应的用例。

## 8. 授权边界（调用方声明 vs 服务端核实）
| 项 | 调用方可以声明 | 服务端必须核实 |
|---|---|---|
| D003 / D011 在聊天中直接调用 S065 | — | 当前 Agent 的已发布版本是否在 `agent_versions.skill_version_ids` 里固定了 S065。字段已在 `packages/contracts/src/identity.ts:363` 和 `:431` 的注释里核实；pin 的写入路径是 `apps/api/src/application/agent-skill-pins/set-agent-skill-pins.ts`（已核实文件存在）。运行时在调用前按 pin 做拦截的代码位置：**UNVERIFIED** |
| 在 W027 / W028 / W029 的阶段内调用 | — | 该 Workflow 版本固定了 S065 的版本，并且 Agent 的 `workflowAllowlist` 包含这个 Workflow 版本（ADR-118 决策 9）。在 `apps/api/src`、`packages/contracts/src` 里 grep `workflowAllowlist` 没有命中，所以是 **proposed-unwired** |
| `frameRef` / `synthesisRefs` / `readoutRef` / `previousMapId` | 只给 id | 按调用主体和组织读取对应版本；`frame.status`、Finding 的 `confidence` / `prevalence` / `ceiling`、synthesis 的 `status` 全部以服务端读到的为准（I3） |
| `decision.status = accepted` 与最终目标 | 不可声明 | 只能由 Workflow 人工关卡的回执写入，并记录确认人的 userId。S065 的输出里出现 `accepted` 按 schema 违例处理 |
| `journeySteps`、`seedOpportunities`、`constraints` | 可以声明 | 不核实真伪。所以种子机会一律是 `assumption`，除非 B2 能把它挂到服务端的 Finding 上；谎报 hard 约束只会让机会变少，不构成越权 |
| `market` | 可以声明 | 只影响 §9 的方法提示，不授予任何数据访问权限 |

## 9. CN / US 差异（实质性的部分）
| 维度 | CN | US |
|---|---|---|
| 主体切分 | 企业软件的采购方、IT 管理员、日常使用者常常是三类不同的人；加上集团和子公司两层审批，同一个「痛点」在不同主体那里方向可能相反。`market = CN` 时，B3 要求顶层机会的 `statement` 写明主体角色；如果证据混了多个角色，必须拆分 | 买方和用户分离同样常见，但 PLG（自助采购）团队里两者常常是同一个人。不强制拆分，只在证据里出现 `admin` / `buyer` 这类角色时才提示拆分 |
| 生态类机会 | 「在企业微信 / 钉钉 / 飞书里完成」这类表述，很容易是解法伪装。B1 的解法检测把「在〈平台〉里」列为界面名词，要求改写成背后的需要（例如「不离开日常沟通工具就能完成审批」） | 对 Slack / Teams 这类表述做同样处理 |
| 合规衍生的需求 | 来自《个人信息保护法》、数据出境、等保的要求，是**约束**，不是用户机会。应该以 hard 约束的身份进入 `constraints`；如果它也出现在证据里（例如客户安全审查卡住了采购），可以作为「采购方」主体的机会，但 `outcomeLink` 必须如实标注 | 对 SOC 2 / HIPAA / 各州隐私法做同样处理；无障碍（ADA / Section 508）采购要求在政府和教育类客户里常常是硬门槛，处理方式相同 |
| 规模措辞 | 禁止出现「大多数」「普遍」「绝大部分」 | 禁止出现 "most" "majority" "widespread"；两边都只能写原始分数 |

## 10. 失败模式（S065 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 解法伪装成机会（「加一个批量导出」出现在机会层） | 不变式 3 | 重新归类为解法，挂到它背后的需要下面；找不到需要就放进 `unplaced` |
| F2 | 小样本被写成市场规模 | 不变式 8；`breadth.fraction` 的格式校验 | schema 拒绝输出 |
| F3 | 声音最大的客户主导了排序（某个大客户的 6 张工单撑起一个顶层机会） | 某机会的全部 `supportingEvidenceIds` 只来自一个参与者或账户 → `concentrated` | `breadth` 降为「低」，并在 tradeoff 里写明 |
| F4 | 用合成分数掩盖取舍 | 不变式 8；C2 只输出支配关系和 tradeoff | schema 拒绝输出 |
| F5 | 结构错乱：子机会其实和父机会是并列关系，导致兄弟比较失真 | B3 的「具体表现为」改写检查失败 | 把该节点上移一层后重新比较 |
| F6 | provisional 证据被当成定论（W027 的常态） | 不变式 5 | `evidenceStrength` 封顶在「中」，`anyProvisional` 在输出里显式标出 |
| F7 | 静默换目标：revise 后目标变了，却没留下原因 | 相对上一版 `proposedTarget` 的比对 | `changeLog` 必填；用户确认过的目标被降级时，走 `needs-choice` |
| F8 | 冲突被调和掉（两类用户需求相反，被合成一个中庸的机会） | 证据池里有 `kind = conflict` 的 Finding，但树上没有 `conflictWith` 这一对 | 按 B4 拆成一对节点 |
| F9 | 树长成无限大 | 不变式 1 | 超出兄弟上限时先归纳出共同的父机会；超出深度上限就在第 4 层停止细分，把更细的表述作为该节点的解法候选或 `researchQuestions` 处理 |

## 11. 评测（`evals/work-stack/S065/`，ADR-119；夹具均为合成数据）
| # | 输入 | 通过标准 |
|---|---|---|
| E1 | W029：S064 frame（draft，rootProblem =「新成员入职首周无法独立找到负责人和文档」）+ 一份 final synthesis，含 F1 theme（6/9）、F2 theme（2/9）、F3 claim | 顶层 3–7 个机会，都挂在 `journey.steps` 里；每条 statement 都通过解法检测；`comparisons[0].frontier` 能由 `dominance` 推出（脚本复算一致）；输出中没有 `%` |
| E2 | `seedOpportunities` = [「加一个组织架构搜索框」, 「新人不知道该问谁」] | 前者进入 `solutions`（`origin = reclassified-from-opportunity`），挂在「新人不知道该问谁」这类需要节点下面；机会层中没有「搜索框」 |
| E3 | W027：synthesis 为 `provisional`，两个顶层机会在四个维度上的原始档位都是「高」 | `evidenceStrength` 全部 ≤「中」；`anyProvisional = true`；两者互不支配 → `needs-choice`，`handoff = {}` |
| E4 | 机会 O2 的 5 条证据全部来自同一个客户账户（B2B 大客户工单），O1 的 3 条证据来自 3 个账户 | O2 的 `concentrated = true`，`breadth = low`；tradeoff 里写明这一点；O2 不会仅凭证据条数胜过 O1 |
| E5 | W028：没有 frame，只有 `outcome = {actor: "团队管理员", behavior: "每周查看看板", direction: "increase"}`；synthesis 经过 S171 复核，`status = final` | `root.source = caller-outcome`，`root.status = anchored`；允许出现 `evidenceStrength = high` |
| E6 | 只有 `outcome = {actor: "", behavior: "提升留存", direction: "increase"}` | `root.status = unanchored`；`comparisons = []`；`proposedTarget = null`；不报错 |
| E7 | `frameRef` 指向 `status = needs-choice` 的 frame | 返回 `FRAME_NOT_READY`，不产出任何树 |
| E8 | `synthesisRefs` 指向另一个组织的 synthesis | 返回 `SYNTHESIS_REF_NOT_FOUND`；输出里没有任何 Finding 文本 |
| E9 | 证据池中有 conflict Finding：「管理员要求统一审批模板」vs「成员希望自己定义流程」 | 树上有一对带 `conflictWith` 的节点；没有出现合并后的「灵活又统一」这类节点 |
| E10 | revise：上一版用户已确认 O3；新 synthesis 中一条 F7 推翻了 O3 的核心证据 | O3 标 `retired.byFindingIds = [F7]`；`decision.status = needs-choice`；`changeLog` 引用 F7；oppId 没有被重新编号 |
| E11 | `market = CN`；证据混合了「IT 管理员希望统一管控」和「员工想在钉钉里直接审批」 | 两个主体被拆成两个顶层机会；「在钉钉里」被改写成需要句式；hard 约束为空时不会自动添加 PIPL 约束 |
| E12 | 前沿中有 5 个互不支配的顶层机会 | `decision.status = insufficient-evidence`；`researchQuestions` 非空，每条 `discriminates` 至少引用 2 个 oppId，`suggestTo ∈ {S062, S009}` |

判定方式：
- 不变式 1–9，以及 E1（复算部分）、E3、E6、E7、E8、E10、E12 由脚本判定；
- E2、E4、E9、E11 的措辞和拆分部分由 LLM-judge 按逐条 rubric 判定，进入 G5 前人工抽检 20%。

## 12. WorkspaceX 落位
- **Skill 包**：新建 `skills/standard-methods/opportunity-mapping/SKILL.md`。`skills/standard-methods/` 目录在 baseline 上已存在，含 `interview-synthesis/`、`maau-canvas/`、`user-research-planning/`、`scripts/`（已列目录）。frontmatter 按 ADR-117。**proposed-unwired**。
- **脚本**：`scripts/check-map.mjs`（不变式 1–9）、`scripts/dominance.mjs`（C2），在 `apps/skill-sandbox` 中执行。**proposed-unwired**。
- **类型复用**：`AssertionCeiling` 与 Finding 字段直接引用 S063 §6，`ProblemFrame` 引用 S064 §6，`DiscoveryReadout` 引用 S061 §6，不在 S065 里重复定义。解法检测的分词表与 S064 共用一份（不变式 3）。
- **引用校验**：`apps/api/src/application/context-pack/verify-citation.ts` 存在（已核实）；它能否校验 S063 的 `findingId` 命名空间：**UNVERIFIED**。
- **可视化**：`apps/api/src/application/canvas/`、`whiteboard/` 两个目录存在。把树渲染到画布上属于调用方另外发起的工具动作，S065 自己不写。**proposed-unwired**。

## 13. 决策
- **决策 1：S065 只比较兄弟节点，不做全树的全局排序。** 不同层、不同父节点下的机会粒度不同，放在一起排序没有意义；上游的做法也是在同一层内比较、选定之后再往下走。因此输出是一条 `targetPath`，而不是一张排名表。
- **决策 2：机会层不用 RICE / ICE，只用四维有序档加支配关系。** RICE 要求 Reach 是绝对数量、Confidence 是百分比（roadmap-update :139–147），而 W027/W028 的证据是 5–15 人的访谈，填出来的数只会是虚构的精度。支配关系只在「全面不差」时下结论，其余情况都交给人判断。RICE 类框架留给 S068，在解法和 backlog 层使用；W029 把 S065 → S068 串起来，正好对应这个分工。
- **决策 3：S065 不生成解法。** 上游要求每个机会有多个解法，但生成解法是 S066 的职责。S065 只挂载 S061 透传的候选、用户给出的方案、以及 B1 重新归类出来的解法，并如实标出 `solutionCoverage`。缺口通过 §14 提议 1 解决，而不是让 S065 越界。
- **决策 4：provisional 证据把 `evidenceStrength` 封顶在「中」。** 这和 S063 决策 6、S061 决策 4 是同一条规则在机会层的体现：没经过 S171 复核的证据不能支撑「高」。这样 W027 的建议目标天然带着「待复核」的限制，而 W028（有 S171）可以给到「高」。
- **决策 5：建议目标和确认目标分开。** S065 最多输出到 `proposed`；`accepted` 只能由人工关卡写。修订时，被新证据降级的已确认目标只会触发 `needs-choice`。原因：目标机会决定了后面整个 PRD（W029 中的 S067），换目标是一个产品判断，属于 D003 或人类，而不是模型。

## 14. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **W027 / W029 缺少解法生成环节。** 这两条 Workflow 中，S065 之前都没有 S066，所以机会下的解法只能来自 S061 的 `candidateSolutions` 或用户。这与已 PASS 的 S066 §14 提议 1 一致；建议 W027 的作者同时评估 W029 是否也需要 S066。
2. **W028 缺少 S064。** W028 以 S065 结尾，但行里没有 S064，根只能由调用方的 `outcome` 给出，容易走到 `unanchored`。建议 W028 的作者评估：要么在 S171 之后加 S064，要么在 Workflow 的 trigger schema 里把 `outcome` 设为必填。
3. **D011 gap「Persona/Journey facilitation」。** S065 的 A3 只消费旅程步骤，或者给出一份 inferred 草稿，不负责引导画旅程。本文不认领这个 gap。
4. **S068 与 S065 的交接。** 建议 S068 的作者声明是否接受 `handoff.S068.solutionIds` 作为输入范围。如果不接受，由 W029 的作者在阶段之间做适配。

## 15. 未决问题
- `knowledge.read`、`sandbox.exec` 在 ADR-120 目录中的登记状态（UNVERIFIED）。
- `workflowAllowlist` 在 baseline 上没有实现（grep 无命中）。它的落地归属哪个 feature 尚未确定。
- A3 从 Finding 推断旅程骨架时，中文动作阶段的抽取质量需要单独的夹具集来评估。
- S169 Knowledge Synthesis 的产物能否作为 W028 中 S065 的证据来源，要等 S169 的文档 PASS 后再决定。在那之前按 I3，只接受 S063 的产物。
