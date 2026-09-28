# S064 — Problem Framing（问题框定）

> Type: Work Skill · Domain: Product & Design · Strategy: A1（一个主源 adapt，一个参考源）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文是 AUTHOR-S064 的独立作者化产物。v1 的 `S064-problem-framing.md` 只当作话题清单使用，正文没有沿用。
> 凡是提到 WorkspaceX 现有代码的地方，都已在 baseline 上读过对应文件。没有读过的标 **UNVERIFIED**；尚不存在或尚未接线的能力标 **proposed-unwired**。

## 1. 这个 Skill 解决什么问题
S064 接收一个模糊的输入，产出一份**与解法无关、有边界、可证伪**的问题框定 `ProblemFrame`。模糊输入包括：一句抱怨、一个功能请求、一个指标下滑，或者一份 S063 综合。

框定有三个下游消费者：
- S065 Opportunity Mapping 以它为机会树的根；
- S066 Product Brainstorming 以它为发散的起点；
- S067 PRD / Spec Writing 把它作为 PRD 的 Problem 节。

S064 的核心风险有三种：
- **解法伪装成问题**：「我们需要一个催办按钮」；
- **问题太宽，无法证伪**：「提升用户体验」；
- **证据被夸大**：把一条访谈写成「用户普遍反映」。

S064 **不做**的事，各有唯一归属：
| 不做 | 归谁 |
|---|---|
| 从原始材料提炼洞察、计算置信度 | S063 Research Synthesis（S064 只引用它的 `findingId` 和 `assertionCeiling`） |
| 生成解法想法 | S066 Product Brainstorming |
| 把问题展开成机会树并排序 | S065 Opportunity Mapping |
| 设计指标的口径、埋点和目标值 | S162 KPI Design（S064 只写「可观察的结果信号」，不写公式和目标数字） |
| 在多个框定之间做取舍排序 | S068 Prioritization |
| 写 PRD 全文 | S067 PRD / Spec Writing |

## 2. 图上的消费者（逐条从矩阵读出，不推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行 | 该行 Exact Skills |
|---|---|---|
| W027 Discovery-to-Opportunity | 第 33 行 | S061, S062, S009, S063, **S064**, S065 |
| W029 Problem-to-PRD | 第 35 行 | **S064**, S065, S067, S068, S162 |

按 ADR-118 决策 9（已读 `docs/adr/ADR-118-generic-workflow-runtime.md`「补充决策」第 9 条），这两个 Workflow 固定 S064 的版本。运行它们的 Agent 不需要另外挂载 S064。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md，直接调用）
| DigitalHuman | 矩阵行 | 该行 Workflow | 该行 Skill 列 | gaps 列 |
|---|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | S061, S009, **S064**, S065, S067, S068, S069, S070, S071, S072, S073, S074, S008, S075 | — |
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | S062, S009, **S064**, S065, S066, S071, S063, S075, S018 | Persona/Journey facilitation; HMW framing; Prototype planning |

关于 D011 gaps 列中的「HMW framing」：S064 产出的是问题陈述及其边界，**不产出** HMW 问句。HMW 句式的生成与检查目前落在已 PASS 的 S066 §4 B2 步。本文**不认领**这个 gap，处理意见见 §14 提议 2。

## 3. 上游来源与许可（G1）
| 仓库 | 路径 | SHA | 许可（artifact 级） | 处理方式 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `product-management/skills/write-spec/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7`（本地克隆 `scratchpad/upstream/knowledge-work-plugins` 的 HEAD） | Apache-2.0（`product-management/LICENSE`） | **adapt，只取 Problem Statement 一节**。采用的要点：<br>• 陈述写 2–3 句，说明谁受影响、发生频率、不解决的代价（:61、:79-83）；<br>• 要求挂证据（:83）；<br>• 接受四种入口形态：功能名、问题陈述、用户请求、模糊想法（:23-27）。这是 A0 入口分类的来源。<br>不采用 Goals / User Stories / P0-P2 等 PRD 节，这些归 S067 与 S162。 |
| RefoundAI/lenny-skills | `skills/writing-prds/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`，Copyright (c) 2025 Refound AI） | **reference-only**。借用的观点：<br>• 问题陈述应与解法无关（:14）；<br>• 陈述放在文档顶部，用来统一团队注意力（:31-34）；<br>• 「过早高保真」「忽略 non-goals」两个反模式（:81-82）。<br>不复制播客引语。文中提到的外部文章「Five Attributes of a Strong Problem Statement」（:63）不在仓内，许可未知，只作为话题线索，不采纳其中内容。 |

- 按 Apache-2.0 §4(b)(c)，NOTICE 和改动说明写在 SKILL.md 的 `references/upstream.md` 中。本文列出的上游要点都已用中文重述。
- 只有一个 adapt 源的理由：已克隆的上游里，没有独立的「problem framing」SKILL；write-spec 的 Problem 节是唯一在方法层写明、许可也明确的来源。四个 A 段、「负空间」和「证伪条件」等方法（§4）是 WorkspaceX 自己的设计，不归属上游。

## 4. 专业方法（S064 专属步骤）
### A. 入口识别
- **A0 入口分类。** 把输入归入以下五类之一：`feature-request | complaint | metric-signal | synthesis | vague-idea`。
  - `feature-request` 的判定：出现「做 / 加 / 上线 / 支持」这类构建动词，同时带有具体功能名词。
  - 分类结果写进 `intake.kind`。
  - 每类有不同的 A1 策略。
- **A1 解法剥离（针对 feature-request）。** 不拒绝请求，而是反推出它背后的 1–3 个候选问题，写进 `strippedSolution = { original, impliedProblems[] }`。
  - 原请求保留在 `strippedSolution.original`，它**不得**出现在 `statement` 中。
  - 例：「审批页加一键催办」→「审批发起人无法得知审批卡在谁手里」/「审批人不知道自己有待办」。
  - 如果能反推出多个问题，而输入里没有证据能区分它们，S064 不替用户挑选。此时返回 `status = "needs-choice"`，列出候选问题，由调用方或用户选定后再重入。见决策 2。

### B. 构造框定
- **B1 受影响者。** `actor` 必须是一个可识别的人群，由角色、情境、规模三部分组成，例如「月审批量 > 50 的部门主管」。不接受「用户」「大家」这类泛称。
- **B2 可观察困境。** `struggle` 用可观察的行为或结果来描述，例如「平均等待 3 天，期间反复私聊催问」，不能写成情绪或解法。
  - 每条困境描述标注 `grounding`：`evidence`（附 `findingIds`）或 `assumption`。
  - 标为 `evidence` 的，措辞不得超过对应 S063 Finding 的 `assertionCeiling`（字段取自已 PASS 的 S063 §6）。
- **B3 代价。** `costOfInaction` 从三个维度各写一句：用户侧、业务侧、合规或信任侧。无从判断的维度写 `unknown`，**不编造**。
- **B4 边界与负空间。** 写两份清单：
  - `inScope`：包含哪些人群、场景、渠道；
  - `outOfScope`：至少 2 条，每条附理由。

  负空间是 S064 区别于一句话陈述的关键，对应 lenny-skills :82「忽略 non-goals」这一反模式。
- **B5 结果信号与证伪条件。**
  - `outcomeSignals`：1–3 条可观察的变化方向，例如「发起人私聊催问次数下降」。**不写**目标数字、口径和公式，这些交给 S162。
  - `falsifiers`：至少 1 条，写明「如果观察到 X，说明这个问题不存在或不重要」。没有证伪条件的框定一律 `status = "too-broad"`。见决策 3。

### C. 压力测试
- **C1 宽窄检查。** 用两道判据检查陈述：
  - 太宽：`actor` 覆盖全部用户，**或** `falsifiers` 为空。
  - 太窄：`statement` 中含具体界面或功能名词。

  命中任一判据就回到 B 段修改，最多两轮。两轮后仍不通过的，如实返回 `too-broad` 或 `solution-in-disguise`。
- **C2 Five-Whys 上探一层。** 对 `struggle` 追问一次「为什么这会成为问题」，把更上一层的问题写进 `parentProblem`。这一层只用于提示框定层级，不替换当前陈述，由调用方决定是否上移。
- **C3 替代框定。** 至少给出 1 个 `alternativeFrames`，即对同一现象的另一种因果解释。例如：「催问多」可能是审批人不知道有待办，也可能是发起人不信任系统里显示的状态。

  每个替代框定写一条用来区分两者的 `discriminatingQuestion`，交给 S062 或 S009 去调研。
- **C4 未知项。** 所有 `assumption` 类型的困境描述、`unknown` 类型的代价，以及各个 `discriminatingQuestion`，汇总进 `openQuestions[]`，每条标出建议承接的 Skill（S062 或 S009）。

### D. 定稿
- **D1** `statement` 由 `actor + struggle + costOfInaction` 合成 2–3 句，并做两项检查：
  - 不含功能名词；
  - 措辞强度不超过所有引用 Finding 中最弱的那个 `assertionCeiling`。
- **D2** 输出一份草稿 `ProblemFrame`（`status = draft`）。在 Workflow 中，由 W027 或 W029 的人工关卡把它转为 `accepted`，S064 自身不做这个转换。写入文档或画布，属于调用方另行发起的工具动作。

## 5. 输入契约（`inputSchema`）
```ts
ProblemFramingInput = {
  rawInput: string;                                   // 1–2000 字：请求/抱怨/指标描述/想法
  synthesisRefs?: Array<{ skill: "S063"; synthesisId: string }>;   // 0–5
  metricContext?: { name: string; direction: "down" | "up" | "flat"; window: string; source?: string };  // 仅作描述，不做计算
  chosenProblemIndex?: number;                        // 仅用于重入：选择上一轮 needs-choice 的候选
  previousFrameId?: string;                           // 重入或修订时必填
  constraints?: Array<{ text: string; kind: "hard" | "soft" }>;    // ≤20，写进 inScope/outOfScope 的理由
  locale: "zh-CN" | "en-US";
  market?: "CN" | "US" | "global";
}
```
不变式：
- `chosenProblemIndex` 出现时，`previousFrameId` 必填，并且服务端读到的那一版 frame 的 `status` 必须为 `needs-choice`；
- `metricContext` 只用于描述现象，S064 不据此推断因果关系（见 F5）。

## 6. 输出契约（`outputSchema`，S064 专属）
```ts
ProblemFrame = {
  frameId: string; version: number;                   // 修订时 version+1，previousFrameId 链可追溯
  status: "draft" | "needs-choice" | "too-broad" | "solution-in-disguise";   // accepted 只由 Workflow 人工关卡写
  locale: Locale;
  intake: { kind: "feature-request" | "complaint" | "metric-signal" | "synthesis" | "vague-idea" };
  strippedSolution?: { original: string; impliedProblems: string[] };      // intake=feature-request 时必填
  actor: { role: string; situation: string; scale?: string };
  struggle: Array<{ text: string;
                    grounding: { kind: "evidence"; findingIds: string[]; ceiling: AssertionCeiling }
                             | { kind: "assumption" } }>;                 // ≥1
  costOfInaction: { user: string | "unknown"; business: string | "unknown"; trust: string | "unknown" };
  inScope: string[];                                  // ≥1
  outOfScope: Array<{ text: string; reason: string }>; // ≥2
  outcomeSignals: string[];                           // 1–3，禁止含数字目标
  falsifiers: string[];                               // ≥1（status=draft 时）
  parentProblem?: string;
  alternativeFrames: Array<{ text: string; discriminatingQuestion: string }>;  // ≥1（status=draft 时）
  statement: string;                                  // 2–3 句
  openQuestions: Array<{ text: string; suggestTo: "S062" | "S009" }>;
  handoff: { S065?: { rootProblem: string }; S066?: { problemStatement: string }; S067?: { problemSection: string } };
}
```
不变式由 `scripts/check-frame.mjs` 机械核对。该脚本是 proposed-unwired，见 §12。
1. `status = draft` 时，以下各项都必须满足：`falsifiers ≥ 1`，`alternativeFrames ≥ 1`，`outOfScope ≥ 2`，`struggle ≥ 1`。
2. `statement` 与 `strippedSolution.original` 之间不存在共享的功能名词；比对时使用同一套分词和停用词表。
3. `statement` 的措辞强度 ≤ min(所有被引用 Finding 的 `ceiling`)。凡是 `assumption` 类型的困境，在 `statement` 中只能以「可能 / 假设」的语气出现。
4. `outcomeSignals` 中不含数字、百分号或「达到」一类目标措辞。
5. 所有 `findingIds` 都能在服务端读到的 S063 synthesis 中解析出来。
6. `status ∈ {needs-choice, solution-in-disguise}` 时，`handoff` 必须为空对象。未框定好的问题不得流向下游。
7. 输出中**不设** `priority`、`score`、`solution`、`kpiTarget` 字段。

类型化错误：
| 错误码 | 触发条件 |
|---|---|
| `INPUT_INVALID` | schema 违例 |
| `SYNTHESIS_REF_NOT_FOUND` | 引用不存在，**或**服务端判定调用方不可见。两种情况返回同一个码，不泄露资源是否存在 |
| `PREVIOUS_FRAME_NOT_FOUND` | 同上，作用于 `previousFrameId` |
| `REENTRY_STATE_INVALID` | 带了 `chosenProblemIndex`，但上一版的 status 不是 `needs-choice`，或索引越界 |
| `FRAME_INCOMPLETE` | 两轮 C1 之后不变式 1 仍不满足，并且调用方要求 `draft`（W029 的阶段契约） |

`too-broad`、`needs-choice`、`solution-in-disguise` 都是**正常返回**，不是错误。

## 7. 依赖（能力分类，ADR-120）
- **required**：无。只做纯推理。
- **conditional**：`knowledge.read`，只在带有 `synthesisRefs` 或 `previousFrameId` 时，用来读取对应版本。这个分类名是否已经在 ADR-120 目录中登记：**UNVERIFIED**（S063、S066 两篇文档记录了同一个未决问题）。
- **optional**：`sandbox.exec`，用来运行 `scripts/check-frame.mjs`。`apps/skill-sandbox/` 目录的存在由已 PASS 的 S066 §7 记录，本文未重读，标 **UNVERIFIED**。
- 无写能力。riskClass = low。

## 8. 授权边界（调用方声明 vs 服务端核实）
| 项 | 调用方可声明 | 服务端必须核实 |
|---|---|---|
| 直接调用 S064（D003/D011 在聊天中调用） | — | 当前 Agent 的已发布版本是否在 `agent_versions.skill_version_ids` 中固定了 S064。pin 的写入路径 `apps/api/src/application/agent-skill-pins/` 已确认目录存在；运行时在哪里执行拦截：**UNVERIFIED** |
| 在 W027/W029 阶段内调用 | — | 该 Workflow 版本固定了 S064 的版本，并且 Agent 的 `workflowAllowlist` 包含该 Workflow 版本（ADR-118 决策 9）。allowlist 的实现代码：**UNVERIFIED** |
| `synthesisRefs` | 只给 id | 服务端按调用主体和组织读取对应版本。**不接受**调用方内联传入的 Finding 正文或 ceiling，`ceiling` 一律取服务端读到的值 |
| `previousFrameId` / 重入 | 只给 id | frame 属于同一组织，并且调用主体可读；`status = needs-choice` 由服务端读出，不信调用方的声明 |
| `status = accepted` | 不可声明 | 只能由 Workflow 的人工关卡回执写入。S064 输出里出现 accepted 视为 schema 违例 |
| `metricContext` | 可声明 | 不核实数值真伪。因此它只作描述，永远不能作为 `grounding = evidence` 的依据（决策 4） |

## 9. CN / US 差异（实质性的部分）
- **代价中的合规和信任维度。** `market = CN` 时，B3 的 `trust` 维度会提示考虑以下事项：个人信息处理的告知同意、算法推荐是否提供关闭选项、未成年人模式。`US` 时提示考虑：FTC 对暗黑模式的关注、COPPA、各州隐私法。这些都只是**提示**，不自动写进 costOfInaction，也不构成法律意见。
- **受影响者的粒度。** CN 的 B2B 场景中，购买者、管理员、使用者常常是三个不同的人；甚至「老板要求上线」本身也会成为一个入口。遇到这种情况，A1 会要求把 `actor` 落到具体的使用者，并把「决策者诉求」放进 `alternativeFrames`，而不是当作问题本身。US 场景默认不做这种拆分提示。
- **措辞。** zh-CN 的 `statement` 禁止使用「痛点」「赋能」「抓手」一类空词（lint 词表）；en-US 禁止使用 "seamless"、"delight" 等词。两份词表分开维护。

## 10. 失败模式（S064 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 解法伪装：statement 里带着功能名 | 不变式 2 | 执行 A1 剥离，得出 needs-choice 或 solution-in-disguise |
| F2 | 泛人群：actor 写成「用户」 | actor.role 命中泛称表 | 退回 B1 |
| F3 | 证据夸大：一条访谈被写成「普遍」 | 不变式 3 | 降低措辞，或改标为 assumption |
| F4 | 不可证伪 | falsifiers 为空 | 返回 status = too-broad |
| F5 | 指标即问题：「DAU 降了」直接被当成问题 | intake = metric-signal，且 struggle 里没有任何人的行为 | 要求写出「谁的什么行为变了」；如果写不出来，就进入 openQuestions |
| F6 | 单一因果：只给一种解释 | alternativeFrames 为空 | 退回 C3 |
| F7 | 越界写 KPI：outcomeSignals 带目标数字 | 不变式 4 | 删除数字，在 handoff 中提示交给 S162 |
| F8 | 替用户选问题：多个候选问题都没有证据区分，却被默默选了一个 | impliedProblems ≥ 2，没有 evidence，但 status = draft | 改为 needs-choice |

## 11. 评测（`evals/work-stack/S064/`，ADR-119，夹具均为合成数据）
| # | 输入 | 通过标准 |
|---|---|---|
| E1 | 「审批页加一个一键催办按钮」，无证据 | intake = feature-request；impliedProblems ≥ 2；status = needs-choice；statement 中不含「催办 / 按钮」；handoff = {} |
| E2 | 以 E1 的 previousFrameId 重入，chosenProblemIndex = 0 | status = draft；version = 2；满足不变式 1；statement 描述的是所选的那个问题 |
| E3 | 「提升用户体验」 | status = too-broad；actor 不是泛称，否则判失败；输出了 openQuestions |
| E4 | 「近 4 周试用转付费从 12% 降到 8%」，放在 metricContext 中，无 synthesis | intake = metric-signal；所有 struggle 的 grounding 都是 assumption；outcomeSignals 中没有数字；openQuestions 中至少有一条是追问「谁的什么行为变了」 |
| E5 | 附 S063 synthesis，其中 F3 为 claim，ceiling = hypothesis-only，内容是「部分主管在移动端找不到待办」 | 引用 F3 的 struggle，措辞 ≤ 假设；statement 不含「普遍 / 大多数」；findingIds 能解析 |
| E6 | synthesisRefs 指向其他组织的 synthesis | 返回 `SYNTHESIS_REF_NOT_FOUND`；输出中没有任何 Finding 文本 |
| E7 | 调用方内联传入 `{findingId:"F3", ceiling:"state"}`，企图抬高措辞上限 | schema 拒绝内联的 ceiling（INPUT_INVALID），或忽略它并使用服务端值 hypothesis-only |
| E8 | 以一个 status = draft 的 frame 作为 previousFrameId，同时带 chosenProblemIndex | 返回 `REENTRY_STATE_INVALID` |
| E9 | zh-CN，market = CN，输入「老板要求上线 AI 周报」 | A1 剥离出使用者问题；「管理者想看团队进展」进入 alternativeFrames；statement 中不含「AI 周报」和「赋能」；trust 维度的提示提到个人信息告知同意 |
| E10 | en-US，market = US，输入 "Parents complain kids get endless video recommendations" | actor 落到具体人群；trust 维度的提示提到 COPPA；falsifiers ≥ 1；outOfScope ≥ 2 且都带理由 |
| E11 | 输出里夹带 `kpiTarget: "留存+5%"` | schema 违例，被拒绝 |

打分方式：
- 不变式 1–7 与 E1、E2、E6、E7、E8、E11 由脚本判定；
- E3、E4、E5、E9、E10 的措辞和人群粒度部分，由 LLM-judge 配合逐条 rubric 判定，进入 G5 前人工抽检 20%。

## 12. WorkspaceX 落位
- **Skill 包：** 新建 `skills/standard-methods/problem-framing/SKILL.md`。`skills/standard-methods/` 目录已存在（已列出：interview-synthesis、maau-canvas、user-research-planning、scripts）。**proposed-unwired**：这个包尚不存在。
- **机械检查：** `scripts/check-frame.mjs`（不变式 1–7），另配两份 lint 词表（zh-CN / en-US）。**proposed-unwired**。
- **ProblemFrame 的持久化与版本链**（`frameId` / `version` / `previousFrameId`）：没有现成存储。暂时作为 Workflow 阶段产物，由 ADR-118 的通用运行时保存。其落点：**proposed-unwired**。
- **类型复用：** 复用 S063 §6 的 `ResearchSynthesis` 和 `AssertionCeiling` 类型，不另行定义。`apps/api/src/application/context-pack/` 目录存在（已列出）；它能否校验 S063 `findingId` 这个命名空间：**UNVERIFIED**。

## 13. 决策
- **决策 1：S064 只框定问题，不写 KPI 目标，也不给候选问题排序。** 上游 write-spec 把 Goals 和 Success Metrics 放在同一份文档里；在 W029 中它们分别归 S067 和 S162，排序归 S068。S064 如果写目标数字，就会出现第二个事实源。因此 S064 只输出「变化方向」（不变式 4、7）。
- **决策 2：候选问题无法用证据区分时，返回 needs-choice，由人选择，不由 Skill 选择。** 框定错了，下游的 S065/S066/S067 会全部建在错误的根上。「选哪个问题」是一个产品判断，属于 D003 或人工关卡。为此 S064 支持带 `previousFrameId` 的重入（E1→E2）。
- **决策 3：证伪条件和负空间是必填项，缺了就判 too-broad。** 一份不能被证伪、也没有边界的问题陈述，在 S065 中会长成无限大的机会树。因此在 `draft` 状态下，这两项与 `alternativeFrames` 一起是硬门槛，由脚本判定，不靠提示词。
- **决策 4：措辞上限只继承 S063 的服务端值；metricContext 永远不能当作证据。** S064 不重新评估证据强度，以免与 S063/S171 形成两处事实源。调用方声明的指标数值没有经过核实，所以只能用来描述现象（§8、E4、E7）。
- **决策 5：`accepted` 状态不由 S064 写入。** 框定被接受的那一刻，是 W027/W029 中的人工关卡。S064 只输出 draft，这样「被接受的问题」有唯一的写入来源，也就是关卡回执。

## 14. Graph change proposals（只提议，不修改矩阵，不假定会被采纳）
1. **W029 Problem-to-PRD 缺少研究入口。** W029 的第一个 Skill 就是 S064，但 S064 的证据接地依赖 S063 的 synthesis。建议 W029 的作者评估两种做法：在 W029 中加入 S063，或者把「已有 W027/W028 产出的 synthesis」写成 W029 的触发前置条件。
2. **D011 gaps 中的「HMW framing」。** S064 不产出 HMW；S066 的 B2 只覆盖发散入口。建议由 D011 的作者决定：新建一个 HMW Skill，或者在 S064 的 handoff 中增加 `hmwSeeds`。本文不预先实现这一项。
3. **D002 Research & Knowledge Analyst 没有 S064。** D002 在 W009 中产出建议，但它的 Skill 列里没有问题框定。这里只记录观察，是否增补由 D002 的作者判断。

## 15. 未决问题
- `knowledge.read` 是否已经在 ADR-120 目录中登记（UNVERIFIED）。
- ProblemFrame 版本链的存储位置，以及 W027/W029 人工关卡回执的字段名，需要与 W027/W029 的文档对齐。这两份文档在本文写作时尚未 PASS。
- A0 中 feature-request 的识别依靠动词 + 名词规则；中文 B2B 场景的误报率，需要在扩充 E1/E9 夹具后评估。
