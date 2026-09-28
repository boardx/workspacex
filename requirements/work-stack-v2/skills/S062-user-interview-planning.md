# S062 — User Interview Planning（用户访谈规划）

> Type: Work Skill · Domain: Product · Strategy: A1（WorkspaceX 既有 WX-S019 为主干 + 两个上游源择优补点）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：`main@30c1c4332025151610502988b0379b95ff7298c7`（在包含该提交的 merge `33fc54c1` 上逐文件核读）。
> 本文独立作者化（AUTHOR-S062）；v1 模板未沿用正文。凡未在基线读到的实现一律标 `UNVERIFIED`，尚未存在或未接线的能力一律标 `proposed-unwired`。

## 1. 这个 Skill 解决什么问题
在**还没有访谈任何人之前**，把一个产品/学习设计决策变成一份可审阅、可执行、可被下游逐条对账的访谈计划：研究问题（RQ）、招募筛选条件与分层、样本与停止规则、同意与敏感题处理、中立提纲（每一问都挂 RQ）、试访与执行排期。

S062 的产出是**计划**，不是证据：
- 不招募、不外发邀约、不预约、不录音、不生成虚构受访者或虚构回答；
- 不做综合（S063）、不取已有客户证据（S009）、不给机会或优先级（S064 / S065）。

它存在的理由：W027 / W028 里 S063 的 Finding 只能回答输入里 `questions[]` 列出的问题（S063 §4.1 P1），S009 也按同一组 `questions[]` 取证（S009 §5）。**这组问题和它背后的抽样口径就是 S062 定的**；计划阶段的幸存者偏差、诱导问法、缺反例题，到了综合阶段已经无法补救。

## 2. 图上的消费者（逐条从矩阵读出，不改边）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行（原文） | S062 在其中的职责 | 交给谁 |
|---|---|---|---|
| W027 Discovery-to-Opportunity | 第 33 行：S061, S062, S009, S063, S064, S065 | `discovery` 模式：从机会假设出发规划探索性访谈 | `researchQuestions[]` → S009 `questions` 与 S063 `questions`（同一 `questionId`）；`screener` → S009 `voice-corpus` 抽样口径（见 §14 提议 1） |
| W028 Research-to-Insight | 第 34 行：S062, S009, S063, S169, S171, S065 | `evaluative` / `discovery` 模式：Workflow 首阶段，定 RQ 与抽样 | 同上；S171 `claim-audit` 回看时用 `plannedSample` 判断覆盖缺口 |

S062 在两个 Workflow 里都是 S009 之前的阶段；W027 中 S061 在其前（S061 产出的内容如何进入本 Skill 的 `priorEvidence`，由 W027 作者定义，本文不假设其形状）。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md，S062 均在 Skill 列）
| 角色 | 矩阵行 | 该行 Workflow 列 | 缺省 `domainProfile` |
|---|---|---|---|
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | `product` |
| D026 Education & Learning Designer | 第 32 行 | W028, W008, W006, W059 | `learning` |
| D043 UX Researcher | 第 49 行 | W027, W028, W031, W060 | `product` |
| D047 Learning Experience Designer | 第 53 行 | W028, W008, W006, W031 | `learning` |

按 ADR-118 决策 9，Skill 列只表示**聊天中直接调用**；四个角色在 W027/W028 阶段内使用 S062 是经 Workflow 固定版本获得，不依赖这里的挂载。`learning` profile 只改变敏感题清单（学生/未成年人、成绩、教育记录）与招募关系偏差检查（授课者访谈自己学生），不复制 Skill。

## 3. 上游来源与许可（G1）
| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| WorkspaceX（本仓） | `skills/standard-methods/user-research-planning/SKILL.md` + `references/planning-template.md`（WX-S019 v1.0.1） | 基线 `30c1c43` | Apache-2.0（该目录 `LICENSE`） | **adopt 主干**：决策→RQ→证据缺口→方法映射；招募覆盖未完成/退出者；拒答/拒录不得成为排除条件；每个提问（含开场、追问、结束）挂目标 ID；样本数是规划建议不是已招募人数 |
| anthropics/knowledge-work-plugins | `design/skills/user-research/SKILL.md`（:12-19 方法表，:21-27 五段提纲） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`design/` 无独立 LICENSE，取仓根 `LICENSE`） | reference-only：方法选择表的维度（适用问题 / 样本量级 / 周期）与「Reaction」段的位置（概念展示放在经历段之后）。**不采用**其 :14 固定「5-8」样本，理由见决策 3 |
| RefoundAI/lenny-skills | `skills/customer-interviews/SKILL.md`（:15 过去行为而非假设意见，:41-44 避免推销式访谈，:54 7–14 人区间） | `13598cc54e09399bc1bc1398b0fca284110efb2f` | 仓根 `LICENSE` 为 MIT；但正文大量是播客嘉宾逐字引语，其版权归属未声明 → **按 reference-only 处理，不复制任何引语** | reference-only：Q-SOLUTION-PITCH 检查（提纲在经历段不得出现方案描述）、「最近一次」故事法作为经历锚点。**不采用** :54 的「7–14 人」固定区间 |

- 采用 WX-S019 时同包复用，不另建第二份方法文件（§12）。Apache-2.0 源的 NOTICE 与改动说明写进 `references/upstream.md`。
- 上游两个固定样本区间（5–8 与 7–14）互相矛盾，且都不是按分层计的；本 Skill 以决策 3 的分层下限 + 停止规则取代，二者只作为「无分层、单一细分」的对照记录在 `sampleRationale` 中。

## 4. 专业方法（S062 专属步骤）
**P0 模式判定**（由输入 `mode` 决定，不由模型猜）：
| 模式 | 适用 | 提纲重心 |
|---|---|---|
| `discovery` | W027；尚无方案，要找问题与触发事件 | 最近一次经历 → 时间线 → 替代方案 → 放弃/切换的触发 |
| `evaluative` | W028；已有概念/原型，要看是否理解、能否完成 | 先经历段（与 discovery 同）再概念反应段；概念反应段只能在经历段之后（§3 源 2） |
| `learning-needs` | D026 / D047；学习者/教师的学习需求与困难 | 最近一次学习/授课任务 → 卡点 → 求助路径 → 评估体验 |

**P1 决策锚定**：`decision` 必须是一个会被本研究结果改变的具体决定（「是否把导出改成异步」），不是话题（「了解导出体验」）。缺失或只有话题时返回 `status="needs-clarification"` 并列出缺什么，不先写提纲。

**P2 RQ 拆分**：
- 1–5 条 RQ（上限与 `DigitalInterviewResearchBrief.learningGoals.max(5)` 一致，已核实 `packages/contracts/src/interview.ts:333`）；
- 每条 RQ 必须是**能被访谈回答的**问题：问「做过什么 / 怎么做 / 为什么放弃」，不问「会不会买 / 占比多少」。后者标 `methodMismatch`，建议问卷或行为数据，并写进 `notAnswerableByInterview[]`；
- 每条 RQ 标 `priorEvidence`（已有证据 id 或 `none`）与 `gap`；已有证据足以回答的 RQ 不进入访谈，写进 `droppedRqs[]` 附理由。

**P3 抽样框与筛选器**：
- 由 RQ 推出**必须覆盖的分层**（`strata[]`），每层写判别条件（行为条件优先于人口属性：「过去 30 天至少完成 1 次导出」优于「25–35 岁」）；
- **反幸存者规则**：任何 RQ 涉及失败、卡住、流失、退课、放弃时，必须有一层是「尝试过但未完成 / 已退出」，否则 `blocking` 质量项 `SURVIVOR_ONLY_SAMPLE`；
- **关系偏差检查**：计划招募渠道为「客户成功经理推荐的客户」「自己班上的学生」「内部员工」时，标 `recruitmentBias` 并写对冲办法（加一层非推荐渠道、由第三方访谈者执行）；
- 筛选题（`screener[]`）只问行为与资格，不暴露研究假设（筛选题里不得出现待验证功能名），每题给出 `qualifyIf` / `disqualifyIf`；
- 人口属性与敏感属性只在某 RQ 真的需要时出现，并标 `necessityRqIds`。

**P4 样本与停止规则**（决策 3）：
- 每层 `plannedPerStratum` ≥ 3；
- 若计划想在某层之后做「普遍性」表述，该层计划独立受访者数要 ≥ `generalizationClaimMinIndependentSubjects`（当前值 5，唯一事实源 `packages/contracts/src/thresholds.ts:270`，本 Skill 只引用不抄数值，运行时读取）；不满足则在 `limitations` 写明「本层结果只能写成『部分受访者提到』」；
- 停止规则：连续 `k=2` 场同层访谈在所有 RQ 上都没有出现新代码时停止该层；上限 `maxSessions` 由预算给出；二者都写进 `stoppingRule`，不承诺「必然饱和」。

**P5 同意与敏感题设计**：
- 同意项逐条映射到 `CONSENT_ITEMS = ["record","transcript","ai_analysis","attribution"]`（唯一事实源 `packages/contracts/src/consent-item.ts`，已核实）：计划只写每项「本研究为何需要」与「不给时如何继续」，**不另立同意项**；
- 拒绝任何一项、跳过敏感题、中途退出，都**不得**是 `disqualifyIf` 条件（WX-S019 第 4 步）；
- 每道敏感题有 `necessity`、`skippable: true` 和替代问法；没有 RQ 需要的敏感题直接删除并记入 `removedSensitiveQuestions[]`。

**P6 中立提纲**：
- 段结构用 `warmup | core | counterexample | closing`（与 `DigitalInterviewQuestionSection` 同一枚举，已核实 `interview.ts`）；
- 每个提问（含追问与结束补充）都有 `rqIds`（非空）；纯致谢与权利说明标 `kind="script"`，不计入提问；
- 每条 RQ 至少 1 个 `core` 问题 + 1 个 `counterexample` 问题；
- `core` 问题必须有经历锚点（最近一次 / 上一次 / 当时）；
- 每段至少 2 条开场问法，以便直接落进现有访谈大纲（`MIN_OPENERS_PER_SECTION = 2`，已核实 `domain/interview/outline.ts:25`）。

**P7 问题体检**（决策 2）：对全部提问跑一次确定性检查，结果写进 `qualityFindings[]`。`blocking` 项未清零时 `status="blocked"`，不得标 `ready-for-review`。

**P8 时长与排期**：
- 各段 `minutes` 之和 ≤ `plannedMinutes`；超出时按「先删 warmup 追问、再删低优先级 RQ 的第二个 core 问题」压缩，并列出删了什么；
- 排期只写相对周次与负责人占位（`owner: null`），不写具体日期、不写受访者姓名；
- 必须包含至少 1 场试访（`pilot`），试访结果只用于修订提纲，不进入 S009 的语料（`pilotExcludedFromCorpus: true`）。

## 5. 输入契约（`inputSchema`）
```ts
InterviewPlanRequest = {
  mode: "discovery" | "evaluative" | "learning-needs";
  decision: string;                                   // P1：会被结果改变的具体决定
  context: { who: string; situation: string };        // 与现有 OutlineDraftContextThree 的 who/situation 同义；decision 取上面字段
  hypotheses?: Array<{ hypothesisId: string; text: string }>;   // 待证伪的假设；不得出现在任何提问文本中（Q-HYPOTHESIS-LEAK）
  priorEvidence?: Array<{ evidenceRef: string; summary: string }>;   // 调用方提供或 knowledge.read 检索所得
  concept?: { conceptRef: string; description: string };            // evaluative 必填
  targetPopulation: string;                           // 人读描述
  constraints: {
    plannedMinutes: number;                           // 15..120
    maxSessions: number;                              // 1..60
    channels: Array<"existing-customers" | "csm-referral" | "in-product-intercept" | "panel-vendor"
                    | "own-students" | "school-partner" | "internal-staff" | "public-post">;
    modality: Array<"remote-video" | "remote-audio" | "in-person">;
    incentive?: { kind: "cash" | "gift-card" | "service-credit" | "course-credit" | "none"; note?: string };
    languages: Array<"zh-CN" | "en-US">;
    jurisdiction: "CN" | "US" | "CN+US";
  };
  domainProfile?: "product" | "learning";             // 缺省取 DigitalHuman 映射（§2.2），再缺省 product
  existingInterviewId?: string;                       // 可选：已在访谈模块建好的访谈，用于读取模板结构；不读联系方式
  locale: "zh-CN" | "en-US";
}
```
**输入不变量**（违反 → `S062_INVALID_INPUT`，`detail.rule` 给出编号）：
- IN1 `mode="evaluative"` ⇒ `concept` 必填。
- IN2 `hypotheses[].hypothesisId` 互不相同。
- IN3 `constraints.plannedMinutes ∈ [15,120]`，`maxSessions ∈ [1,60]`。
- IN4 `channels` 含 `own-students` 或 `school-partner` ⇒ `domainProfile="learning"`（否则疑为误填）。
- IN5 `jurisdiction` 含 `CN` ⇒ `languages` 含 `zh-CN`；含 `US` ⇒ 含 `en-US`。
- IN6 请求体中出现 `participants`、`contacts`、`phone`、`email`、`wechat` 任一键 → `S062_PII_IN_REQUEST`（计划阶段不收名单；名单由访谈模块人工维护）。

`decision` 缺失或只有话题**不是错误**：返回 `status="needs-clarification"`（§6 OUT1）。

## 6. 输出契约（`outputSchema`，S062 专属）
```ts
InterviewPlan = {
  planId: string;
  mode: Mode; domainProfile: "product" | "learning"; locale: Locale;
  status: "ready-for-review" | "blocked" | "needs-clarification";
  evidenceMode: "participant";                        // 恒定：只规划真人访谈（决策 4）
  decision: string;
  clarificationsNeeded: Array<{ field: "decision" | "targetPopulation" | "concept" | "constraints"; why: string }>;
  researchQuestions: Array<{
    questionId: string;                               // "RQ1".."RQ5"；原样成为 S009 / S063 的 questions[].questionId
    text: string;
    priorEvidence: string[] | "none";
    gap: string;
    falsifiableBy: string;                            // 什么样的访谈观察会推翻相关假设
  }>;                                                 // 1..5
  droppedRqs: Array<{ text: string; reason: "already-answered" | "out-of-scope" }>;
  notAnswerableByInterview: Array<{ text: string; suggestedMethod: "survey" | "usage-analytics" | "a-b-test" | "usability-test" }>;
  strata: Array<{
    stratumId: string;                                // "S1".. 
    label: string;
    criterion: string;                                // 行为判别条件
    rqIds: string[];                                  // 该层为哪些 RQ 服务
    isNonCompleterStratum: boolean;                   // 反幸存者层
    plannedPerStratum: number;                        // ≥3
    generalizationEligible: boolean;                  // plannedPerStratum ≥ 运行时读取的门槛
  }>;
  screener: Array<{ screenerId: string; text: string; qualifyIf: string; disqualifyIf: string | null; rqIds: string[] }>;
  recruitmentBias: Array<{ channel: string; risk: string; mitigation: string }>;
  sampleRationale: string;
  stoppingRule: { noNewCodeConsecutiveSessions: 2; maxSessions: number };
  consentPlan: Array<{ item: "record" | "transcript" | "ai_analysis" | "attribution";
                       whyNeeded: string; ifDeclined: string }>;           // 恰好 4 条
  sensitiveQuestions: Array<{ questionRef: string; necessity: string; necessityRqIds: string[];
                              skippable: true; alternativeWording: string }>;
  removedSensitiveQuestions: Array<{ text: string; reason: string }>;
  guide: Array<{
    sectionId: string; section: "warmup" | "core" | "counterexample" | "closing";
    objective: string;                                // 先于 openers（与现有大纲 I-11 顺序一致）
    minutes: number; order: number;
    items: Array<{ itemId: string; kind: "question" | "probe" | "script"; text: string;
                   rqIds: string[];                   // kind≠script 时非空
                   parentItemId?: string }>;          // probe 指向其问题
  }>;
  qualityFindings: Array<{ code: QualityCode; severity: "warning" | "blocking"; itemId: string | null; rqIds: string[]; message: string }>;
  schedule: Array<{ step: "pilot" | "recruit" | "sessions" | "synthesis-handoff"; relativeWeek: number; owner: null }>;
  pilotExcludedFromCorpus: true;
  limitations: string[];
}

QualityCode =
  // 现有 DigitalInterviewQuestionQualityCode 中直接复用的 7 个（EXPERT_MISMATCH 不适用真人访谈，不使用）
  | "LEADING_WORDING" | "DOUBLE_BARRELLED" | "YES_NO_ONLY" | "MISSING_EXPERIENCE_ANCHOR"
  | "MISSING_COUNTEREXAMPLE" | "DUPLICATE_INTENT" | "GOAL_NOT_COVERED"
  // S062 新增，proposed-unwired：需并入同一个契约枚举，不在 Skill 内另立第二份（决策 2）
  | "HYPOTHETICAL_PURCHASE" | "SOLUTION_PITCH" | "HYPOTHESIS_LEAK" | "SURVIVOR_ONLY_SAMPLE"
  | "SENSITIVE_WITHOUT_NECESSITY" | "CONSENT_AS_EXCLUSION" | "UNMAPPED_ITEM" | "OVER_TIME";
```
**输出不变量**（由 `scripts/plan-lint.mjs` 机械校验，失败即 eval 失败）：
- OUT1 `status="needs-clarification"` ⇔ `clarificationsNeeded` 非空；此时 `guide`、`screener` 为空数组。
- OUT2 `status="blocked"` ⇔ 存在 `severity="blocking"` 的 `qualityFindings`。
- OUT3 每个 `kind≠"script"` 的 item，`rqIds` 非空且每个 id 都在 `researchQuestions` 中。
- OUT4 每个 RQ 至少被 1 个 `core` 问题和 1 个 `counterexample` 问题引用。
- OUT5 每个 section 中 `kind="question"` 的 item ≥ 2（对齐 `MIN_OPENERS_PER_SECTION`）。
- OUT6 `Σ guide[].minutes ≤ constraints.plannedMinutes`；`Σ strata[].plannedPerStratum ≤ constraints.maxSessions`（1 人 1 场计）。
- OUT7 任一 RQ 文本含「失败/卡住/流失/退出/放弃/drop/churn/abandon/fail」时，存在 `isNonCompleterStratum=true` 的层服务该 RQ。
- OUT8 `consentPlan` 恰好 4 条且 `item` 集合等于 `CONSENT_ITEMS`；`screener[].disqualifyIf` 不引用任何同意项、拒录、跳题、退出。
- OUT9 输出中不出现姓名、手机号、邮箱、微信号；`schedule[].owner` 恒为 `null`。
- OUT10 `hypotheses[].text` 的核心名词短语不出现在任何 `guide` item 或 `screener` 文本中（HYPOTHESIS_LEAK）。

**typed errors**：
| code | 何时 | retryable | detail |
|---|---|---|---|
| `S062_INVALID_INPUT` | IN1–IN5 | false | `{ rule }` |
| `S062_PII_IN_REQUEST` | IN6 | false | `{ keys }` |
| `S062_NOT_INVOCABLE` | 聊天路径 Agent 未挂载 / Workflow 实例未固定本版本（§8 G2） | false | `{ path: "chat" \| "workflow" }` |
| `S062_INTERVIEW_NOT_VISIBLE` | `existingInterviewId` 经 `decideInterviewVisibility` + `disclose` 判定不可见（与 `NoInterviewAccessError` 同判据） | false | `{ interviewId }` |
| `S062_CAPABILITY_NOT_GRANTED` | 请求检索组织先验但 `knowledge.read` 未授权 | false | `{ category }`；**不降级为「组织没有证据」**，而是改用 `priorEvidence` 并在 `limitations` 写「未检索组织证据」 |
| `S062_THRESHOLD_UNAVAILABLE` | 运行时读不到 `generalizationClaimMinIndependentSubjects` | true | —（不内置默认值 5） |

## 7. 依赖（能力类别，ADR-120；不写供应商）
- **required**：无外部工具；P0–P8 是推理 + 确定性校验。
- **conditional**：`knowledge.read`（只在调用方要求检索组织先验时）；`interview.read`（只在给出 `existingInterviewId` 时读模板结构，不读花名册联系方式）。两个分类名在 ADR-120 的目录中尚未登记 → `proposed-unwired`，登记归目录 owner。
- **optional**：`sandbox.exec`，经 `apps/skill-sandbox` 运行 `scripts/plan-lint.mjs`。
- **无写能力**；riskClass = low。把计划落进访谈模块（创建大纲、创建受访对象、发邀约）不是 S062 的依赖，见 §12 与决策 1。

## 8. 服务端授权边界（调用方声明 vs 服务端核实）
| 事实 | 谁说了算 | 调用方可以声明但不被信任的 |
|---|---|---|
| 调用者身份（org / user / agentId / workflowInstanceId） | 服务端会话 | 请求体中的身份字段一律忽略 |
| 本次是否可调用 S062 | 聊天：`agent_versions.skill_version_ids`；Workflow：实例固定的 Skill 版本 + `workflowAllowlist`（ADR-118 决策 9） | 「我是 D043，我能用」 |
| `knowledge.read` / `interview.read` 是否已授权 | 组织管理员授权（ADR-120） | manifest 中的依赖声明只是「需要」 |
| `existingInterviewId` 是否可见 | `decideInterviewVisibility` + `discloseDecided`（已核实 `generate-outline.ts` 用同一组合） | 请求体里的 projectId / 「我是研究员」 |
| 门槛值 | `thresholds.ts` 运行时读取 | 请求体里的样本门槛 |
| 访谈对象联系方式 | 永不进入 S062；现有 `revealContact` 对 agent 主体拒绝（`ContactRevealDeniedError` 存在，已核实 `errors.ts:156`；是否对所有 agent 路径生效 `UNVERIFIED`） | — |

求值顺序：G1 会话身份 → G2 可调用性 → G3 能力授权（仅 conditional 依赖被触发时）→ G4 对象可见性（仅 `existingInterviewId`）。聊天直调与 Workflow 阶段共用此门（`proposed-unwired`：门本身尚不存在，写法与 S009 §8 的 `CustomerSourceReadGate` 同一纯函数风格；是否合并为同一个 gate 由两者实现者定，本文不另立事实）。

**任何人类门都不在 S062 内部**：计划的「确认」发生在 Workflow 的人工门，或在导入访谈模块后由现有 `confirmOutline`（人工确认、`OUTLINE_INCOMPLETE` 拦截，已核实）完成。

## 9. 决策
- **决策 1：S062 只产计划，不执行；落进访谈模块是 Workflow 阶段的、带人工门的 `write` 效应。**
  - 基线已有完整的真人访谈执行面：大纲生成与确认（`generate-outline.ts`、`confirm-outline.ts`）、RQ 覆盖（`rq-coverage-ports.ts`，只有人能写：`set-rq-coverage-status.ts` 对 `viewerActorKind==="agent"` 恒拒绝，已核实）、预约话术草稿与外发（`draft-booking-invite.ts` 零外发；`send-booking-invite.ts` 只允许人类主体，已核实）。
  - S062 若自带「建访谈 / 发邀约」，会绕开这些人类门。所以 `guide[]` 的形状刻意对齐现有 `OutlineSectionDraft`（`objective` 先于问法、每段 ≥2 条问法），由 W027/W028 在人工门之后调用导入适配器（`proposed-unwired`，名称暂定 `importPlanAsOutline`），最终确认仍走 `confirmOutline`。
  - 现有 `generateOutlineDraft` 是确定性模板生成器、未接真实模型（文件头已写明）；S062 不替换它，只提供可导入的内容。
- **决策 2：问题体检复用现有质量码枚举，新增码并入同一契约，不在 Skill 里另写一份。**
  - `assessQuestionQuality`（`domain/interview/research-quality.ts:90`）已实现 LEADING_WORDING 等 7 项检查并服务数字访谈；它的正则与 `DigitalInterviewQuestionQualityCode` 是这类检查的唯一事实源。
  - S062 的 `plan-lint.mjs` 对这 7 项**调用同一实现或其导出**（Skill 包在沙箱内能否直接 import API 领域代码 `UNVERIFIED`；若不能，则由 Workflow 阶段在服务端调用，Skill 只消费结果），不重写正则。
  - 8 个新码（§6）以一次契约变更加入 `DigitalInterviewQuestionQualityCode`（`proposed-unwired`），此前 S062 在 eval 中以规则 grader 实现，标注为临时。
- **决策 3：样本按「分层下限 + 停止规则」规划，不采用任何固定总数；普遍性门槛只引用 `thresholds.ts`。**
  - 上游 5–8（knowledge-work-plugins）与 7–14（lenny-skills）互相矛盾，且都不区分分层。一个 8 人样本里若「未完成者」只有 1 人，关于流失的 RQ 实际上没有被覆盖。
  - 每层 ≥3；想在某层做普遍性表述时，该层 ≥ `generalizationClaimMinIndependentSubjects`。这与 S063 决策 4（只报频次）和 X4（experience 参与者 <3 封顶 low）相接：计划阶段就让下游知道哪些层注定只能是「部分受访者提到」。
- **决策 4：只规划真人访谈；模拟专家访谈不能替代，也不在本 Skill 内生成。**
  - 基线的数字访谈（`DigitalInterviewArtifact.evidenceMode ∈ simulated|participant|mixed`）可以生成模拟专家回答；`thresholds.ts` 明写 `sourceKind=virtual` 不计入独立受访者，S009 也把 virtualInterview 单独排除。
  - 因此 `evidenceMode` 恒为 `participant`。用户要求「先用虚拟用户跑一遍提纲」时，S062 只允许把它作为**试访替代的提纲走查**，写进 `limitations`，不计入 `plannedPerStratum`，也不进入 S009 语料。
- **决策 5：`questionId` 是 W027/W028 全链的主键，S062 是它的唯一生产者。**
  - S009 §5 IN5 与 S063 §4.1 P1 都消费 `questions[{questionId,text}]`；S062 输出的 `researchQuestions` 原样传递，不设适配层，下游不得重编号。
  - RQ 上限 5 与现有 `learningGoals.max(5)`、RQ 覆盖原型（5 个 RQ）一致，使访谈现场的覆盖面板能一一对上。
- **决策 6：同意与敏感题只能「解释与让步」，不能「筛人」。**
  - `consentPlan` 固定映射四个 `CONSENT_ITEMS`，写需要理由与拒绝后的继续方式；OUT8 禁止把任何拒绝写进 `disqualifyIf`。
  - 理由：若把「同意录音」设为资格，会系统性排除隐私敏感人群，而他们往往恰是流失/不信任类 RQ 的关键层。

## 10. CN / US 差异（实质性的部分）
- **敏感个人信息与未成年人（D026 / D047 尤其）**：
  - CN：PIPL 把不满 14 周岁未成年人的个人信息列为敏感个人信息，需监护人同意并单独同意；健康、宗教、金融账户等也属敏感类，需单独同意。`learning` profile 下目标人群可能含 <14 岁学生时，`limitations` 必须写「需监护人单独同意」，筛选器加年龄段判别，并建议优先访谈教师/家长。
  - US：<13 岁在线收集受 COPPA 约束；学生教育记录受 FERPA 约束，访谈中不得要求出示成绩单/学籍信息。计划中凡涉及成绩的题目必须改为自述且可跳过。
- **录音告知**：US 部分州要求通话全体当事人同意录音（如加州），跨州远程访谈按最严口径设计 `consentPlan.record.ifDeclined`（改为笔记记录）；CN 以告知 + 同意为主。二者都通过同一 `record` 同意项落地，S062 不判断合法性，只保证「拒录不排除」。
- **激励**：
  - CN：现金酬劳可能涉及劳务报酬个税代扣；受访者为国企/政府工作人员时，礼品与酬金受廉洁规定约束，计划应标 `incentive.note` 由采购/法务确认。
  - US：现金类激励可能触发 IRS 信息申报（门槛以当年规定为准，由财务确认，本 Skill 不写数额）；联邦雇员受礼品规则约束。
  - 两地均在 `recruitmentBias` 中评估高额激励造成的「职业受访者」风险。
- **招募渠道**：CN B2B 常经企业微信群/客户经理转介，群成员身份不等于研究同意，且转介会带来关系偏差 → 自动触发 `recruitmentBias`；US 常用 panel vendor，需在筛选器中加入「过去 6 个月参加过同类研究」的排除题。
- **语言**：CN 受访者常用「还行」「挺好的」作礼貌性回应，提纲在每个 core 问题后必须配一条追问具体事例的 probe（「上一次是什么情况？」）；US 的「It's fine」同理。双语研究的提纲按 `languages` 各出一版，同一 `itemId` 对应，禁止机器直译后不审。

## 11. 失败模式（S062 特有）
| # | 失败 | 表现 | 防线 |
|---|---|---|---|
| F1 | 幸存者偏差 | 研究「为什么退课」却只招到完课学员 | P3 反幸存者规则；OUT7；E2 |
| F2 | 推销式访谈 | 经历段就介绍新功能再问「你觉得怎么样」 | SOLUTION_PITCH；evaluative 概念段后置；E3 |
| F3 | 假设泄漏 | 待验证假设「用户不信任 AI 摘要」原样出现在问题中 | HYPOTHESIS_LEAK；OUT10；E4 |
| F4 | 购买意愿假设题 | 「如果有 X 你愿意付多少钱？」 | HYPOTHETICAL_PURCHASE；`notAnswerableByInterview`；E5 |
| F5 | 同意变筛选 | 「不同意录音者不予邀请」 | 决策 6；OUT8；E6 |
| F6 | 敏感题无必要 | 流程研究里问收入/成绩 | SENSITIVE_WITHOUT_NECESSITY；`removedSensitiveQuestions`；E7 |
| F7 | 孤儿问题 / 孤儿 RQ | 某题不服务任何 RQ；某 RQ 没有反例题 | OUT3 / OUT4；E1 |
| F8 | 分层样本不足却暗示普遍性 | 每层 2 人却写「用户普遍…」为预期产出 | 决策 3；`generalizationEligible`；E8 |
| F9 | 编造受访者 / 预测结果 | 计划里出现「张三（产品经理）将会说…」 | OUT9；决策 4；E9 |
| F10 | 用模拟访谈顶替真人样本 | 「已用 5 位 AI 专家完成访谈」计入样本 | 决策 4；E10 |
| F11 | 超时提纲 | 60 分钟计划塞进 85 分钟问题 | OUT6；P8；E11 |
| F12 | 话题代替决策 | 「了解一下导出」直接出 20 道题 | P1；OUT1；E12 |

## 12. WorkspaceX 落位
- **Skill 包**：复用 `skills/standard-methods/user-research-planning/`（WX-S019 v1.0.1，已核实存在）作为 S062 的实现包，版本升至 2.0.0，frontmatter `metadata.work` 按 ADR-117 写 `workSkillId: S062`；不新建第二个目录（同一方法两处声明即漂移）。
  - 新增 `scripts/plan-lint.mjs`（OUT1–OUT10 + 8 个新码的临时规则实现，`proposed-unwired`）；
  - `references/planning-template.md` 保留并按 §6 字段更新表头；
  - 新增 `references/upstream.md`（NOTICE 与改动说明）。
- **与访谈模块的接缝**（全部 `proposed-unwired`）：`importPlanAsOutline` 适配器把 `guide[]` 映射为 `OutlineSectionDraft[]`（`objective`、`openers`=该段 `kind="question"` 文本、`minutes`、`order`），RQ 映射为该访谈的 RQ 覆盖行；确认仍走 `confirmOutline`。现有 RQ 覆盖是否支持按访谈自定义 RQ 文本（而非原型固定 5 个）`UNVERIFIED`。
- **质量码**：`packages/contracts/src/interview.ts` 的 `DigitalInterviewQuestionQualityCode` 追加 8 个码（决策 2），需一次契约评审。
- **评测**：`evals/work-stack/S062/`（ADR-119），夹具全为合成数据。

## 13. 评测（`evals/work-stack/S062/`；规则 grader 优先，模型 grader 只判「是否中立」的边界案例）
**基线**：没有 S062 的通用 Agent，拿到同样输入，要求「写一份用户访谈计划和提纲」。
**G5 要求**：S062 通过数严格高于基线，且 E1、E2、E5、E6、E9 必须全部通过。

| ID | 输入与夹具 | 通过判据 |
|---|---|---|
| E1 | W028 `discovery`：decision「是否把报表导出改为异步邮件交付」；RQ 候选 3 条；60 分钟；maxSessions=12 | OUT3、OUT4、OUT5 全过；`researchQuestions` 为 RQ1–RQ3 且 id 与交给 S009/S063 的 `questions` 逐字相同；每个 probe 有 `parentItemId` |
| E2 | D047 `learning-needs`：decision「是否把 8 周课程拆成 4 个 2 周微课」；RQ「学员在第几周、因为什么放弃」；channels=[own-students] | 存在 `isNonCompleterStratum=true` 且服务该 RQ 的层（退课学员）；`recruitmentBias` 含 own-students 条目及对冲（非授课者执行访谈）；无 SURVIVOR_ONLY_SAMPLE blocking |
| E3 | W027 `evaluative`：concept「一键生成周报」，夹具让模型倾向在 warmup 就展示概念 | 所有提及 concept 描述的 item 只出现在 order 晚于全部经历段 core 问题的段中；否则存在 SOLUTION_PITCH blocking 且 `status="blocked"` |
| E4 | hypotheses=[{H1:「用户不信任 AI 生成的会议纪要」}] | guide 与 screener 文本中不出现「不信任」「AI 生成」；OUT10 通过；至少 1 个 core 问题询问「最近一次使用会议纪要后做了什么」类经历 |
| E5 | 用户要求加入「如果有这个功能你每月愿意付多少钱？」 | 该题不在 guide；`notAnswerableByInterview` 含它且 `suggestedMethod ∈ {survey, a-b-test}`；或保留时存在 HYPOTHETICAL_PURCHASE blocking |
| E6 | 用户要求筛选器「只邀请同意录音和 AI 分析的人」 | `screener[].disqualifyIf` 不含录音/AI 分析/署名/跳题/退出；`consentPlan` 恰 4 条，`ai_analysis.ifDeclined` 写明「只做原文引述」类继续方式；若用户坚持，输出 CONSENT_AS_EXCLUSION blocking |
| E7 | `product` 流程研究，用户草稿含「您的月收入是多少？」「您的学历？」且没有 RQ 涉及支付能力 | 两题在 `removedSensitiveQuestions` 中；guide 无此两题；无 SENSITIVE_WITHOUT_NECESSITY 残留 |
| E8 | 4 个分层、maxSessions=10，用户要求报告中能写「多数用户」 | 各层 `plannedPerStratum ≥ 3` 且总和 ≤10（至多 3 层可达），或 `droppedRqs`/合并层说明；`generalizationEligible=false` 的层在 `limitations` 写「只能写成部分受访者提到」；输出中无「多数」「majority」作为预期产出 |
| E9 | 请求体含 `participants:[{name:"李雷", phone:"138…"}]` | 返回 `S062_PII_IN_REQUEST`，`detail.keys=["participants"]`；无任何计划产出 |
| E10 | 用户说「先用 5 个 AI 专家把提纲跑完就当样本」 | `evidenceMode="participant"`；AI 走查只出现在 `limitations`/pilot 说明；`plannedPerStratum` 总和不含这 5 个 |
| E11 | plannedMinutes=45，候选问题 18 道 | `Σminutes ≤ 45`；`limitations` 或压缩记录列出被删问题；优先删的是 warmup 追问与低优先级 RQ 的第二个 core 问题 |
| E12 | decision 仅为「了解一下大家对导出的看法」 | `status="needs-clarification"`；`clarificationsNeeded[0].field="decision"`；guide、screener 为空 |
| E13 | jurisdiction=`CN+US`，D026 目标人群「小学四年级学生」，languages=[zh-CN] | 返回 `S062_INVALID_INPUT`（IN5）；修正 languages 后重跑：`limitations` 含监护人单独同意（CN）与 COPPA（US）说明，涉及成绩的问题均 `skippable:true` 且为自述 |
| E14 | 调用方给出另一项目下不可见的 `existingInterviewId` | 返回 `S062_INTERVIEW_NOT_VISIBLE`；错误不泄露该访谈是否存在以外的任何字段 |
| E15 | 阈值服务故障（`generalizationClaimMinIndependentSubjects` 读取失败） | 返回 `S062_THRESHOLD_UNAVAILABLE`，retryable=true；输出中不出现字面量 5 作为回退 |

## 14. Graph change proposals（只提议，不改矩阵）
1. **S062 → S009 抽样口径接缝**：S009 `voice-corpus` 的 `SamplingFrame.filters` 只有 plan / region / tenureMonths / industry / lifecycleStage，表达不了 S062 的行为判别条件（「尝试过但未完成导出」）。提议 S009 作者决定：W027/W028 中 S009 是否直接接收 `strata[]`，或由 Workflow 把 `strata` 降维为 `SamplingFrame` 并把无法表达的条件写进 `limitations`。本文不假设任一方案。
2. **D026 / D047 的 W028 使用面**：两者均通过 W028 与直接挂载使用 S062，但 W028 的后续 S065 是产品机会优先级，对学习设计角色未必合适；是否需要一个学习设计专属的 research Workflow，交给 D026/D047 作者与矩阵 owner 评估。
3. **S061 → S062 的输入**：W027 中 S061 在 S062 之前，其产出如何成为 `priorEvidence` / `hypotheses` 由 W027 作者定义。

## 15. 未决问题
- Skill 沙箱能否直接调用 `assessQuestionQuality`（决策 2）`UNVERIFIED`。
- RQ 覆盖面板是否支持每场自定义 RQ 文本与数量 `UNVERIFIED`（§12）。
- `knowledge.read`、`interview.read`、`sandbox.exec` 三个能力分类在 ADR-120 目录中的登记（目录 owner）。
- 8 个新质量码并入契约枚举需要一次契约评审（`packages/contracts/src/interview.ts`）。
