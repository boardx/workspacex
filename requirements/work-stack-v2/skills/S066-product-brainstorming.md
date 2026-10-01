# S066 — Product Brainstorming（产品头脑风暴）

> Type: Work Skill · Domain: Product & Design · Strategy: A1（一个主源 adapt + 一个参考源）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文独立作者化（AUTHOR-S066）；v1 `S066-product-brainstorming.md` 只用作话题清单，正文未沿用。
> 凡是引用 WorkspaceX 现有代码的地方，都已在 baseline 上读过文件；没有读过的标 **UNVERIFIED**，尚不存在或尚未接线的能力标 **proposed-unwired**。

## 1. 这个 Skill 解决什么问题
S066 在**问题已经框定**之后、**机会排序与实验设计**之前工作。它有两项任务：
- 把一个问题陈述展开成一组**彼此真正不同**的解法想法；
- 在收敛时，只留下**不超过 3 个**值得继续推进的方向。每个方向都写明它最危险的假设，以及验证这个假设最便宜的办法。

它产出的是一份 `BrainstormSession` 记录，**不是决策**，也不是排好序的 backlog。

S066 **不做**的事（各有唯一归属）：
| 不做 | 归谁 |
|---|---|
| 从原始材料提炼用户洞察 | S063 Research Synthesis（S066 只引用 S063 的 `findingId`） |
| 写问题陈述、定成功标准 | S064 Problem Framing |
| 画机会树并给机会排序 | S065 Opportunity Mapping |
| 设计实验（样本量、指标、停止规则） | S071 Experiment Design（S066 只给出「最便宜的验证方式」这一条线索） |
| 评审已有设计稿 | S075 Design Critique |

S066 的核心风险是两种走偏：
- **过早收敛**：只想出一个点子就开始评估；
- **无根发散**：点子和任何证据都挂不上钩，却被写得像用户需求。

§4 的方法和 §6 的结构就是围绕这两点设计的。

## 2. 图上的消费者（逐条从矩阵读出，不推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
**无。** S066 没有出现在任何 Workflow 行里。与它相邻的产品类 Workflow 实际只列了下面这些 Skill，都不含 S066：
- W027：S061, S062, S009, S063, S064, S065
- W028：S062, S009, S063, S169, S171, S065
- W029：S064, S065, S067, S068, S162
- W031：S071, S072, S157, S161, S074

是否应该给 S066 加边，见 §14 的提议。本文**不假定**这些提议会被采纳。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md）
| DigitalHuman | 矩阵行 | 该行 Workflow | 该行 Skill 列 | 该行 gaps 列 |
|---|---|---|---|---|
| D011 Design Thinking Expert（设计思维专家） | 第 17 行 | W027, W028, W029, W031, W002 | S062, S009, S064, S065, **S066**, S071, S063, S075, S018 | 「Persona/Journey facilitation; HMW framing; Prototype planning」 |

按 ADR-118 决策 9（已读 `docs/adr/ADR-118-generic-workflow-runtime.md:26`），DigitalHuman 行的 Skill 列只列「直接调用」的 Skill。因此 S066 的唯一消费场景是：**D011 在对话中直接调用**。D011 运行 W027 等 Workflow 时，不会经由 Workflow 调用到 S066，因为这些 Workflow 都没有固定 S066 的版本。

D011 行的 gaps 列里有一项「HMW framing」。S066 在 §4 的 B2 步**会产出** HMW 问句，但这只是发散阶段的入口，不是完整的「HMW framing」能力。原因是：HMW 问句的边界（是否太宽、是否已经是解法）取决于问题陈述，而问题陈述归 S064。所以本文**不声称 S066 填补了这个 gap**，gap 的归属见 §14 的提议 3。

## 3. 上游来源与许可（G1）
| 仓库 | 路径 | SHA | 许可（artifact 级） | 处理方式 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `product-management/skills/product-brainstorming/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7`（该路径最后一次提交也是这个 SHA） | Apache-2.0（`product-management/LICENSE`） | **adapt**。采用：五段节奏 Frame→Diverge→Provoke→Converge→Capture（:184-239）；「先出 5–7 个不同方向再评估」（:38）；解法变化的三个维度 scope / approach / timing（:39）；必须包含一个「反着做」和一个「删掉而不是加上」的选项（:40-41）；每个保留方向都要写出最大未知项和最便宜的验证方式（:229）；反模式清单（:264-276）。**不采用**：「Brainstorming is a conversation, not a deliverable」（:256）。原因见决策 1，WorkspaceX 需要一份可审计的留档。**也不采用** OODA 与 Strategy Exploration 两段（:70-79、:156-171），这两段属于战略层，超出 D011 的职责。 |
| RefoundAI/lenny-skills | `skills/idea-validation/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`，Copyright (c) 2025 Refound AI） | **reference-only**。只借用一点：区分「礼貌性兴趣」和「真实拉力」。这一点用在 C3 步「最便宜验证」的信号类型上。不复制文中的播客引语。 |

- 按 Apache-2.0 §4(b)(c)，NOTICE 和改动说明写在 SKILL.md 的 `references/upstream.md` 里，不复制上游段落。本文列出的上游要点都已用中文重述。
- 单一 adapt 源的理由：目前只找到一个在方法层完整、许可明确的头脑风暴 SKILL 源。lenny-skills 那份只覆盖收敛之后的验证环节，因此只作参考。

## 4. 专业方法（S066 专属步骤）
下面分四个阶段：A 框定检查、B 发散、C 挑衅与收敛、D 留档。每一步都对应 §6 的一个字段，并有 §10 的一条失败模式守着。

### A. 框定检查（不替 S064 写框定）
- **A1 读入框定。** 输入要么带 S064 产出的问题陈述，要么由调用方直接给一句 `problemStatement`。Skill 不改写这句话，只检查三件事：
  - 有没有指明受影响的人；
  - 有没有描述可观察的困境；
  - 这句话是不是**已经写成了一个解法**。检测规则：陈述里出现「做一个 / 加一个 / 上线」这类构建动词，并且带有具体功能名词。

  如果它已经是解法，Skill 不继续发散，返回 `framing.status = "solution-in-disguise"`，同时把识别出来的隐含问题列出来，交还给用户或 S064 重新确认。这是上游「Solutioning before framing」（:264）落到可检测层面的规则。
- **A2 证据挂载。** 如果输入带了 S063 `ResearchSynthesis` 的引用，就把其中 `kind ∈ {claim, theme}` 的 Finding 读成 `groundingPool`。每条保留原 `findingId`、`confidence` 和 `assertionCeiling`（字段名取自 `skills/S063-research-synthesis.md` §6，该文档已 PASS）。没有证据时 `groundingPool = []`，此后所有想法都只能是 `speculative`（决策 3）。
- **A3 约束分层。** 把调用方给出的约束分成两类：
  - `hard`：法规、合同、已签承诺；
  - `soft`：预算、排期、技术现状。

  在发散阶段只执行 `hard` 约束；`soft` 约束到收敛阶段才启用（决策 2）。

### B. 发散
- **B1 定配额。** 目标是至少 `minIdeas` 个想法（默认 8，最少 6），并且必须覆盖下面四条轴：
  - `scope`：微调 / 大赌注；
  - `approach`：产品 / 流程 / 政策或规则；
  - `timing`：快赢 / 长期；
  - `valence`：加法 / 减法 / 反向。

  另外有两条必须满足的条件：至少 1 个 `valence = subtract` 的想法，至少 1 个 `valence = invert` 的想法。
- **B2 HMW 起手。** 从问题陈述生成 3–6 条「我们可以如何…」（en-US 用 "How might we…"）问句。每条问句都要同时通过两项检查：
  - 不含具体功能名词。含了说明太窄，已经是解法；
  - 包含受影响人群，以及一个可观察的结果。缺了说明太宽。

  两项检查的结果写进 `hmw[].check`，不通过的问句不能作为想法的来源。
- **B3 技法轮转。** 每个想法都要标明它来自哪种技法：`hmw | analogy | inversion | decomposition | hat-switch | scamper:<S|C|A|M|P|E|R> | reverse-brainstorm | user-supplied`。同一种技法产出的想法不能超过总数的 50%。这条规则用来防止想法看起来多样，其实都是同一种思路的变体。
- **B4 去重。** 两个想法如果「作用对象 + 机制」相同，就合并为一个，并在 `mergedFrom` 里保留原 id。去重后如果数量低于配额，回到 B3 继续发散。连续两轮补不上，就如实报告 `divergence.shortfall`，不虚报数量。
- **B5 接地标注。** 每个想法都要标注 `grounding`：
  - `evidence`：想法依附 `groundingPool` 里的某条 Finding，并记录该 Finding 的 id；
  - `speculative`：没有依附任何证据。

  标为 `evidence` 的想法，描述里的措辞强度不能超过对应 Finding 的 `assertionCeiling`。例如某 Finding 的上限是 `hypothesis-only`，想法描述里就不能写「用户需要」。

### C. 挑衅与收敛
- **C1 挑衅。** 对候选方向各做一次「最强反方论证」，结果写成 `provocations[]`，每条标明针对哪个 `ideaId`，类型限定为 `who-hates-it | opposite-true | 10x | what-we-miss`。挑衅**不删**任何想法。
- **C2 聚类收敛。** 先把想法按「服务的用户结果」聚成主题，然后启用 `soft` 约束，保留不超过 3 个 `shortlist` 方向。

  每个方向写出 `whyInteresting`，这是一段定性理由。**不打分、不排序**（决策 4）。

  用户明确偏好的方向，即使风险高也必须进入 shortlist，并标 `userChampioned: true`（对应上游 :227「不靠委员会扼杀」）。
- **C3 最危险假设与最便宜验证。** 每个 shortlist 方向必须写出以下内容：
  - 一条 `riskiestAssumption`，并标出它属于 `user | problem | solution | business | feasibility | adoption` 中哪一类；
  - 一条 `cheapestTest`，形式限定为 `fake-door | concierge | wizard-of-oz | paper-prototype | data-pull | 5-interviews | desk-research`；
  - 预期的信号类型，限定为 `commitment`（付费、预约、高投入使用）或 `stated-interest`。

  如果选的是 `stated-interest`，必须同时标出 `weakSignal: true`。这一条来自 lenny-skills 的参考。

  C3 **不设计实验细节**，只填写 `handoff.to = "S071"` 需要的最少字段。
- **C4 停机。** 如果发散持续打转，而原因是「没人知道答案」，就停止头脑风暴，把缺失的知识写入 `researchQuestions[]`，交给 S062 或 S009。对应上游反模式「Brainstorming when you should be researching」（:276）。

### D. 留档
- **D1** 被搁置的想法全部写入 `parked[]`，每条带搁置理由，不静默丢弃。
- **D2** 输出只以草稿形式返回对话。写入白板、画布或 Artifact 属于调用方另行发起的工具动作，S066 本身没有写权限（§7）。

## 5. 输入契约（`inputSchema`）
```ts
BrainstormInput = {
  problemStatement: string;                 // 1–500 字；来自 S064 或用户
  problemFramingRef?: { skill: "S064"; artifactId: string };        // 有则优先，服务端读取版本
  groundingRefs?: Array<{ skill: "S063"; synthesisId: string }>;    // 0–5 个
  constraints?: Array<{ text: string; kind: "hard" | "soft"; source?: string }>;  // ≤20
  seedIdeas?: string[];                     // 用户已有想法，≤10；进入池子时 technique="user-supplied"
  mode?: "full" | "diverge-only" | "stress-test";   // stress-test：只对 seedIdeas 走 C1+C3
  minIdeas?: number;                        // 6–20，默认 8
  locale: "zh-CN" | "en-US";
  market?: "CN" | "US" | "global";          // 影响 §9 的约束提示，默认随 locale
}
```
不变式：
- `mode = "stress-test"` 时要求 `seedIdeas.length ≥ 1`；
- `problemFramingRef` 和 `problemStatement` 同时出现时，以服务端读到的 S064 版本为准，并在输出里标出两者的差异。

## 6. 输出契约（`outputSchema`，S066 专属）
```ts
BrainstormSession = {
  sessionId: string; locale: Locale; mode: Mode;
  framing: { statement: string; status: "ok" | "solution-in-disguise" | "too-broad";
             impliedProblems?: string[];       // solution-in-disguise 必填
             hardConstraints: string[]; softConstraints: string[] };
  hmw: Array<{ hmwId: string; text: string; check: { hasActor: boolean; hasOutcome: boolean; notSolution: boolean } }>;
  ideas: Array<{
    ideaId: string;                            // "I1".. 稳定
    title: string;                             // ≤40 字
    mechanism: string;                         // 作用对象 + 如何起作用，≤200 字
    technique: Technique; fromHmwId?: string;
    axes: { scope: "tweak" | "bet"; approach: "product" | "process" | "policy";
            timing: "quick" | "long"; valence: "add" | "subtract" | "invert" };
    grounding: { kind: "evidence"; findingIds: string[]; ceiling: AssertionCeiling }
             | { kind: "speculative" };
    hardConstraintConflict?: string;           // 与 hard 约束冲突时必填，且该 idea 不得进 shortlist
    mergedFrom?: string[];
    author: { kind: "agent" } | { kind: "user"; userId: string };   // userId 由服务端写入（§8）
  }>;
  divergence: { count: number; axisCoverage: Record<Axis, string[]>; techniqueShare: Record<Technique, number>;
                hasSubtract: boolean; hasInvert: boolean; shortfall?: { target: number; reached: number } };
  provocations: Array<{ ideaId: string; kind: ProvocationKind; text: string }>;
  shortlist: Array<{                            // 0–3；diverge-only 恒为 []
    ideaIds: string[]; theme: string; whyInteresting: string; userChampioned: boolean;
    riskiestAssumption: { text: string; category: AssumptionCategory };
    cheapestTest: { form: TestForm; signal: "commitment" | "stated-interest"; weakSignal: boolean };
    handoff: { to: "S071"; hypothesis: string };
  }>;
  parked: Array<{ ideaId: string; reason: "soft-constraint" | "duplicate-theme" | "hard-constraint" | "user-deferred" }>;
  researchQuestions: Array<{ text: string; suggestTo: "S062" | "S009" }>;
}
```
不变式（由 `scripts/check-session.mjs` 机械核对，proposed-unwired，见 §12）：
1. 所有 `ideaId` 都恰好出现在以下四处之一：shortlist、parked、`mergedFrom`、或仍留在池中（`diverge-only` 模式）。
2. `grounding.kind = "evidence"` 时，`findingIds` 里的每个 id 都必须存在于服务端读到的 S063 synthesis 中。
3. `divergence.count` 必须等于去重后的 ideas 数量。未满足 `minIdeas` 时，`shortfall` 必填。
4. `mode ≠ diverge-only` 时，必须满足：`hasSubtract ∧ hasInvert`，且任一技法的占比不超过 0.5。否则返回错误 `DIVERGENCE_INCOMPLETE`，不得产出 shortlist。
5. `shortlist` 里不得出现带 `hardConstraintConflict` 的想法。
6. 刻意**不设** `score`、`rank`、`priority`、`recommendation` 字段（决策 4）。

类型化错误：

| 错误码 | 触发条件 |
|---|---|
| `INPUT_INVALID` | schema 违例 |
| `FRAMING_REF_NOT_FOUND` / `GROUNDING_REF_NOT_FOUND` | 引用不存在，或服务端判定对调用方不可见（两种情况返回同一个码，避免泄露资源是否存在） |
| `GROUNDING_ACCESS_DENIED` | 引用存在，但调用方没有 `knowledge.read` 权限，并且该资源的存在已经对调用方可见（例如出现在同一对话的上文中） |
| `DIVERGENCE_INCOMPLETE` | 违反不变式 4 |
| `STRESS_TEST_NO_SEED` | `stress-test` 模式下没有 `seedIdeas` |

`framing.status = "solution-in-disguise"` 不算错误，而是一个正常返回。此时 `ideas = []`，`shortlist = []`。

## 7. 依赖（能力分类，ADR-120）
- **required**：无。只做纯推理。
- **conditional**：`knowledge.read`，只在带 `groundingRefs` 或 `problemFramingRef` 时，用来读取对应版本。
  - 这个分类名是否已经在 ADR-120 的目录里登记：**UNVERIFIED**。
  - S063 文档 §7 称尚未登记。
- **optional**：`sandbox.exec`，用来运行 `scripts/check-session.mjs`。沙箱应用 `apps/skill-sandbox/` 已存在（已读目录）；这个脚本本身是 proposed-unwired。
- 无写能力，riskClass = low。

## 8. 授权边界（调用方声明 vs 服务端核实）
| 项 | 调用方可以声明 | 服务端必须核实 |
|---|---|---|
| 是否允许调用 S066 | — | 当前 Agent 的已发布版本是否在 `agent_versions.skill_version_ids` 里固定了 S066。该字段在 `packages/contracts/src/identity.ts:363,430` 的注释里已核实存在；pin 的写入路径是 `apps/api/src/application/agent-skill-pins/set-agent-skill-pins.ts`（已核实文件存在）。运行时在调用前按 pin 做拦截的具体代码位置：**UNVERIFIED**。 |
| `groundingRefs` / `problemFramingRef` | 给出 id | 按调用者身份和组织读取对应版本。能不能读，只看服务端的读权限，**不信**调用方传入的 synthesis 正文。 |
| `seedIdeas` 的作者 | 不可声明 | `author.userId` 取自会话的认证主体。多人共创场景下（白板上多人同时贴想法）按参与者分别署名，这是 **proposed-unwired**：`apps/api/src/application/whiteboard/` 已存在，但与 S066 之间没有接线。 |
| 约束的 `kind` | 可以声明 hard 或 soft | 服务端不核实约束内容的真伪，只保证 `hard` 约束在发散阶段被执行。把 soft 约束谎报成 hard，后果只是想法变少，不构成越权。 |

## 9. CN / US 差异（实质性的部分）
- **HMW 句式。** zh-CN 固定用「我们可以如何…」。不用「如何才能…」，因为后者容易被写成要求而不是开放问句。B2 的检查按各自语言的句式分别实现。
- **类比来源。** B3 的 `analogy` 技法在 `market = CN` 时，允许引用小程序、超级 App 内的服务分发、私域社群等国内常见模式；`US` 时不预设这些模式。两种情况下都**不得**把类比写成「竞品已经有，所以我们也要有」（§10 F4）。
- **硬约束提示。** `market` 会影响 A3 在约束为空时给出的**提示**（只提示，不自动加入约束）。
  - CN：个人信息出境、算法推荐的备案与关闭选项、未成年人模式；
  - US：FTC 对暗黑模式的执法关注、COPPA（面向 13 岁以下用户）、各州隐私法。
  - 提示文本不构成法律意见，法律判断需要交给法务类 Skill（例如 D009 所挂载的那些）。
- **群体动态。** zh-CN 会话默认把 `seedIdeas` 在输出中匿名化为 `author.kind = "user"`，但不在正文中显示姓名，以减少层级对发言的压制；en-US 默认显示作者。这是一个展示层默认值，服务端仍然保存 `userId`。

## 10. 失败模式（S066 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 过早收敛：第 2 个想法之后就开始讨论可行性 | 发散阶段出现对 soft 约束的引用 | 删除该评价，退回 B3 |
| F2 | 伪多样：8 个想法都是「加一个提醒」的变体 | 同一技法占比 > 0.5，或「作用对象 + 机制」重复 | 按 B4 合并，再补足配额 |
| F3 | 无根想法冒充需求 | `speculative` 的想法描述里出现「用户需要 / 用户反馈」 | 改写措辞，或者挂上对应 Finding |
| F4 | 竞品对齐陷阱 | 某想法的理由只有「竞品 X 有」 | 追问该功能服务于哪个用户结果；答不上来就移入 parked |
| F5 | 以头脑风暴代替研究 | 连续两轮，候选方向都依赖同一个未知事实 | 按 C4 停机，写入 researchQuestions |
| F6 | 偷偷排序 | 输出里出现数字评分或「首选」字样 | schema 拒绝输出；措辞检查拦截 |
| F7 | 一人独奏：用户只带着一个方案来 | `seedIdeas` 只有 1 个且 `mode = full` | 保留这个方案，另外至少补 5 个方向不同的想法 |

## 11. 评测（`evals/work-stack/S066/`，ADR-119；夹具均为合成数据）
| # | 输入 | 通过标准 |
|---|---|---|
| E1 | problemStatement = 「给审批页加一个一键催办按钮」 | `framing.status = solution-in-disguise`；`impliedProblems` 里含「审批等待时间长 / 审批人不知道有待办」这类问题；`ideas = []` |
| E2 | 「新成员入职首周找不到团队文档」，无证据，minIdeas = 8 | `count ≥ 8`；`hasSubtract` 与 `hasInvert` 均为 true；所有想法 `grounding = speculative`；描述里没有出现「用户需要」 |
| E3 | 同 E2，外加一份 S063 synthesis，其中 F2 为 theme、`assertionCeiling = hypothesis-only` | 挂在 F2 上的想法，措辞不超过「可能 / 假设」；`findingIds` 都能在该 synthesis 中解析到 |
| E4 | `groundingRefs` 指向另一个组织的 synthesis | 返回 `GROUNDING_REF_NOT_FOUND`，并且没有任何 Finding 文本泄露到输出 |
| E5 | hard 约束 =「不得收集员工位置数据」，另注入一个「基于定位自动签到」的 seedIdea | 该想法带 `hardConstraintConflict`，进入 `parked(hard-constraint)`，不在 shortlist |
| E6 | 用户说「我就是喜欢方案 I4，虽然很冒险」 | I4 所在主题进入 shortlist 且 `userChampioned = true`；它的 `riskiestAssumption` 非空 |
| E7 | 一个 seedIdea，`mode = stress-test` | 只有 provocations 和 shortlist；每个 shortlist 项都有 `cheapestTest.form`，且 `handoff.to = S071`；输出中没有 `score` 字段 |
| E8 | 「提高试用转付费」，所有候选方向都依赖「用户是否愿意按席位付费」这个未知事实 | 输出 `researchQuestions` 非空，且 `suggestTo ∈ {S062, S009}`；`cheapestTest.signal` 如果是 `stated-interest`，则 `weakSignal = true` |
| E9 | 故意诱导：10 个想法都用 SCAMPER-M 生成 | 返回 `DIVERGENCE_INCOMPLETE`，或者补足配额后技法占比 ≤ 0.5 |
| E10 | zh-CN，`market = CN`，约束为空，主题涉及内容推荐 | A3 的提示里含算法推荐关闭选项；`hmw[].text` 以「我们可以如何」开头；硬约束列表保持为空（只提示，不自动加入） |

打分方式：
- 不变式 1–6 与 E1、E4、E5、E9 由脚本判定；
- E3、E6、E8 的措辞部分由 LLM-judge 配合逐条 rubric 判定，在 G5 前需要人工抽检 20%。

## 12. WorkspaceX 落位
- **Skill 包：** 新建 `skills/standard-methods/product-brainstorming/SKILL.md`。`skills/standard-methods/` 目录已存在（已读 README，目前含 interview-synthesis、user-research-planning、maau-canvas）。元数据按 ADR-117 写入 frontmatter。**proposed-unwired**：该包尚不存在，也需要重新运行 `skills/standard-methods/scripts/build.ts` / `verify.ts`。
- **机械检查：** `scripts/check-session.mjs`（不变式 1–6），在 `apps/skill-sandbox` 内执行。**proposed-unwired**。
- **读取 S063：** 复用 S063 §6 的 `ResearchSynthesis` 类型，不另定义类型。引用校验的现有代码是 `apps/api/src/application/context-pack/verify-citation.ts`（已核实文件存在）；它能否校验 S063 的 `findingId` 这个命名空间：**UNVERIFIED**。
- **白板或画布落地：** `apps/api/src/application/whiteboard/`、`canvas/` 目录存在。S066 会话写入白板属于调用方的独立工具动作，**proposed-unwired**。

## 13. 决策
- **决策 1：S066 产出结构化留档，而不是只有一段对话。** 上游明确说「brainstorming 是对话，不是交付物」。但 WorkspaceX 需要两样东西：让 S071 和 S065 能接手，以及能审计哪些想法有证据支撑。因此对话节奏保留，结尾必须输出 `BrainstormSession`。对话里的挑衅照常进行，只是结果要落到 `provocations[]` 中。
- **决策 2：约束分成 hard 和 soft，soft 约束推迟到收敛阶段。** 上游的做法是「发散时搁置所有约束」。但在 WorkspaceX 的企业场景里，违反法规或合同的想法哪怕只是被列出来，也可能被下游当成候选方向。所以 hard 约束从头执行，soft 约束按上游的做法推迟。
- **决策 3：「接地」是一个二值标签，措辞继承 S063 的上限。** S066 不重新评估证据强度，也不引入新的置信度等级。这样可以避免和 S063 / S171 形成第二个事实源（这正是 AGENTS.md「同一事实不得声明在两处」所说的问题）。
- **决策 4：收敛不打分、不排序，最多保留 3 个方向。** 机会排序是 S065 的唯一职责。S066 如果输出分数，下游就会把头脑风暴当成决策（上游 :260 也反对这样做）。shortlist 的上限 3 取自上游 :228。
- **决策 5：多样性是可以机械检查的门，而不是一句提示语。** 轴覆盖、减法和反向想法的存在、技法占比 ≤ 0.5，这三项都由脚本判定，所以「发散够不够」可以单独评测（E2、E9）。

## 14. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **W027 Discovery-to-Opportunity：** 考虑在 S064 和 S065 之间插入 S066。理由：W027 从问题框定直接跳到机会排序，中间缺少生成解法的阶段；但 S065 的机会树需要「每个机会多个解法」。是否需要这一步，由 W027 的作者决定。
2. **D003 Product Manager：** 当前 Skill 列不含 S066，而上游来源本身就是面向 PM 的。建议评估是否给 D003 增加 S066 作为 conditional Skill。
3. **D011 gaps 列中的「HMW framing」：** S066 的 B2 只覆盖发散入口。建议 gap 的归属由 D011 / S064 的作者裁决：要么扩展 S064，要么新建 Skill。本文不认领这个 gap。

## 15. 未决问题
- `knowledge.read`、`sandbox.exec` 是否已经在 ADR-120 的目录里登记（UNVERIFIED）。
- 多人共创场景下按参与者署名，需要 whiteboard 与 Skill 输出之间的接线。归属哪个 feature 尚未确定。
- `solution-in-disguise` 的检测目前靠动词加名词的规则，中文的误报率需要在 E1 系列扩充夹具后再做评估。
