# S061 — Product Discovery（产品探索）

> Type: Work Skill · Domain: Product & Design · Strategy: A1（两源择优合并）· 目标通道：candidate → verified（ADR-119 G5）
> 本文独立作者化（AUTHOR-S061）。基线：`main@30c1c4332025151610502988b0379b95ff7298c7`。v1 的 S061 模板只用作话题提示，正文未沿用。
> 标注约定：**UNVERIFIED** 表示对 WorkspaceX 现有代码的陈述未在基线逐文件核实；**proposed-unwired** 表示能力尚不存在或未接线，是本 Skill 提议的新东西。

## 1. 这个 Skill 解决什么问题
在产品团队「想做点什么」和「去收集证据」之间，S061 负责把一个模糊的产品意图变成一份**假设账本（assumption ledger）+ 探索计划**：
- 这次探索要推动哪个**可度量的产品结果**（outcome），而不是哪个功能；
- 当前方向依赖哪些假设，按「值不值得先验证」排序；
- 每个高风险假设用哪种**最便宜**的证据方法去检验，成功与失败的判据**事先写死**；
- 证据回来之后（S063 的 Finding），逐条把假设改判为 `supported / refuted / inconclusive`，并给出 `continue / pivot / stop / need-more-evidence` 的探索状态。

S061 **不做**：
- 设计访谈提纲、招募筛选（S062 User Interview Planning）；
- 收集、整理客户声音语料（S009 Customer Research）；
- 把语料综合成 Finding（S063）；
- 写问题陈述和成功标准正文（S064 Problem Framing）；
- 画机会树、给机会排序（S065 Opportunity Mapping）；
- 发散生成解法（S066，不在 W027 上）。

它只拥有两个东西：**假设账本**与**事先登记的检验判据**。探索里最常见的失败是「先做了研究，再回头决定什么算成功」，S061 的存在就是让判据先于证据落盘。

## 2. 图上的消费者（逐条从矩阵读出，不做推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行 | S061 在其中的职能（本文主张，阶段划分由 W027 作者定） |
|---|---|---|
| W027 Discovery-to-Opportunity | 第 33 行：S061, S062, S009, S063, S064, S065 | `plan` 模式在最前：产出 `DiscoveryPlan`，其 `evidenceRequests[]` 交给 S062 / S009；`update` 模式在 S063 之后：用 Finding 改判假设，产出 `DiscoveryReadout` 交给 S064 / S065 |

S061 不出现在其他 Workflow 行。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md）
| DigitalHuman | 矩阵行 | 列 |
|---|---|---|
| D003 Product Manager | 第 9 行，Skill 列第 1 项 | Workflows：W027, W028, W029, W030, W031, W032 |

按 ADR-118 补充决策 9（`docs/adr/ADR-118-generic-workflow-runtime.md` 不在基线 30c1c433 的树中；它来自 fca04a62 #4536，本文在含该提交的工作树 HEAD b0def124 读取）：W027 固定 S061 的版本，D003 运行 W027 不依赖其 Skill 挂载；D003 Skill 列里的 S061 只表示 PM 在**对话中直接**调用（例如「帮我把这个方向的假设理一下」）。D011 Design Thinking Expert 拥有 W027 但 Skill 列没有 S061，因此 D011 只能在 W027 阶段内间接使用 S061，不能在对话中直接调用——本文不补这条边（见 §13）。

### 2.3 与已 PASS 文档的接口对齐
- **S063（PASS）**：S061 `update` 模式消费 `ResearchSynthesis`（S063 §6 原样类型），只读 `findings[].findingId / claim / kind / confidence / assertionCeiling / prevalence / independentRootCount / quotes[].utteranceKind / supportingEvidenceIds / contradictingEvidenceIds`、顶层 `status` 与 `offQuestionObservations`。S063 的 Finding **不输出**每条证据的 `participantId`（只在其输入 corpus 中存在），也**没有** `accountId` 概念；S061 不假设这两个字段，U4 只用 `independentRootCount`，账户级集中检查是 §13 提议 4。W027 中 S063 恒为 `status="provisional"`（S063 决策 6 与 §14 提议 1），S061 据此设上限（决策 4）。
- **S066（PASS）**：不在 W027 上。S066 §4 A 的「solution-in-disguise」检测与 S061 P2 规则是同一判据的两处使用；S061 不调用 S066，只在 P2 里独立实现同样的检查；S061 输出 `DiscoveryPlan.framing.status: "ok" | "solution-in-disguise"`，取值与 S066 `framing.status` 的同名取值同义（S066 另有 `too-broad`，S061 不产出，宽泛由 P1 `unanchored` 覆盖），避免下游两套词表。
- **S009 / S062 / S064 / S065**：尚无 PASS 评审。S061 只规定自己**发出**的 `EvidenceRequest` 与**交出**的 `DiscoveryReadout`，不假设它们的输入 schema；对齐义务写在 §13 提议 2。

## 3. 上游来源与许可（G1）
| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| RefoundAI/lenny-skills | `skills/continuous-discovery/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`，Copyright 2025 Refound AI） | adapt 方法层：「机会必须写成未满足的需要而不是解法」（Distinguish needs from solutions）、「需要与功能请求分开追踪」、「警惕按最响亮少数人构建」三条落成 P2、P3、U4 规则。**不复制**文中嘉宾引语（引语版权属原说话人 / 节目，MIT 只覆盖仓库作者的汇编），`references/guest-insights.md` 一律 reference-only |
| RefoundAI/lenny-skills | `skills/idea-validation/SKILL.md` | 同上 | MIT（仓根 `LICENSE`） | adapt：「区分礼貌兴趣与真实拉动——看付费承诺或高成本行为」落为 §4 的信号强度阶梯 `SignalRung`；「最有风险的假设先验证」落为 P4 排序。不采用其 Founding Hypothesis Scorecard 的具体打分项（未核实其来源许可，reference-only） |
| anthropics/knowledge-work-plugins | `product-management/skills/product-brainstorming/SKILL.md`（Assumption Testing 段，:51–68） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`product-management/LICENSE`） | adapt：六类假设（user / problem / solution / business / feasibility / adoption）作为 P3 的分类起点；WorkspaceX 合并为 5 类（决策 2）。NOTICE 与改动说明写入 SKILL.md 的 `references/upstream.md`（Apache-2.0 §4(b)(c)），不复制原段落 |
| anthropics/knowledge-work-plugins | `product-management/skills/write-spec/SKILL.md`（Problem Statement 段，:79–84） | 同上 | Apache-2.0（同上） | reference-only：「不解决的代价」只作为 P1 的一个必答问题；问题陈述正文归 S064 |

- 两源择优（A1）：lenny 提供「需要 vs 解法」「信号强度」的判断纪律；kwp 提供可枚举的假设分类。两者都**没有**「事先登记判据 + 事后机械改判」的结构，这部分是 WorkspaceX 自有设计（决策 1、3）。
- 克隆位置：`/tmp/claude-0/-home-user-workspacex/73cf4d09-4f20-5254-be5a-96afdef9f330/scratchpad/upstream/{lenny-skills,kwp}`，commit 以上表为准。

## 4. 专业方法（S061 专属步骤）
### 4.1 `plan` 模式
- **P1 结果锚定。** 从输入的 `intent` 中抽出或向用户追问一个 `outcome`：主体（哪类用户 / 账户）+ 可观测行为 + 方向，例如「中小团队管理员 → 首周邀请 ≥3 名成员的比例 ↑」。三问必答：谁、现在什么行为、不解决的代价。答不出任何一项 → `outcome.status="unanchored"`，**不进入 P3**，作为正常返回（不是错误）给出 `tests=[]` 与 `openQuestions`。结果指标的具体数值目标不由 S061 定（S064 的职责）。
- **P2 解法伪装检测。** 若 `intent` 或任一种子假设描述的是一个功能（含「做一个 / 加一个 / 支持 X」等动词 + 产品名词，且没有主体的困境），置 `framing.status="solution-in-disguise"`，改写为「我们相信 <主体> 有 <需要>，所以 <功能> 会改变 <行为>」，把「有需要」拆成独立的 `problem` 假设。原功能保留为 `candidateSolutions[]`，**不删**，也不评价。
- **P3 假设枚举与分类。** 每条假设一句可证伪陈述，`category ∈ {desirability-problem, desirability-solution, viability, feasibility, usability-adoption}`（决策 2）。来源必须标 `origin ∈ {stated-by-user, implied-by-intent, org-knowledge}`；`org-knowledge` 必须带 Context Pack 引用 id。功能请求只能生成 `desirability-solution` 假设，不能生成 `desirability-problem` 假设（需要与请求分离）。
- **P4 风险排序。** 每条假设给两个有序档：`impactIfWrong ∈ {kills-direction, reshapes, minor}`、`evidenceNow ∈ {none, anecdotal, behavioral, committed}`（取当前已知证据在 `SignalRung` 上的最高档）。排序键是确定性的：先 `impactIfWrong` 降序，再 `evidenceNow` 升序，再 `category` 固定次序（problem → solution → adoption → viability → feasibility）。前 `maxTestsPerPlan`（默认 3，上限 5）条进入 P5，其余标 `deferred` 并写原因。**不输出数值分数**（决策 5）。
- **P5 检验设计。** 每条入选假设一条 `AssumptionTest`：
  - `method ∈ {interview-past-behavior, support-ticket-mining, usage-data-query, fake-door, concierge, wizard-of-oz, prototype-usability, pricing-commitment}`；
  - `targetRung`：要达到的 `SignalRung`（`said < did-past < did-now < paid-or-committed`）。`desirability-problem` 最低 `did-past`；`viability` 最低 `paid-or-committed`；
  - `pass` / `fail`：两者都是结构化 `Criterion`（§6）：`metric`（取哪个计数）、`op`、`numerator`、`denominator`；`label` 只作展示，脚本从不解析它。例如 pass=`{metric:"experienceParticipants", op:">=", numerator:4, denominator:8}`、fail=`{metric:"experienceParticipants", op:"<=", numerator:1, denominator:8}`。P5 校验：两判据 `metric` 与 `denominator` 相同、区间不重叠（把比值 n/d 视为实数比较），中间区间即 `inconclusive`；不满足 → `CRITERIA_INVALID`（F6）。`desirability-problem` 的 metric 不得为 `participants`（含 wish），必须为 `experienceParticipants` 或 `independentRootCount`；
  - `minSample`：定性方法不少于 5 人，定量方法写出查询口径；
  - `evidenceOwner`：`S062`（访谈类）、`S009`（工单 / 反馈 / 评论挖掘类）或 `external`（fake-door、concierge、usage-data-query 等 W027 内无对应 Skill 的方法，只生成人工任务，见决策 6）。
- **P6 登记冻结。** 计划输出时计算 `criteriaDigest = sha256(canonicalJSON(tests[].{assumptionId, targetRung, pass, fail, minSample}))`（`label` 不入摘要）。之后任何对判据的修改都要生成新 `planVersion` 并记录 `amendments[]`（改了什么、在看到哪条证据之前 / 之后）。

### 4.2 `update` 模式（W027 中位于 S063 之后）
- **U1 校验。** 输入 `plan.criteriaDigest` 必须与服务端存储的该 `planVersion` 一致，否则 `CRITERIA_TAMPERED`。
- **U2 Finding 映射。** 每条 `AssumptionTest` 只能由调用方或 W027 显式给出的 `findingMap[]` 映射到 S063 Finding；S061 **不自行语义匹配**（决策 3）。未映射的测试判 `untested`。
- **U3 机械改判。** 对每条已映射测试，取观测值 `v`：`metric ∈ {participants, experienceParticipants}` 取映射 Finding 的 `prevalence.<metric>`（多条 Finding 取最大值，不求和，防重复计人），`independentRootCount` 同理，`supportingEvidenceCount` 取 `supportingEvidenceIds` 去重并集大小，`externalValue` 只取 `externalResults`（见 U3b）。分母不等于 `criterion.denominator`（例如 `prevalence.of=7` 而判据写 8）时按实际比值比较并在 `reason` 附 `denominatorMismatch`。判定顺序固定：
  1. 样本（`prevalence.of` 或回执分母）< `minSample.n` → `inconclusive` / `below-min-sample`；
  2. 满足 fail → `refuted` / `met-fail`（fail 不看 rung：已有行为证据都达不到下限，更高档也无从谈起）；
  3. 满足 pass：若 `observedRung < targetRung` → `inconclusive`（`observedRung="said"` 时 reason=`wish-only`，否则 `rung-too-low`）；否则 → `supported` / `met-pass`；
  4. 其余 → `inconclusive` / `in-band`。
- **U3a `observedRung` 推导（确定性，只用 S063 已输出字段）。** 对一条测试的映射 Finding 集合：
  - 所有 Finding 都有 `prevalence` 且 `experienceParticipants=0`，或 `quotes[]` 非空且无 `utteranceKind="experience"` → `said`；
  - 否则 → `did-past`（S063 的 experience 片段就是「讲出了过去发生的具体经历」）。
  - S063 **不可能**给出 `did-now` 或 `paid-or-committed`：它综合的是访谈 / 工单 / 文档语料，没有当下行为或付费信号。因此在只有 S063 输入的情况下，`targetRung ∈ {did-now, paid-or-committed}` 的测试（所有 viability 测试、usage-data-query、fake-door、concierge）**恒为** `inconclusive` / `rung-too-low`，不会被 S063 Finding 改判为 `supported`。本文明确接受这一点，而不是放宽规则。
- **U3b 外部回执回流（proposed-unwired）。** `update` 输入可带 `externalResults[]`：每条对应一个 `externalTasks[].taskId`，由 W027 人工门批准的执行者提交 `{ taskId, observedRung, value: { numerator, denominator }, approvalRef }`。服务端核实 `taskId` 属于该 `planVersion`、`approvalRef` 指向 W027 人工门的已批准记录（该记录形态由 W027 / ADR-118 effect-gateway 定，本文未核实，UNVERIFIED）；核实失败 → `EXTERNAL_RESULT_UNVERIFIED`。核实通过后，该测试以 `metric="externalValue"` 按同一 U3 顺序判定，`observedRung` 取回执值但不得高于该 `method` 可产生的最高档（fake-door → `did-now`；pricing-commitment → `paid-or-committed`；concierge / wizard-of-oz → `did-now`；usage-data-query → `did-now`）。这是 viability 假设在 W027 中唯一可达 `supported` 的路径；回执存储与人工门接线均未存在。
- **U4 响亮少数检查。** 若某 `supported` 判定的映射 Finding 中 `max(independentRootCount) ≤ 2`，降为 `inconclusive` / `concentrated-source`。在 S063 corpus 模式下 `independentRootCount = experienceParticipants`（S063 §6 注释），即「独立讲出经历的人 ≤2」。**账户级集中**（多名参与者同属一个客户账户）目前无法判断：S063 不输出参与者或账户 id，S061 也没有从 `supportingEvidenceIds`（`segmentId`）解引用到参与者 / 账户的读取能力。本文不假设该能力，改为 §13 提议 4；在它落地前，U4 只保证参与者级，不保证账户级，readout 在 `limitations[]` 固定写入 `account-concentration-unchecked`。
- **U5 探索状态。** 规则表（按顺序取第一条命中）：
  1. 任一 `impactIfWrong=kills-direction` 且 `category≠desirability-solution` 的假设 `refuted` → `stop`（列出被推翻的假设，建议交回 S064 重新框定）；
  2. 被 `refuted` 的 `kills-direction` 假设全部是 `desirability-solution`，且至少一条 `desirability-problem` 假设 `supported` → `pivot`（问题成立、解法不成立）；
  3. 所有入选 `kills-direction` 假设 `supported` → `continue`；
  4. 否则 → `need-more-evidence`，并为每条 `inconclusive` 生成下一轮 `evidenceRequests`。
  - 输入 `ResearchSynthesis.status="provisional"` 时，`continue` 降为 `continue-provisional`（决策 4）。
- **U6 意外发现。** S063 的 `offQuestionObservations` 与未映射 Finding 原样列入 `unplannedSignals[]`，**不**自动升格为新假设；由人决定是否进入下一个 `planVersion`。

## 5. 输入契约（`inputSchema`，写入 WorkSkillManifest）
```ts
type S061Input =
  | {
      mode: "plan";
      intent: string;                                  // 1–2000 字
      seedAssumptions?: Array<{ text: string; origin: "stated-by-user" }>;
      contextRefs?: string[];                          // Context Pack 条目 id；服务端解引用
      productArea?: string;                            // 仅标签
      market: "CN" | "US" | "global";                  // 决定 §9 的方法约束
      locale: "zh-CN" | "en-US";
      maxTestsPerPlan?: number;                        // 默认 3，1..5
      priorPlanRef?: { planId: string; planVersion: number };  // 修订时必填
    }
  | {
      mode: "update";
      planRef: { planId: string; planVersion: number };
      criteriaDigest: string;                          // 调用方声称；服务端重算比对
      synthesisRef: { skill: "S063"; synthesisId: string };    // 服务端读取，不接受内联 findings
      findingMap: Array<{ testId: string; findingIds: string[] }>;
      externalResults?: Array<{ taskId: string; observedRung: "did-now" | "paid-or-committed";
                                value: { numerator: number; denominator: number };
                                approvalRef: string }>;          // U3b，proposed-unwired
      locale: "zh-CN" | "en-US";
    };
```
不变量：
- I1 `plan` 模式下 `seedAssumptions.length ≤ 30`；超出 → `TOO_MANY_ASSUMPTIONS`。
- I2 `update` 模式下 `findingMap` 中每个 `testId` 必须属于该 `planVersion`，每个 `findingId` 必须属于该 `synthesisId`。
- I3 `synthesisRef` 指向的 `ResearchSynthesis` 必须在同一组织、且调用者可读。
- I4 `update` 不接受内联 Finding 文本，防止调用方伪造证据。

## 6. 输出契约（`outputSchema`，S061 专属）
```ts
type SignalRung = "said" | "did-past" | "did-now" | "paid-or-committed";

type Criterion = {
  metric: "participants" | "experienceParticipants" | "independentRootCount"
        | "supportingEvidenceCount" | "externalValue";
  op: ">=" | ">" | "<=" | "<";
  numerator: number;               // 非负整数
  denominator: number;             // 正整数；externalValue 时为回执口径的分母
  label: string;                   // 展示用自然语言，≤120 字，不参与判定与摘要
};

type DiscoveryPlan = {
  planId: string; planVersion: number; market: "CN"|"US"|"global"; locale: string;
  framing: { status: "ok" | "solution-in-disguise"; hiddenNeeds: string[] };
  outcome: { status: "anchored" | "unanchored"; actor?: string; behavior?: string;
             direction?: "increase" | "decrease"; costOfInaction?: string; openQuestions: string[] };
  candidateSolutions: Array<{ id: string; text: string; fromSolutionInDisguise: boolean }>;
  assumptions: Array<{
    assumptionId: string;            // "A1".. 在 planId 内稳定，跨版本不复用
    text: string;                    // ≤200 字，可证伪
    category: "desirability-problem"|"desirability-solution"|"viability"|"feasibility"|"usability-adoption";
    origin: "stated-by-user" | "implied-by-intent" | "org-knowledge";
    contextRef?: string;             // origin=org-knowledge 必填
    impactIfWrong: "kills-direction" | "reshapes" | "minor";
    evidenceNow: "none" | SignalRung;
    selected: boolean; deferredReason?: string;
  }>;
  tests: Array<{
    testId: string; assumptionId: string;
    method: "interview-past-behavior"|"support-ticket-mining"|"usage-data-query"|"fake-door"
          |"concierge"|"wizard-of-oz"|"prototype-usability"|"pricing-commitment";
    targetRung: SignalRung;
    pass: Criterion; fail: Criterion;   // 中间区间由两者推出，不单独写
    minSample: { unit: "participants" | "accounts" | "events"; n: number };
    evidenceOwner: "S062" | "S009" | "external";
    complianceNotes: string[];       // §9 触发的约束
  }>;
  evidenceRequests: Array<{ requestId: string; toSkill: "S062" | "S009"; testIds: string[];
                            researchQuestion: string; segmentHint?: string;
                            piplScope?: { purpose: string; consentRequired: true;
                                          crossBorder: boolean } }>;   // §9：market ∈ {CN, global} 时必填
  externalTasks: Array<{ taskId: string; testId: string; description: string; requiresHumanApproval: true }>;
  criteriaDigest: string;
  amendments: Array<{ fromVersion: number; changed: string; beforeEvidence: boolean }>;
};

type DiscoveryReadout = {
  planId: string; planVersion: number; synthesisId: string; synthesisStatus: "final" | "provisional";
  verdicts: Array<{ testId: string; assumptionId: string;
    result: "supported" | "refuted" | "inconclusive" | "untested";
    observedRung?: SignalRung; findingIds: string[];
    reason: "met-pass" | "met-fail" | "in-band" | "below-min-sample" | "rung-too-low"
          | "concentrated-source" | "wish-only" | "unmapped";
    denominatorMismatch?: boolean }>;
  limitations: Array<"account-concentration-unchecked">;
  discoveryState: "continue" | "continue-provisional" | "pivot" | "stop" | "need-more-evidence";
  stateRule: 1 | 2 | 3 | 4;          // U5 命中的规则号
  nextEvidenceRequests: DiscoveryPlan["evidenceRequests"];
  unplannedSignals: Array<{ findingId?: string; text: string }>;
};
```
- 刻意**不设** `priorityScore`、`opportunitySize`、`recommendedFeature` 字段（决策 5；机会排序归 S065）。
- `DiscoveryReadout` 是 W027 交给 S064 / S065 的唯一 S061 产物；`candidateSolutions` 原样透传，S061 不评价。

### 6.1 类型化错误
| code | 触发 | 调用方可做的事 |
|---|---|---|
| `CRITERIA_INVALID` | P5：pass/fail 的 metric 或分母不一致、区间重叠、`desirability-problem` 用了 `participants`、`market=CN` 的 pricing-commitment 判据含实付 | 修正判据；整份 plan 不输出 |
| `EXTERNAL_RESULT_UNVERIFIED` | U3b：`taskId` 不属于该版本或 `approvalRef` 无法核实 | 走 W027 人工门取得批准记录 |
| `TOO_MANY_ASSUMPTIONS` | I1 | 拆分意图 |
| `PLAN_NOT_FOUND` / `PLAN_VERSION_STALE` | `planRef` 不存在或不是最新版 | 取最新版本 |
| `CRITERIA_TAMPERED` | U1 digest 不一致 | 走 `plan` 修订并记录 amendment |
| `SYNTHESIS_NOT_FOUND` / `SYNTHESIS_FORBIDDEN` | I3 | 请求授权；**不得**改用别的 synthesis 静默重试 |
| `FINDING_NOT_IN_SYNTHESIS` / `TEST_NOT_IN_PLAN` | I2 | 修正 `findingMap` |
| `CONTEXT_REF_FORBIDDEN` | `contextRefs` 中有调用者不可读的条目 | 整个请求失败、不输出 plan（不降级）；去掉该引用后重试 |

## 7. 授权边界（调用方声称 vs 服务端核实）
| 字段 | 调用方声称 | 服务端核实（proposed-unwired，除注明外） |
|---|---|---|
| 组织 / 调用者身份 | 不接受 | 取自会话；Skill 运行时身份沿用现有 Agent 运行链路（UNVERIFIED：具体注入点未在基线逐文件核实） |
| `contextRefs` | 列出 id | 逐条按调用者可读性解引用；不可读 → `CONTEXT_REF_FORBIDDEN`，不降级为「匿名摘要」 |
| `criteriaDigest` | 给出 | 服务端对存储的 plan 重算，比对（U1） |
| `synthesisRef` | 给出 id | 服务端读取 S063 产物并校验组织与可读性；内联 Finding 不接受（I4） |
| `evidenceOwner=external` 的任务 | — | 只生成 `externalTasks`，`requiresHumanApproval: true`；fake-door / pricing-commitment 这类会触达真实用户的动作经 ADR-118 决策 6 的 effect-gateway 与 W027 人工门执行，S061 本身**无写副作用** |
| 市场 `market` | 声称 | 仅影响方法约束，不授予任何数据访问权 |

S061 的 `plan` / `update` 存储（按 `planId + planVersion` 不可变）是 proposed-unwired：基线中没有 discovery plan 的表或用例。

## 8. 依赖（能力分类，ADR-120）
- **required**：`knowledge.read`（解引用 `contextRefs`；分类名为提议，ADR-120 状态为 Proposed）、`skill-artifact.read`（读取 S063 产物，proposed-unwired 分类）。
- **optional**：`sandbox.exec`，经 `apps/skill-sandbox`（目录在基线存在）运行 `scripts/rank.mjs`（P4 排序）、`scripts/digest.mjs`（P6/U1）、`scripts/adjudicate.mjs`（U3–U5）。三者都是确定性脚本，不调用模型。
- **不依赖**任何写类工具。

## 9. CN / US 差异（实质性的部分）
| 维度 | CN | US |
|---|---|---|
| fake-door / 定价承诺测试 | 展示未上线功能或价格需避免构成虚假宣传（《广告法》《反不正当竞争法》）；`complianceNotes` 要求落地页显式标注「功能调研 / 尚未上线」，且 pricing-commitment 不得收取真实款项，改用意向登记 | FTC Act §5 对欺骗性表述同样适用；pricing-commitment 可用可退款预付，但需写明退款条款；`complianceNotes` 标注 |
| 访谈 / 工单挖掘的个人信息 | 《个人信息保护法》：用于研究需告知并取得同意，工单原文挖掘须用于收集时声明的目的范围内；跨境传输语料需单独评估 → 发往 S062 / S009 的 `evidenceRequests[].piplScope` 必填 | 无统一联邦法；CCPA/CPRA 适用于加州消费者，B2B 访谈通常按合同约束 |
| 支付信号的可得性 | B2B 采购常经招投标 / 审批流，`paid-or-committed` 档接受「采购意向书 / 进入预算申请」 | 接受 LOI、试点合同、信用卡预授权 |
| usage-data-query | 若产品部署在客户私有化环境，行为数据可能不可得，P5 对 `usage-data-query` 需先确认数据可达，否则自动改为 `interview-past-behavior` | SaaS 多租户下通常可得 |

`market="global"` 时取两侧约束的并集。

## 10. 决策
- **决策 1：判据先于证据登记，并用摘要冻结。** 上游两源都讲「先验证最危险的假设」，但都没有防止事后改判据。W027 中 S063 的输出在同一 Workflow 实例里回流，事后调整门槛的诱惑最大。`criteriaDigest` + `amendments.beforeEvidence` 让审计能区分「看证据前修订」与「看证据后修订」。
- **决策 2：五类假设，而不是 kwp 的六类。** 把 kwp 的 user 与 problem 合并为 `desirability-problem`（在我们的输出里两者的检验方法相同，都是过去行为访谈 / 工单挖掘），把 solution 拆成 `desirability-solution`（要不要）与 `usability-adoption`（会不会用），因为后者的检验方法（prototype-usability）不同。分类直接决定 `method` 与 `targetRung` 的合法组合，所以分类按「检验方法不同」来切，而不是按主题。
- **决策 3：`update` 模式不做语义匹配。** Finding → 测试的映射只接受显式 `findingMap`。若让 S061 自己匹配，它会倾向于把相近的 Finding 当作支持证据，这正是本 Skill 要防的确认偏误；映射由 W027 的人工门或调用者给出，S061 的改判完全机械、可复算。
- **决策 4：provisional 综合不能产出 `continue`。** W027 没有 S171（S063 §14 提议 1），S063 在 W027 中恒为 provisional。S061 因此把 `continue` 降为 `continue-provisional`，让 S064 / S065 与 D003 看到这不是经过证据评审的结论。
- **决策 5：不打分。** P4 用有序档和固定次序，不产生数值。数值风险分会被下游当成机会优先级，而机会排序是 S065 的唯一职责。
- **决策 6：W027 内无对应 Skill 的检验方法只生成人工任务。** fake-door、concierge、pricing-commitment、usage-data-query 在 W027 的六个 Skill 里没有执行者；S061 不越界去执行，只输出 `externalTasks`。是否给这些方法补 Skill 见 §13 提议 1。

## 11. 失败模式（S061 特有）
| # | 失败 | 检测 / 防线 |
|---|---|---|
| F1 | 把功能请求当作问题成立的证据 | P3：功能请求只能生成 solution 类假设；P5：problem 判据禁用 `participants`；U3a：wish-only → `said` 档 |
| F2 | 事后调低通过门槛 | P6 digest、U1 `CRITERIA_TAMPERED`、amendments 标注 |
| F3 | 结果锚在产出（「上线 X」）而不是行为 | P1 要求 actor + behavior；产出类动词触发 `unanchored` |
| F4 | 响亮少数（1–2 人）撑起「supported」 | U4 `concentrated-source`（参与者级；账户级待 §13 提议 4） |
| F5 | 只测容易测的假设，致命假设被 defer | P4 固定排序：`kills-direction` 永远先入选；`deferredReason` 不得为「难测」 |
| F6 | pass / fail 判据重叠或无分母 | 结构化 `Criterion` 强制分母；P5 校验失败 → `CRITERIA_INVALID` |
| F7 | 把意外发现直接升格为结论 | U6：`unplannedSignals` 不改判任何假设 |
| F8 | 在 CN 市场用真实收款做定价测试 | §9：`market=CN` 时 pricing-commitment 的 `pass.label` 与 `externalTasks` 描述不得含实付，否则 `CRITERIA_INVALID` |
| F9 | 把 S063 的访谈证据当作付费 / 当下行为证据 | U3a：S063 输入最高 `did-past`；更高档只能来自已核实回执（U3b） |

## 12. 评测（`evals/work-stack/S061/`，ADR-119；夹具均为合成数据）
| # | 输入 | 通过判据 |
|---|---|---|
| E1 | `plan`，intent「给管理后台加一个批量导入成员的按钮」 | `framing.status="solution-in-disguise"`；`candidateSolutions` 含原功能；至少 1 条 `desirability-problem` 假设关于「管理员逐个邀请成员有困难」；不出现对功能的评价 |
| E2 | `plan`，intent「让产品更好用」 | `outcome.status="unanchored"`，`tests=[]`，`openQuestions` 覆盖 谁 / 什么行为 / 不解决的代价 三项 |
| E3 | `plan`，7 条种子假设，其中 2 条 `kills-direction` 且 `evidenceNow=none`，1 条 `kills-direction` 且 `behavioral`，`maxTestsPerPlan=3` | 入选恰为 3 条 kills-direction，顺序：两条 none 在前（再按 category 次序），behavioral 在后；其余 4 条 `deferred` 且理由非「难测」 |
| E4 | `plan`，viability 假设「中小团队愿意为 AI 纪要每席位每月付费」 | `targetRung="paid-or-committed"`；method ∈ {pricing-commitment, fake-door}；evidenceOwner=`external`；`externalTasks` 一条且 requiresHumanApproval |
| E5 | E4 同输入，`market="CN"` | `complianceNotes` 含「尚未上线」标注与「不得实付」；`pass.label` 与 `externalTasks[].description` 使用意向登记而非付款 |
| E6 | `update`：pass=`{metric:experienceParticipants, >=, 4/8}`，fail=`{experienceParticipants, <=, 1/8}`，minSample 5；S063 Finding prevalence={participants:6, experienceParticipants:3, of:8} | result=`inconclusive`，reason=`in-band`（v=3，不取 participants=6） |
| E7 | `update`：同 E6 判据，Finding prevalence={participants:5, experienceParticipants:0, of:8} | result=`refuted`，reason=`met-fail`，observedRung=`said`（v=0 ≤1；fail 不看 rung，符合 U3 顺序 2） |
| E7b | `update`：`desirability-solution` test，pass=`{participants, >=, 4/8}`，fail=`{participants, <=, 1/8}`，targetRung=`did-past`；Finding prevalence={participants:5, experienceParticipants:0, of:8} | result=`inconclusive`，reason=`wish-only`，observedRung=`said` |
| E8 | `update`：pass=`{supportingEvidenceCount, >=, 5/10}`，Finding 有 5 条 supportingEvidenceIds、`independentRootCount=2`、experience 片段存在 | result=`inconclusive`，reason=`concentrated-source`；`limitations` 含 `account-concentration-unchecked` |
| E9 | `update`：请求中的 `criteriaDigest` 与存储的 planVersion 不一致（`pass.numerator` 被从 4 改为 3） | 返回 `CRITERIA_TAMPERED`，无 readout |
| E10 | `update`：一条 kills-direction problem 假设 supported，其 solution 假设 refuted；synthesis status=provisional | discoveryState=`pivot`，stateRule=2 |
| E11 | `update`：全部 kills-direction 假设 supported，synthesis status=provisional | discoveryState=`continue-provisional`（不是 `continue`） |
| E12 | `update`：`findingMap` 为空，S063 有 4 条与测试字面高度相似的 Finding | 全部 test=`untested`/`unmapped`；Finding 进 `unplannedSignals`；discoveryState=`need-more-evidence` |
| E13 | `update`：synthesisRef 指向调用者不可读的另一项目 | `SYNTHESIS_FORBIDDEN`；不回退到任何其他 synthesis |
| E14 | `plan`，contextRefs 含一条调用者不可读条目，且种子假设引用它 | 返回 `CONTEXT_REF_FORBIDDEN`，无 plan 输出 |
| E15 | `update`：E4 的 viability 测试，只给 S063 synthesis（Finding experienceParticipants=6/8，满足 pass 数值），无 `externalResults` | result=`inconclusive`，reason=`rung-too-low`，observedRung=`did-past` |
| E16 | `update`：同 E15，另带 `externalResults=[{taskId, observedRung:"paid-or-committed", value:{5,8}, approvalRef:<已批准>}]`，pass=`{externalValue, >=, 4/8}` | result=`supported`，observedRung=`paid-or-committed` |
| E17 | 同 E16 但 `approvalRef` 不存在 | `EXTERNAL_RESULT_UNVERIFIED`，无 readout |
| E18 | `update`：一条 kills-direction `desirability-problem` 假设 refuted（其余任意）| discoveryState=`stop`，stateRule=1 |
| E19 | `plan`：种子测试 pass=`{experienceParticipants, >=, 2/8}`、fail=`{experienceParticipants, <=, 3/8}`（重叠） | `CRITERIA_INVALID` |
| E20 | `plan`：`desirability-problem` 测试 metric=`participants` | `CRITERIA_INVALID` |
| E21 | `update`：`planRef.planVersion=1`，但存储已有 v2 | `PLAN_VERSION_STALE` |
| E22 | `plan`，`market="CN"`，含 S062 访谈请求 | 每条发往 S062 / S009 的 `evidenceRequests[].piplScope` 存在且 `consentRequired=true` |

G5 基线：同一夹具交给无 Skill 的通用 Agent。预期基线在 E1、E6、E7b、E8、E11、E15 上失败（倾向于把 wish 和大客户意见当支持、把 provisional 当定论）。

## 13. Graph change proposals（只提议，不改矩阵）
1. **W027 缺实验执行 Skill**：fake-door / concierge / pricing-commitment 在 W027 中只能落成 `externalTasks`（决策 6）。提议 W027 作者或目录 owner 裁定：新增一个「Product Experiment Design / Run」Skill，或在 W027 文档中接受人工任务作为终态。
2. **接口对齐**：S062 / S009 的作者需声明是否接受 `EvidenceRequest`（§6 `evidenceRequests[]` 形状）作为输入；S064 / S065 的作者需声明是否消费 `DiscoveryReadout`。若不接受，由 W027 作者在阶段间定义映射。
3. **D011 直接调用**：D011 拥有 W027 但 Skill 列无 S061。若设计思维专家在对话中需要维护假设账本，建议由 D011 作者决定是否把 S061 加入其 Skill 列；本文不假设这条边。
4. **S063 输出增加参与者 / 账户归属（对 S063 的对齐提议）**：U4 需要账户级集中检查。提议 S063 在 corpus 模式的 Finding 上增加 `supportingParticipantIds: string[]`（其输入 corpus 已有 `participantId`），并由 S009 / S062 的语料在 `corpus[]` 中可选携带 `accountId`，S063 透传为 `supportingAccountIds`。备选：新增 proposed-unwired 读取能力 `research-ledger.read`，让 S061 按 `segmentId` 解引用 WX-S010 账本拿到参与者与账户。两种方案都由 S063 作者 / 目录 owner 裁定；落地前 S061 维持 `account-concentration-unchecked`。

## 14. WorkspaceX 落位
在工作树 HEAD b0def124 读过（含 fca04a62 #4536；该提交不是基线 30c1c433 的祖先，基线树中无 ADR-116~121）：
- `docs/adr/ADR-118-generic-workflow-runtime.md`（决策 6 effect-gateway、补充决策 9）；`docs/adr/ADR-119-work-stack-eval-and-release-gates.md`（`evals/work-stack/<ID>/`、G0–G6）；`docs/adr/ADR-120-tool-capability-categories.md`（状态 Proposed）。

在基线 30c1c433 确认存在的：
- `apps/skill-sandbox/`（目录存在；脚本执行接口 UNVERIFIED）。
- `packages/contracts/src/feedback-loop.ts`：`FeedbackKind = ["缺陷","需求"]`。S009 若把反馈作为语料，`需求` 类反馈对 S061 只能支撑 `desirability-solution` 假设（F1）；这是对 S009 的提示，不是 S061 的直接依赖。
- `apps/api/src/application/interview/confirm-insight.ts`、`apps/api/src/application/feedback/triage-feedback.ts`：存在；它们是否能产出 S063 可消费的语料 UNVERIFIED。

proposed-unwired：
- `DiscoveryPlan` / `DiscoveryReadout` 的存储、`planVersion` 不可变与 digest 校验用例；
- `externalResults` 回执存储与 W027 人工门 `approvalRef` 的核实接口；
- `scripts/rank.mjs`、`scripts/digest.mjs`、`scripts/adjudicate.mjs`；
- 能力分类 `knowledge.read`、`skill-artifact.read` 的登记；
- `evals/work-stack/S061/` 夹具与 grader。

## 15. 未决问题
- U4 的「≤2 名参与者或单一账户」阈值需用历史研究回测，并决定是否允许组织级覆盖。
- `usability-adoption` 与 `desirability-solution` 的切分是否会让 S065 的机会树多出一层，需 S065 作者确认。
- P2 的解法伪装检测与 S066 A 步是否抽成共享确定性检查（同一判据两处实现有漂移风险），由目录 owner 决定。
