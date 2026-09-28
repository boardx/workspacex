# S010 — Risk Assessment（风险评估）

> Type: Work Skill · Domain: Shared · Strategy: A1（两份上游 artifact 择优改编 + 公共方法标准做参照）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：`main@30c1c4332025151610502988b0379b95ff7298c7`（本文所有 VERIFIED 路径都在该提交上读过；工作树是包含该提交的 merge，已用 `git merge-base --is-ancestor` 确认）。
> 本文独立作者化（AUTHOR-S010）；v1 模板只当话题清单，没有沿用正文。
> 标注约定：**VERIFIED@30c1…** = 已在基线读过该文件；**UNVERIFIED** = 没读过实现，只是推断；**proposed-unwired** = 能力或契约目前不存在或没接线，本文是提案。

## 1. 这个 Skill 解决什么问题
回答的问题是：「这件事（结论、计划、合同、交易、供应商、预测）**可能在哪里出错、出错了多痛、我们凭什么这么判断、谁该在什么信号出现时动手**」。产出是一份**风险登记表**（`RiskAssessment`）。每条风险都写明：可观察的触发信号、似然与后果的**依据**、处置提案，以及谁有权接受这条风险。

边界：
- 不找证据：检索归 S003 或各域检索 Skill。
- 不给证据分级：那是 S171。S010 只**消费** S171 的 `certainty` / `evidenceNeededToUpgrade`，自己不重新打分。
- 不在方案之间做取舍、不给推荐：那是 S012 Decision Brief。S010 只说每条路径的下行面，不说该选哪条。
- **不接受风险**：「接受」「关闭」是人的动作，S010 的输出里只允许 `proposed` 状态（决策 4）。
- 不写对外风险披露文本（例如年报的风险因素章节）。这类文本由 S020 或对应的法务、财务 Skill 起草，S010 只提供登记表。

## 2. 图上的消费者（两张矩阵逐行核对，原样照抄，不推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| 行 | Workflow | 矩阵原文（Exact Skills） | S010 的评估对象（`subjectKind`） | 阶段语义来源 |
|---|---|---|---|---|
| 7 | W001 Research-to-Brief | S003, S063, S171, S020, S010 | `findings` | **已 PASS 的 W001 文档** §5 阶段 5（`audited → risk_scoring → risk_scored`），产出投影成 `RiskNote` |
| 9 | W003 Decision-to-Execution | S012, S154, S142, S010, S143 | `plan` | 该 Workflow 文档还没 PASS，对象类型是本文对矩阵的**预期**，要等 W003 作者确认 |
| 11 | W005 Document Review-to-Approval | S014, S010, S015, S007 | `document` | 同上（S007 草稿把 S010 标成「风险」阶段） |
| 15 | W009 Evidence-to-Recommendation | S003, S171, S063, S012, S010 | `options` | 同上 |
| 20 | W014 Opportunity-to-Close | S023, S032, S036, S029, S031, S010 | `deal` | 同上 |
| 22 | W016 Forecast Review | S031, S030, S035, S033, S010 | `forecast` | 同上 |
| 42 | W036 Cash Forecast | S081, S092, S083, S080, S010 | `forecast` | 同上 |
| 43 | W037 Investment Memo | S094, S095, S088, S089, S097, S010, S098 | `investment` | 同上 |
| 47 | W041 NDA Triage | S104, S010, S117, S107 | `document` | 同上 |
| 51 | W045 Investigation Workflow | S118, S119, S171, S010, S020 | `findings` | 同上 |
| 58 | W052 Request-to-Project | S141, S154, S142, S144, S010 | `plan` | 同上 |
| 59 | W053 Weekly PMO Review | S143, S142, S144, S145, S155, S010 | `plan`（`reassessOf` 必填，见 §4 步骤 8） | 同上 |
| 60 | W054 Vendor Evaluation | S146, S147, S152, S010, S112 | `vendor` | 同上 |

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md，S010 都在 Skill 列）
D001（第 7 行）、D007（13）、D013（19）、D017（23）、D020（26）、D022（28）、D023（29）、D024（30）、D027（33）、D028（34）、D029（35）、D033（39）、D034（40）、D035（41）、D036（42）、D039（45）、D042（48）、D051（57）、D053（59）、D057（63）、D058（64）、D059（65）、D060（66）。

按 ADR-118 第 9 条（VERIFIED@30c1…，`docs/adr/ADR-118-generic-workflow-runtime.md:26`），DigitalHuman 行里的 S010 表示**聊天中可以直接调用**。Workflow 阶段内的 S010 版本由 Workflow 固定，与 Agent 的挂载无关。第一阶段闭包内的消费者是 D001、D007 和 W001、W003、W009、W052、W053、W054 等。凡是出现在 D001–D010 所拥有 Workflow 里的 S010 边，都已包含在上表中。

## 3. 上游来源与许可（G1）
| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins（本地克隆 `scratchpad/upstream/kwp`） | `operations/skills/risk-assessment/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0。`operations/` 目录**没有**单独的 LICENSE，适用仓根 `LICENSE`（已读，Apache-2.0） | **adapt**：借鉴「风险类别清单 + 登记表字段（描述/似然/影响/缓解/负责人/状态）」的骨架。**不采用**它的 `Status: Accepted/Closed` 可由模型填写（决策 4）。不复制原文 |
| 同上 | `legal/skills/legal-risk-assessment/SKILL.md` | 同上 | Apache-2.0（`legal/LICENSE`，已读） | **adapt**：借鉴「严重度锚定到相对价值比例」和「按等级给出升级路径」。**明确拒绝**它的 `Risk Score = Severity x Likelihood` 乘法打分（决策 1）。不复制原文，也不复制它的阈值表 |
| NIST SP 800-30 Rev.1《Guide for Conducting Risk Assessments》（2012） | 公开出版物，未克隆 | n/a | 美国联邦政府作品，US 公有领域 | **reference-only**：只取概念，不复制文字。具体是「威胁源/事件 → 似然 → 影响」分步评估，以及「不确定性要显式记录」 |
| ISO 31000:2018 / GB/T 24353-2022（风险管理 指南） | 付费标准，未取得全文 | n/a | 版权受保护 | **reference-only**：只引用标准名和公共术语（识别、分析、评价、处置），**不引用、不转述条文** |

两个 kwp 上游都假设模型直接产出「最终风险等级与状态」，也都没有要求「似然依据」。WorkspaceX 有 S171 的证据分级（已 PASS，`skills/S171-evidence-review.md`）。所以 S010 规定：似然必须挂靠 S171 的主张或明确标为判断（步骤 4），这一点比两个上游都严格。

SKILL.md 的 `references/upstream.md` 要按 Apache-2.0 §4 记录 NOTICE，并写明「adapted, not copied」。

## 4. 专业方法（S010 专属步骤）
1. **定评估对象与评价准则，再识别风险。** 先回显 `subjectKind`、`horizon`（风险窗口，例如「本季度」「合同期 3 年」）和 `materialityBasis`（严重度锚定的数值基准：交易额、合同额、预测收入、项目预算），然后才开始列风险。没有 `materialityBasis` 时，severity 只能用定性锚，并在输出中标 `severityAnchoring: "qualitative"`。这样做是为了避免「高后果」没有参照物。
2. **按对象类型用专门的识别线索，不用通用六类清单硬套。**
   - `findings` / `options`：对每条被采纳的主张问「如果它是错的会怎样」（反事实）。对每个 `unknown` 问「最坏的合理取值是什么」。
   - `plan`：看关键路径依赖、单点人员、外部审批、资源冲突。
   - `document`：看偏离标准条款的地方（责任上限、赔偿、管辖、保密期、数据处理）。
   - `deal` / `forecast`：看集中度（单客户或单产品占比）、历史滑单率、假设敏感性。
   - `investment`：看估值假设、退出路径、监管审批。
   - `vendor`：看单一来源、财务稳健、数据访问、交付连续性。
   识别出的每条风险必须写成「**原因 → 事件 → 后果**」三段式（`cause` / `event` / `consequence`）。三段缺一段就不算一条风险，要退回改写。
3. **合并同源风险。** 两条风险如果共享同一个 `cause`（例如「核心供应商 A 停产」同时导致交付延期和成本上升），就归入同一个 `commonCauseClusterId`。风险数量只按 cluster 计，**聚合时不重复计算**（失败模式 F4）。
4. **给似然定档，必须带依据。**
   - `likelihood ∈ {low, medium, high}`，每条都要有 `likelihoodBasis`。它的取值是 `evidence`（挂 S171 的 `claimId` 或输入证据 id）、`base-rate`（给出历史频率与出处，例如「过去 8 个季度中 3 个季度滑单 >20%」），或 `judgment`（只有模型或用户的判断）。
   - 规则 L1：`judgment` 类的似然**最高只能是 `medium`**。
   - 规则 L2：如果依据挂的 S171 主张 `certainty ∈ {very-low, insufficient}`，这条风险要同时标 `epistemic: true`。意思是「我们不知道」本身就是风险，而不是「低似然」。
5. **给后果定档，锚定到基准。**
   - `severity ∈ {low, medium, high}`。有 `materialityBasis` 时，按组织策略给出的比例阈值定档（阈值来自服务端，见 §6，调用方不能放宽）。
   - 严重度要分维度记录：`financial` / `schedule` / `regulatory` / `reputational` / `safety` / `data`。**整体档取各维度的最高档，不取平均。**
   - `safety` 维度只要非 low，整条风险的 severity 至少是 `medium`。
6. **查表定级，不做乘法。** `level` 由固定 3×3 查找表给出（决策 1）：

   | likelihood \ severity | low | medium | high |
   |---|---|---|---|
   | high | medium | high | critical |
   | medium | low | medium | high |
   | low | low | low | medium |

   另有例外规则 X1，写成确定性函数：`level = (epistemic && severity==="high") ? max(table(likelihood,severity), "high") : table(likelihood,severity)`，其中 `max` 按 `low<medium<high<critical` 取序。即只会把表值 medium 抬到 high；表值已是 critical 时保持 critical，**不降**。理由是后果严重而我们不知道似然，不能因为「似然 low」被压成 medium。
7. **给处置提案和触发信号。**
   - `treatment ∈ {avoid, reduce, transfer, accept-proposed}`。
   - `level ≥ medium` 的风险必须有至少 1 个 `trigger`，形式是「可观察指标 + 阈值 + 检查频率」（例如「供应商 A 的准时交付率 <90%，每周看」）。「密切关注」这类没有指标的写法不合格。
   - `reduce` 要写明降的是似然还是后果，以及降到哪一档（`targetLikelihood` / `targetSeverity`）。
8. **复评（`reassessOf` 非空时）。** 输入上一版登记表的 id。每条旧风险必须落在 `unchanged` / `raised` / `lowered` / `retired-proposed` / `materialized` 中的一种，并写明变化依据。新风险标 `new`。**不允许**旧风险悄悄消失（失败模式 F6）。这一步是 W053 Weekly PMO Review 的核心用法。
9. **指定升级路径，不指定人的决定。** 按服务端给出的组织风险偏好（`riskPolicy`），给出每条风险的 `acceptanceAuthority`（例如「项目 owner」「部门负责人」「管理层」）。`owner` 只能取服务端解析出的项目成员（`userId`），或者留空并标 `ownerNeeded: true`。**不允许**编造人名。

## 5. 输入契约（`inputSchema`，写入 WorkSkillManifest——manifest 本身 proposed-unwired，ADR-117 状态为 Proposed）
```ts
const S010Input = z.object({
  subjectKind: z.enum(["findings","options","plan","document","deal","forecast","investment","vendor"]),
  subjectRef: z.object({                    // 至少给一种
    evidenceReviewReportId: z.string().optional(), // 仅作谱系标签（Workflow 阶段产出引用），S010 不按它取回报告
    artifactId: z.string().optional(),             // 文档/计划/备忘录
    projectId: z.string().optional(),
  }).refine(r => !!(r.evidenceReviewReportId || r.artifactId || r.projectId), "S010_NO_SUBJECT"),
  evidenceReviewReport: EvidenceReviewReportSchema.optional(), // S171 §6 报告对象，由 Workflow 内联传入；findings/options 必填
  unknowns: z.array(z.object({ itemId: z.string(), why: z.string() })).default([]), // W001 映射自 Brief.unknowns
  options: z.array(z.object({ optionId: z.string(), label: z.string().max(120) })).max(5).optional(), // 仅 options
  horizon: z.string().min(1).max(60),       // 例如 "2026-Q4" / "contract-term-36m"
  materialityBasis: z.object({ metric: z.string(), amount: z.number().positive(), currency: z.enum(["CNY","USD"]) }).optional(),
  jurisdictions: z.array(z.enum(["CN","US"])).min(1).default(["CN"]),
  reassessOf: z.string().optional(),        // 上一版 RiskAssessment id；W053 必填
  maxRisks: z.number().int().min(1).max(15).default(10),
  // 以下为调用方「声明」，服务端不信任，见 §6
  claimedAudienceTier: z.enum(["self","team","org","board","regulator","external_partner"]).optional(),
  requestedStricterAppetite: z.boolean().default(false),
}).strict();
```
不变量（输入）：
- I-in-1：`subjectKind ∈ {findings, options}` 时，`evidenceReviewReport`（内联对象）必填。

**S171 报告的传递方式（B2 定案）：** 已 PASS 的 S171 `EvidenceReviewReport`（S171 §6）没有 id 字段，也没有存储/取回路径，因此 S010 **不按 id 取回报告**，而是由 Workflow 把上一阶段 S171 的输出对象原样内联到 `evidenceReviewReport`（与 W001「阶段 4 之后只看 S171 报告」一致）。`EvidenceReviewReportSchema` 直接复用 S171 §6 的 schema，不另起字段。`evidenceReviewReportId` 若提供，只是 Workflow 运行时给该阶段产出物分配的引用，用于 I-in-3 谱系与审计，S010 不解引用它；该阶段产出引用机制本身 **proposed-unwired**（Generic Workflow runtime，ADR-118 为 Proposed）。报告中各 claim 的读权限由 S171 上游的 accessibleAt 纪律负责，S010 不重新取回。
- I-in-2：`subjectKind = options` 时，`options.length ≥ 2`。
- I-in-3：`reassessOf` 指向的登记表必须属于同一 `projectId` 或同一 `evidenceReviewReportId` 谱系。

## 6. 服务端授权边界（调用方声明 vs 服务端核实）
| 事实 | 调用方可以声明什么 | 服务端以什么为准 | 现状 |
|---|---|---|---|
| 执行身份 | 不接受输入 | Agent run 的 actor（人或 DigitalHuman 的委托主体） | 运行身份机制存在，但 S010 的接入是 **proposed-unwired** |
| 组织、项目 | `projectId` | actor 是否可读该项目（`wx_project_read`，L0，VERIFIED@30c1… `apps/api/src/domain/agent-run/tool-risk-tier.ts`）；不可读 → `S010_SUBJECT_NOT_READABLE` | 工具存在；S010 调用 proposed-unwired |
| 证据可读性 | `evidenceReviewReport`（内联）、`artifactId` | 以 actor 重读引用来源；在跨越人类门或超过 TTL 时，经 `apps/api/src/application/context-pack/verify-citation.ts` 重验（VERIFIED@30c1… 文件存在，接线方式 UNVERIFIED） | S010 只读 S171 报告，报告本身沿用上游 accessibleAt 纪律（S003 决策 1） |
| 风险偏好 / 严重度阈值 / 升级路径 | 只能声明 `requestedStricterAppetite=true` | 组织 `riskPolicy`（阈值比例、`level → acceptanceAuthority` 映射）。调用方**只能收紧、不能放宽** | **proposed-unwired**：仓库里没有组织级风险策略存储（在基线上 `git grep -n riskRegister\|RiskRegister\|risk_register -- apps packages` 零命中）。缺失时用 §7 默认表，并在输出中写 `appetiteSource:"platform-default"` |
| 受众层级 | `claimedAudienceTier` | Workflow 实例记录的 `audienceTier`（W001 由 G1 确认）。S010 只把它**回显**为 `audienceTierEcho`，不用它做任何放行判断 | Workflow 侧字段 proposed-unwired |
| owner | 不接受自由文本人名 | 项目成员列表中的 `userId` | proposed-unwired |

S010 本身不声明任何写能力，riskClass = low。按 `tool-risk-tier.ts`，它只会用到 L0 工具。受众脱敏不在 S010 内完成：每条风险记录 `derivedFromSourceIds`，由 Workflow 的分发前校验（W001 的 P4）决定对哪个收件人去掉哪条。S010 不猜测受众权限。

## 7. 输出契约（`outputSchema`，S010 专属）
```ts
const Level3 = z.enum(["low","medium","high"]);
const RiskEntry = z.object({
  riskId: z.string(),                         // "R1".. 在本登记表内唯一
  commonCauseClusterId: z.string(),
  cause: z.string().max(200), event: z.string().max(200), consequence: z.string().max(200),
  category: z.enum(["operational","financial","compliance","strategic","reputational","security","safety","epistemic"]),
  appliesToOptionIds: z.array(z.string()).optional(),   // 仅 options
  likelihood: Level3,
  likelihoodBasis: z.object({
    kind: z.enum(["evidence","base-rate","judgment"]),
    claimIds: z.array(z.string()).default([]),          // S171 claims[].claimId
    baseRate: z.string().max(200).optional(),
  }),
  epistemic: z.boolean(),
  severity: Level3,
  severityByDimension: z.record(z.enum(["financial","schedule","regulatory","reputational","safety","data"]), Level3),
  severityAnchoring: z.enum(["materiality-basis","qualitative"]),
  level: z.enum(["low","medium","high","critical"]),
  treatment: z.enum(["avoid","reduce","transfer","accept-proposed"]),
  treatmentDetail: z.string().max(300),
  targetLikelihood: Level3.optional(), targetSeverity: Level3.optional(),
  triggers: z.array(z.object({ indicator: z.string(), threshold: z.string(), cadence: z.enum(["daily","weekly","monthly","milestone"]) })),
  owner: z.string().nullable(), ownerNeeded: z.boolean(),
  acceptanceAuthority: z.string(),
  status: z.literal("proposed"),
  whatWouldChangeIt: z.string().max(200),     // 可取自 S171 evidenceNeededToUpgrade
  derivedFromSourceIds: z.array(z.string()),
  jurisdictionNotes: z.array(z.object({ jurisdiction: z.enum(["CN","US"]), note: z.string().max(240) })).default([]),
  reassessment: z.enum(["new","unchanged","raised","lowered","retired-proposed","materialized"]).optional(),
  reassessmentReason: z.string().max(200).optional(),
});
const RiskAssessment = z.object({
  assessmentId: z.string(), subjectKind: z.string(), horizon: z.string(),
  appetiteSource: z.enum(["org-policy","platform-default"]),
  audienceTierEcho: z.string().nullable(),
  risks: z.array(RiskEntry),
  truncated: z.object({ omittedCount: z.number().int(), omittedMaxLevel: z.enum(["low","medium"]) }).nullable(),
  carriedForward: z.array(z.object({ previousRiskId: z.string(), mappedTo: z.string() })).default([]), // reassessOf 时
  warnings: z.array(z.enum(["APPETITE_DEFAULTED","SEVERITY_QUALITATIVE","OWNER_UNRESOLVED","EVIDENCE_CERTAINTY_LOW"])),
});
```
**不变量（机械可校验，全部写进 G2 schema 测试）：**
- I1：`level === ((epistemic && severity==="high") ? max(table(likelihood,severity),"high") : table(likelihood,severity))`（§4 步骤 6，单一期望值）。
- I2：`likelihoodBasis.kind = "judgment"` ⇒ `likelihood ≠ "high"`。
- I3：`likelihoodBasis.kind = "evidence"` ⇒ `claimIds.length ≥ 1`，并且每个 id 都存在于内联输入 `evidenceReviewReport` 的主张列表中（纯内存比对，无取回）。
- I4：`level ≥ medium` ⇒ `triggers.length ≥ 1`。
- I5：`severity` 等于 `severityByDimension` 各值中的最大值；`safety ≠ low` ⇒ `severity ≥ medium`。
- I6：`status` 恒为 `"proposed"`。输出中不存在 `accepted` / `closed`。
- I7：`reassessOf` 非空 ⇒ 上一版每个 `riskId` 都恰好出现在 `carriedForward` 中一次。
- I8：按 cluster 去重后的条数 ≤ `maxRisks`。被截掉的风险只能是 `level ≤ medium`，并记入 `truncated`。`high` / `critical` 永不截断；如果它们本身就超过 `maxRisks`，报 `S010_TOO_MANY_HIGH_RISKS`。
- I9：`owner` 非空 ⇒ 它是服务端解析出的项目成员 `userId`；否则 `ownerNeeded = true`。

**W001 投影（对齐已 PASS 的 W001 §6 `RiskNote`，不另起枚举）：**
`RiskNote = { claimId: likelihoodBasis.claimIds[0] ?? null, description: event + "→" + consequence（≤240 字）, likelihood, severity, whatWouldChangeIt }`。排序规则是：先放 `severity=high ∧ likelihood≥medium` 的，再按 `level` 降序；取前 5 条。这样 W001 §5 阶段 5「必须在 `risks[0]`」的要求可以直接满足。`critical` 在 `RiskNote` 里没有对应档位，投影时 level 信息会丢失，但排序已经把它放在最前面。

## 8. 类型化错误
| code | 条件 | 行为 |
|---|---|---|
| `S010_INPUT_INVALID` | zod 校验失败 / 违反 I-in-1…3 | 拒绝，不产出 |
| `S010_NO_SUBJECT` | `subjectRef` 三项全空 | 拒绝 |
| `S010_SUBJECT_NOT_READABLE` | actor 读不到项目或 artifact（S171 报告为内联输入，不在此检查） | 拒绝；**不**降级为「无风险」 |
| `S010_EVIDENCE_REF_UNRESOLVED` | 候选输出中的 `claimIds` 不在内联 `evidenceReviewReport` 里 | 模型重试 1 次，仍失败则拒绝（防止编造依据） |
| `S010_TOO_MANY_HIGH_RISKS` | 去重后 high/critical 的数量 > `maxRisks` | 返回错误，附上 high/critical 的数量；由 Workflow 决定拆分范围还是提高上限 |
| `S010_REASSESS_LINEAGE_MISMATCH` | 违反 I-in-3 | 拒绝 |
| `S010_REASSESS_BASE_MISSING` | `reassessOf` 指向的版本不存在或不可读 | 拒绝；**不**当成首评（否则旧风险会静默消失） |

`APPETITE_DEFAULTED` 等只作为 `warnings` 出现，不是错误。

## 9. 依赖（能力分类，ADR-120；分类名是提案，`capabilityCategory` 在基线上零命中 → proposed-unwired）
- required：无。可以纯推理运行（W001 阶段 5 的工具列为 `—`）。
- optional：`project.read`（解析 owner 和成员）、`knowledge.read`（只用于读 `artifactId` 指向的文档正文，`document` / `vendor` / `investment` 需要）、`org.policy.read`（读 `riskPolicy`，proposed-unwired）。
- optional 分类未授权时写 warning，不换供应商静默重试（ADR-120 第 3 条，VERIFIED@30c1…）。

## 10. 决策
- **决策 1：用 3×3 查找表定级，不用「严重度 × 似然」乘法打分。** kwp legal 上游用的是 5×5 乘积分数。序数量表相乘会产生伪精度：「4×3=12」和「3×4=12」同分，但处置含义不同。乘法还会让「后果极重、似然低」的风险被平均掉。三档还对齐了已 PASS 的 W001 `RiskNote`（low/medium/high），避免同一个量表在两处声明两种粒度。代价是区分度较低，由例外规则 X1 和按维度记录严重度来弥补。
- **决策 2：似然必须挂依据；纯判断的似然最高只能是 medium。** WorkspaceX 已经有 S171 的证据分级。如果 S010 允许无依据地判 high，下游 Brief 的首屏风险就可能完全来自模型臆测。反过来，「证据弱」不等于「似然低」，所以另设 `epistemic` 标志和例外规则 X1，防止无知被当成安全。
- **决策 3：一个 Skill 覆盖 13 个 Workflow，用 `subjectKind` 分派识别线索，不拆成 13 个领域风险 Skill。** 定级、依据、触发信号、复评、授权这五件事在所有消费者之间都相同。拆开会让查找表和不变量出现多份副本（AGENTS.md 明令禁止同一事实两处声明）。领域差异只在步骤 2 的识别线索和 §11 的法域注记。法律特权问题见 §13 提议 1，留给图的 owner 判断。
- **决策 4：S010 永远只输出 `proposed`；接受风险、关闭风险都是人的动作。** kwp operations 上游的登记表把 `Accepted/Closed` 当成普通字段。在 WorkspaceX 里，接受风险相当于一次授权决策，必须经过 Workflow 的人类门或风险 owner 的操作。S010 只写 `acceptanceAuthority`，也就是「应该由谁来接受」。
- **决策 5：风险偏好由服务端提供，调用方只能收紧。** 如果阈值可以由调用方传入，就可以通过「把 high 的门槛调高」让风险消失。在组织策略存储落地之前，使用平台默认表并显式写 `APPETITE_DEFAULTED`。平台默认的比例阈值是：financial 占 `materialityBasis` 的 <1% 为 low，1–5% 为 medium，>5% 为 high。这组数值只在本节声明一次，实现时写进 SKILL.md 的 `references/risk-policy-default.md`，并由测试引用该文件。
- **决策 6：复评必须显式交代每条旧风险的去向。** W053 每周都会跑。如果每次都从零评估，旧风险会在措辞变化中悄悄消失。不变量 I7 和错误码 `S010_REASSESS_BASE_MISSING` 把「不许消失」变成可以机械校验的规则。

## 11. CN / US 差异（只列实质性的）
- **法律特权**：在 US，律师与客户之间的特权（attorney-client privilege）和律师工作成果（work product）可以保护为获取法律意见而做的风险分析。在 W041 / W045 里，如果由法务发起，登记表可能需要标注特权并限制分发。CN 没有等价的、宽泛的律师—客户特权保护，**不能假设**登记表可以免于调取或披露。所以当 `jurisdictions` 包含 CN 时，`legal` 相关条目的 `jurisdictionNotes` 必须提示「按可能被披露来撰写」。S010 本身不判断特权是否成立。
- **监管后果锚**：
  - CN：`data` / `regulatory` 维度涉及个人信息的，严重度参照《个人信息保护法》第六十六条（最高五千万元或上一年度营业额 5% 的罚款）；国有企业的风险归口参照国资委《中央企业全面风险管理指引》（2006）。
  - US：上市公司的 cyber 风险要考虑 Form 8-K Item 1.05（确定重大性后 4 个工作日内披露），风险因素披露参照 Reg S-K Item 105。
  - 这些只写进 `jurisdictionNotes` 作为锚，**不构成法律意见**，G4 评测只检查它们是否出现，不检查法律结论。
- **跨境投资（W037）**：CN 出境投资涉及发改委 / 商务部备案或核准以及外汇登记（ODI）。US 入境投资可能触发 CFIUS 审查。两者都是「审批不通过 / 延迟」类的 schedule 风险和 regulatory 风险，识别线索要按 `jurisdictions` 分开给出。
- **币种与基准**：`materialityBasis.currency` 只接受 CNY / USD，不做汇率换算。多币种交易由调用方拆开评估。

## 12. 失败模式（S010 特有）
| # | 失败 | 表现 | 防线 |
|---|---|---|---|
| F1 | 乘法伪精度 | 两条处置含义不同的风险得到同分，排序随意 | 决策 1；I1 |
| F2 | 臆测高似然 | 没有任何证据的风险被判 high，登上 Brief 首屏 | I2、I3；决策 2 |
| F3 | 无知被当成安全 | S171 判 insufficient 的关键主张被写成 low 似然 | L2 + X1 |
| F4 | 同源风险重复计算 | 一个停产事件拆成 3 条 high，放大整体风险 | 步骤 3 的 cluster；I8 按 cluster 计 |
| F5 | 无指标的缓解 | 处置写「加强沟通」「密切关注」 | I4：trigger 必须有指标和阈值 |
| F6 | 复评丢风险 | 周会上上周的 high 风险没有交代就消失了 | I7；决策 6 |
| F7 | 模型「接受」风险 | 输出里出现 accepted，下游当成已批准 | I6；决策 4 |
| F8 | 调用方放宽阈值 | 传入宽松的偏好，让风险降档 | 决策 5；§6 |
| F9 | 编造 owner | 写出一个不存在或不在项目里的人名 | I9 |
| F10 | 越界给推荐 | `options` 模式下输出「建议选 B」 | schema 中没有推荐字段；E9 检查自由文本 |

## 13. 评测（`evals/work-stack/S010/`，ADR-119；目录 proposed-unwired；夹具是合成数据）
基线：没有 S010、但拿到相同输入的通用 Agent。G5 要求 S010 的通过数严格高于基线，并且 E2、E3、E6、E8 必须全过。规则 grader 优先，只有 E9 需要 LLM 或人工判定（判据写死如下）。

| ID | 输入与夹具 | 通过判据 |
|---|---|---|
| E1 | W001：S171 报告中主张 C3「竞品 X 将在 Q4 降价 15%」的 certainty=moderate；materialityBasis=年收入 2 亿 CNY；夹具推算影响 8%；报告内联传入；epistemic=false | 存在一条风险，其 `likelihoodBasis.claimIds` 包含 C3；`severityByDimension.financial=high`；`likelihood ≥ medium`；`level === table(likelihood, "high")`（medium→high，high→critical，均判通过）；投影出的 `RiskNote` 位于 `risks[0]` |
| E2 | 同一主题，但没有任何证据，只有 prompt 写「我觉得供应商会涨价」 | 该风险的 `likelihoodBasis.kind=judgment`，`likelihood ≤ medium`（I2） |
| E3 | S171 主张「新规不影响我们」的 certainty=insufficient；若判断错误，后果为 regulatory=high | `epistemic=true`；`level ≥ high`（X1）；`whatWouldChangeIt` 非空 |
| E4 | W054：供应商 A 停产，同时造成交付延期和成本上升 | 两条风险共享同一个 `commonCauseClusterId`；按 cluster 去重后计为 1 |
| E5 | W053：`reassessOf`=上周登记表（R1–R4），本周的项目材料显示 R2 已经发生 | `carriedForward` 恰好覆盖 R1–R4；R2 标为 `materialized`；没有任何旧 id 缺失 |
| E6 | 任意夹具，模型候选输出中含 `status:"accepted"` | schema 校验拒绝（I6）；最终输出只有 `proposed` |
| E7 | W041 NDA：保密期无限、单方赔偿、管辖地为对方所在国；`jurisdictions=["CN","US"]` | 每条 medium 以上的风险都有带指标的 trigger；CN 的 `jurisdictionNotes` 含「按可能被披露撰写」类提示；US 的注记提及特权 |
| E8 | 调用方传入 `claimedAudienceTier="self"`，而 Workflow 记录的是 `board`；另外调用方尝试通过提示词放宽阈值 | 定级使用组织或默认阈值，与提示词无关；`audienceTierEcho` 不影响任何 level；`appetiteSource` 如实填写 |
| E9 | W009 `options` 模式，给出方案 A 和方案 B | 输出中没有「建议 / 推荐 / 应选」类语句（关键词加 LLM 判定）；每条风险都有 `appliesToOptionIds` |
| E10 | W052：owner 字段在夹具中写「王经理」，但项目成员里没有这个人 | 该风险的 `owner=null`，`ownerNeeded=true`（I9） |
| E11 | 夹具中 high 风险有 12 条，`maxRisks=10` | 返回 `S010_TOO_MANY_HIGH_RISKS`，而不是截断掉 high 风险 |
| E12 | W037：CN 企业投资 US 标的，`jurisdictions=["CN","US"]` | 至少分别出现一条 ODI 审批类风险和一条 CFIUS 类风险，category 为 regulatory，维度包含 schedule |

## 14. WorkspaceX 落位
- Skill 包：新建 `skills/standard-methods/risk-assessment/SKILL.md`（proposed-unwired）。它与 `skills/standard-methods/interview-synthesis/`、`user-research-planning/` 同包（这两个目录 VERIFIED@30c1… 存在）。`references/` 下放 `risk-policy-default.md`（决策 5 的唯一声明处）和 `upstream.md`。
- 工具分级：`apps/api/src/domain/agent-run/tool-risk-tier.ts`（VERIFIED@30c1…；`wx_project_read`、`wx_knowledge_read` 在 L0）。
- 引用重验：`apps/api/src/application/context-pack/verify-citation.ts`（VERIFIED@30c1… 文件存在；S010 通过 Workflow 间接使用，调用路径 UNVERIFIED）。
- 运行时就绪计算：`apps/api/src/application/skill/resolve-runtime-context.ts`（VERIFIED@30c1… 文件存在；是否已读取 `dependencies` 字段 UNVERIFIED，按 ADR-117 属 proposed）。
- 冲突契约：S010 不输出冲突，只通过 `claimIds` 引用 S171；`GuidedResearchEvidenceConflict`（VERIFIED@30c1… `packages/contracts/src/research.ts:1022`）不需要扩展。
- 组织风险策略存储、`WorkSkillManifest`、`capabilityCategory`：全部 proposed-unwired。

## 15. Graph change proposals（只提议，不改矩阵）
1. **W041 / W045 的法律特权语境**：S010 在这两个法务 Workflow 中的产出可能需要按特权处理。建议图的 owner 评估是否需要一个法务专用的「legal risk memo」Skill（参照 kwp `legal-risk-assessment` 的升级路径），由它在法务 Workflow 中取代 S010；否则 S010 维持现状，靠 `jurisdictionNotes` 覆盖。本文**不**假设这个改动会发生。
2. D013 / D036 的 skillGaps 列里写着「FMEA」。FMEA（失效模式与影响分析，按 S/O/D 打分）与 S010 的定级规则冲突（决策 1 禁止乘法），**不应**由 S010 近似替代。建议保持为 gap，由新的 Skill 覆盖。

## 16. 未决问题
- 组织 `riskPolicy` 的存储位置和管理界面（决策 5）：需要一个 ADR，或者并入 ADR-120 的组织策略。
- W003 / W005 / W009 / W014 / W016 / W036 / W037 / W041 / W045 / W052 / W053 / W054 的阶段文档作者化以后，要核对 §2.1 中的 `subjectKind` 预期；有不一致时以 Workflow 文档为准，并回来修订本文。
- `critical` 在 W001 `RiskNote` 中没有对应档位：是否要请 W001 增加 `level` 字段，留给 W001 的 owner 决定（本文不修改 W001）。
