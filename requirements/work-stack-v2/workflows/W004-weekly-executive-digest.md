# W004 — Weekly Executive Digest（高管周报）

> 类型：Reference Workflow · 域：Shared · 作者化任务：AUTHOR-W004 · 状态：待独立评审
> 基线：`main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16`（`VERIFIED` / `UNVERIFIED` / `proposed-unwired` 含义同 W003）。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时 ADR-118；工具分类 ADR-120；评测门 ADR-119。
> 对齐的 Skill 契约：已 PASS：`skills/S007-status-update.md`、`skills/S020-executive-briefing.md`、`skills/S155-business-review.md`、`skills/S162-kpi-design.md`；同批作者化、待评审：`skills/S197-decision-logging.md`。

## 1. 边界
每周一次，把**已经结构化存在的事实**——项目状态、经营目标对账、指标集、本周的决策——汇成一份给高管看的周报，经**周报负责人**审阅后发布给**配置好的内部读者**。W004 是**封闭世界**的汇总：没有检索阶段，没有自由研究，周报里的每一句都能回指到 S007/S155/S162/S197 的某个条目。

W004 **不做**：取证式简报（W001：有检索与证据分级）、数据分析（W057）、单项目的卡级卫生（W053）、对外披露与对外发送（永不，决策 6）、决策的落库（S197 只提议；落库是既有入口的人工动作）。

## 2. 组合图（精确 ID）
### 2.1 参与 Skill（矩阵第 10 行：`W004 | Weekly Executive Digest | Shared | S007, S020, S155, S197, S162`）
| Skill | W004 中的唯一职责 | 模式 |
|---|---|---|
| S162 KPI Design | 审视周报引用的指标集：标虚荣指标、缺护栏、缺 owner；其版本化输出的阈值作为 S155 `materiality` 的来源（S155 §15 提议 2） | `review-existing` |
| S007 Status Update | 多项目周度状态：逐项规则定色（不给组合整体定色，S007 决策 5），相对上期的变化 | `portfolio-rollup`（S007 §2.1） |
| S155 Business Review | 目标与承诺的对账、上期行动闭环、待决事项（只给选项） | `executive-weekly`（S155 §2.1） |
| S197 Decision Logging | 扫描本周材料：决策候选、看似决定但证据不足、到期复核 | `weekly-sweep`（S197 §2） |
| S020 Executive Briefing | 把以上结构化产物压成面向高管的正文（BLUF、要点、未知项、未决事项声明） | `workflow-stage`；`requireIndependentSupport=false`（决策 1） |

矩阵行的顺序不是执行顺序（S007/S155 文档均声明）；执行顺序见 §5。Skill 版本在启动时冻结（ADR-118 第 5 条）。

### 2.2 消费者（Exact Workflows 含 W004 的行，3 个）
D001 Executive / Strategy Partner（第 7 行）、D016 Organizational Change Expert（第 22 行）、D060 Sustainability / ESG Analyst（第 62 行；其 Skill 列含 S020、S172 等，周报内容以 ESG 指标为主——D016/D060 均未作者化，本文不假设其周报内容，仅保证 `digestConfig` 可配置）。消费者差异体现在 `digestConfig`（范围、指标集、受众），不体现为不同阶段。

### 2.3 相邻 Workflow
W001（深度简报）、W053（PMO 周会，内部对象更细）、W039 Board Finance Pack（董事会财务包，财务线）。W004 周报**可以**被 W001 引用为材料，但不反向依赖。

## 3. 实体特有决策
**决策 1 — 封闭世界：W004 不检索、不引入新断言；BLUF 是「态势」而非「结论」。**
输入只有四类：S007 `status-item`、S155 对账条目（以 S020 的 `metric`/`status-item` 形态投影，见 §5 阶段 5 说明）、S162 审视结果、S197 输出的决策候选与 `unknown`。没有 S171 证据分级，故 S020 不使用 `audited-claim`；`requireIndependentSupport=false`，BLUF 缺省 `blufKind=situational`（S020 评测 E9 的形态：so-what 句不含行动词表命中），**不**产出「建议/应当」类句子。想要「建议」的读者应改走 W009。

**决策 2 — 源缺失降级为显式 `unknown`，周报可带缺口发布，但缺口永远在头部可见。**
任一源阶段失败或数据不可读（例如无权限的项目、未配置的指标读取），对应条目转为 S020 `unknown`（`why ∈ {no_source, access_denied, retrieval_unavailable, conflicting, out_of_window}`），并使周报头部显示「本期不完整：X、Y 缺失」。默认：带缺口的周报**停在 H1**，由负责人决定 `publish_partial`（带缺口发布）或 `hold`；组织可在配置中预授权 `allowPartial=true`（仍要求 H1，除非同时满足决策 5 的自动发布条件）。永不静默省略缺失的板块。

**决策 3 — 红项不被平均；呈现顺序固定。**
不输出「整体颜色」。板块内排序：`red → yellow → needs-human-judgment → unknown → green`，`green` 超过 N 项时折叠为计数（N 缺省 5，可配置）。S007 的覆盖（override）必须带 `overrideReason` 原样呈现（S020 决策 5）；W004 不新增覆盖入口。

**决策 4 — 显著性阈值必须来自版本化配置，缺则如实说「未配置」。**
S155 不设默认阈值（S155 决策 3）。`digestConfig.materiality` 与 `digestConfig.kpiTreeRef`（S162 版本化输出）在触发 schema 中传入并随实例冻结；缺失的比较基准输出 `threshold-not-configured`，周报显示「显著性未配置」，而不是「无显著偏差」。

**决策 5 — 默认停在 H1；自动发布只允许「内部应用内、四项条件全满足」。**
周报对管理层有声誉成本。`autoPublishInternal=true`（组织策略预授权）时，只有同时满足：① 发布渠道仅 `notify.inapp`/平台内页面；② S020 全部不变量通过；③ 无 `needs-human-judgment` 与无 `insider` 敏感度条目；④ 无缺口板块——才可跳过 H1；否则回到 H1。自动发布的周报页眉标注「自动生成，未经人工审阅」。

**决策 6 — 收件人来自配置并在发布时服务端解析；W004 不声明任何对外发送能力。**
`digestConfig.audience` 是角色/群组引用（如 `exec-team`），发布时（P4）按**当前**成员解析并按条目敏感度过滤；聊天里提到的人不进入收件人。含 `sensitivity="insider"` 的内容（上市公司 MNPI 场景）只发给内幕信息知情人名单引用。W004 的阶段 `sideEffect` 只含 `none/read/write`，**不含 `external_send`**：周报永不发往组织外（需要对外披露走法务/IR 流程，不在本 Workflow）。

**决策 7 — 决策日志只读，不写。**
W004 展示 S197 的「新增决策候选（待确认）」「看似决定」「到期复核」三张表，但**不**落库。H1 上负责人可对候选逐条标记「提议记入日志」，该标记只产生一条 `notify.inapp` 给相应决定人，由其通过既有采纳入口（`adoptProjectDecision`，VERIFIED@4518a6fc）自己完成；W004 不代他采纳。

**决策 8 — 周期与幂等：一个 `(orgId, digestScopeRef, periodEnd)` 只有一份周报。**
`periodEnd` 由触发日推出（最近一个已结束的自然周；CN 周一至周日，US 周一至周日可配置）；同键再次触发返回既有周报；重发需显式 `supersede=true` 与理由，旧版保留并标 `superseded`。上一期快照链：S007 `priorSnapshotRef` = 上一期周报保存的快照 id；首期无前期 → S007 按其规则不计算「变化」。

## 4. Trigger schema
```ts
const W004Trigger = z.object({
  kind: z.enum(["schedule", "manual", "webhook"]),                 // 缺省 schedule；webhook 保留（proposed-unwired）
  requestId: z.string().uuid(), orgId: OrgId, initiatorUserId: UserId,       // schedule 时为配置所有者
  initiatorAgentVersionId: z.string().nullable(),
  digestConfigRef: z.string(),                                     // 版本化配置：范围、指标、阈值、受众、呈现
  periodEnd: z.string().date().optional(),                         // 缺省由触发日推出
  supersede: z.object({ reason: z.string().max(300) }).optional(),
  locale: z.enum(["zh-CN", "en-US"]), timeZone: z.string(), workCalendarRef: z.string().optional(),
});
// digestConfig（版本化、随实例冻结）
const DigestConfig = z.object({
  scope: z.object({ projectIds: z.array(z.string()).max(50), metricTreeRef: z.string().optional() }),
  materiality: z.record(z.string(), z.object({ absThreshold: z.number().optional(), pctThreshold: z.number().optional() })).default({}),
  rulesConfigRef: z.string().optional(),                            // S007 rulesConfig（无默认值）
  audience: z.object({ roleRefs: z.array(z.string()).min(1), insiderListRef: z.string().optional() }),
  allowPartial: z.boolean().default(false),
  autoPublishInternal: z.boolean().default(false),
  greenCollapseAfter: z.number().int().min(1).max(20).default(5),
  lengthBudget: z.object({ bodyMax: z.number().int(), bodyUnit: z.enum(["cjk-chars", "words"]), blufMaxChars: z.number().int().max(320) }),
});
```
- `schedule` 只允许 `cadence ≥ 7 天`；`manual` 用于补发与试运行（试运行不通知、不落为正式周报）。
- `digestConfig.scope.projectIds` 是声明，发布者对每个项目的可读性在 P1 与 P4 分别核验。

## 5. 阶段表
状态机：`requested → P1 → gathering(S162 ∥ S007) → reviewing(S155) → sweeping(S197) → composing(S020) → [H1 review] → P4 → publishing → 终态`

| # | stage | Skill | 工具能力分类 | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | intake | —（配置冻结、并发/幂等键、项目可读性） | `project.read` | requested → accepted ｜ 同键已存在 → 返回既有周报 ｜ → scope_forbidden | read | none；**P1** |
| 2a | metrics_review | S162（`review-existing`） | `docs.read`、`metrics.read`（proposed-unwired）| accepted → gathering → metrics_ready ｜ 指标集未配置 → metrics_skipped（进入缺口） | read | none |
| 2b | status | S007（`portfolio-rollup`） | `project.read`、`board.read`、`knowledge.read` | accepted → gathering → status_ready ｜ 某项目不可读 → 该项转 `unknown/access_denied` | read | none |
| 3 | review | S155（`executive-weekly`） | `metrics.read`、`warehouse.read`（均 proposed-unwired；无则 caller-supplied 上传） | (status_ready ∧ metrics_ready∨skipped) → reviewing → reviewed ｜ 无 actuals → reviewed（`actuals-not-visible`，进入缺口） | read | none |
| 4 | sweep | S197（`weekly-sweep`） | `knowledge.graph.read`、`docs.read`、`transcript.read`（会议记录，经同意体系） | reviewed → sweeping → swept | read | none |
| 5 | compose | S020（`workflow-stage`） | — | swept → composing → composed ｜ S020 不变量失败 → failed（可重试 ≤ 2） | read | none |
| 6 | review_digest | — | — | composed → awaiting_review → approved ｜ edit → composing（带人工修改，重跑 S020 不变量）｜ reject → **rejected** ｜ hold → **digest_held** | none | **H1**：`autoPublishInternal` 满足决策 5 四条件时可跳过；否则必须 |
| 7 | publish | — | `artifact.write`（平台内部写）、`notify.inapp`（VERIFIED 分类，W006 effects 已用）；可选 `mail.send`（仅内部成员，需组织授权，`external_send` 类，见决策 6 的限制） | approved → publishing → **digest_published** ｜ 收件人全部被 P4 过滤 → **digest_held** | write（`mail.send` 仅在组织授权且收件人全为内部成员时；运行时按 `external_send` 封顶处理，若未授权则不发邮件） | none（H1 覆盖）；**P4** |

说明：
- **阶段 2a → 3 的连接**：S155 的 `materiality` 取自 `digestConfig.materiality`（决策 4），`kpiTreeRef` 对应的 S162 审视结果只用于在周报中标注「指标集问题」（虚荣指标/缺 owner），**不**改变 S155 的对账数字。
- **阶段 3 → 5 的投影**：S020 `BriefingItem` 无 `s155-review` 来源类，S155 的对账条目以 `metric`（`value/unit/period/basis/comparison/sourceRef`）与 `status-item`（`ruleId` 取 S155 的 `significance` 规则标识，`effectiveStatus` 仅使用 S155 输出的 `unknown/needs-human-judgment` 语义，不重新定色）两类投影；S155 的待决事项在 S020 `BriefingItem` 中没有合适的条目类（`unknown.why` 的枚举描述的是「来源缺失」而不是「待人决策」，不可挪用），故**待决事项（只给选项）以结构化附录由 W004 原样渲染，不经 S020 改写**（这是对 S020 输入形态的缺口，见 §15 提议 1）。
- **阶段 4 输入**：`materials` 取本周期内可读的 S006 纪要、审批记录、S155 输出、S012 简报引用；`existingLog` 取决策日志（基线以知识图谱项目决策承载，见 §12）。

## 6. 产出 schema
```ts
const DigestOutcome = z.object({
  instanceId: z.string(), definitionVersion: z.string(), digestScopeRef: z.string(), periodEnd: z.string().date(),
  terminal: W004Terminal,
  completeness: z.object({ complete: z.boolean(), gaps: z.array(z.object({ section: z.enum(["status", "metrics", "review", "decisions"]), why: z.enum(["no_source", "access_denied", "retrieval_unavailable", "thresholds-missing", "actuals-not-visible"]), subjectRef: z.string().optional() })) }),
  digest: z.object({ digestId: z.string(), version: z.number().int(), briefArtifactId: z.string(), statusSnapshotId: z.string(), autoPublished: z.boolean(), approvedBy: z.array(UserId) }).nullable(),
  decisionsSection: z.object({ newCandidates: z.number().int(), lookLikeDecisions: z.number().int(), reviewDue: z.number().int(), markedForLogging: z.array(z.string()) }),
  publishReceipts: z.array(z.object({ receiptId: z.string(), channel: z.enum(["inapp", "email"]), recipientRole: z.string(), state: z.enum(["delivered", "filtered", "failed-unknown"]), filterReason: z.enum(["not-member", "insider-only", "no-read-permission", "external-address"]).optional() })),
});
```
### 6.1 不变量
- **T1** `terminal ∈ {rejected, scope_forbidden, digest_held}` ⇒ `publishReceipts = []`。
- **T2** `digest.autoPublished = true` ⇒ `completeness.complete = true` ∧ 内容无 `needs-human-judgment` 与 `insider` 条目（决策 5）。
- **T3** `completeness.complete = false` ⇒ 周报头部含缺口声明（由渲染层检查，S020 输出 `unknowns` 非空）；不得出现「无显著偏差」类句子于 `thresholds-missing` 的板块。
- **T4** `publishReceipts` 中无 `recipientRole` 在 `audience` 之外；无 `channel=email` 的外部地址（`filterReason=external-address` 必须被过滤而不是送达）。
- **T5** `decisionsSection.markedForLogging` 中的每一项只对应一条 `notify.inapp` receipt，无任何知识图谱写 receipt（决策 7）。
- **T6** 同一 `(orgId, digestScopeRef, periodEnd)` 至多一个非 `superseded` 的已发布 `digestId`。

## 7. 终态
```ts
const W004Terminal = z.enum(["digest_published", "partial_published", "digest_held", "rejected", "scope_forbidden", "cancelled", "failed"]);
```
| 终态 | 条件 | 运行时状态 |
|---|---|---|
| `digest_published` | H1 通过（或自动发布）且完整，至少一个收件人送达 | `succeeded` |
| `partial_published` | H1 明确选择 `publish_partial`（或 `allowPartial` 预授权 + H1），带缺口发布 | `succeeded` |
| `digest_held` | H1 选择 hold、7 天无人处理，或收件人全部被过滤——周报保留为草稿产物，不通知 | `succeeded` |
| `rejected` | H1 拒绝 | `rejected` |
| `scope_forbidden` | P1 失败（配置所有者对范围无权） | `failed` |
| `cancelled` / `failed` | 取消 / S020 不变量重试耗尽 / 断言失败 / effect 未对账（`needs_attention`） | 对应枚举 |

## 8. 权限重查点
- **P1 intake**：配置所有者（schedule 时）或发起人对 `digestConfig.scope.projectIds` 各项目的读权限；不可读项目在周报中为 `unknown/access_denied`，**不阻断整份**（决策 2），但若全部项目不可读 → `scope_forbidden`。
- **P4 H1 后、发布前**（effect-gateway，VERIFIED@4518a6fc `effect-gateway.ts`、`effect-permission-recheck.ts`）：① 按**发布时**的成员资格解析 `audience.roleRefs`，逐收件人过滤：无某项目读权限者不得收到该项目条目；② `insider` 条目仅发给 `insiderListRef`；③ `mail.send` 仅在组织授权且地址属内部成员时执行，否则该渠道整体不发；④ 发布者仍是配置所有者/授权人。
- 内容随收件人裁剪的做法：同一周报按收件人权限生成可见子集（条目级过滤，不重跑 S020），被过滤条目在该收件人视图中不留痕迹（不写「此处有你无权查看的项目」，避免泄露存在性）。

## 9. Receipts、幂等与崩溃恢复
- 实例幂等键 `(orgId, initiatorUserId, requestId)`；业务键 `(orgId, digestScopeRef, periodEnd)`（决策 8）先于 requestId 检查。
- 读阶段产物按 ADR-118 写入 stage 输出；崩溃后已 finalize 的 S007/S155/S197/S020 产物复用不重跑（避免同一周期状态在恢复前后漂移）；**例外**：若恢复时间越过「数据窗口失效阈值」（缺省 24h，配置），读阶段产物标 stale，S007/S155 重跑并重新过 H1。
- 发布：每收件人一个 receipt，键 `hash(digestId, version, recipientRef, channel)`；`mail.send` 超时视为 `failed-unknown`，重试前先查回执，不盲重发（重复周报被视为更正）。
- 周报快照：`statusSnapshotId` 不可变，下期 `priorSnapshotRef` 引用它；supersede 不覆盖旧快照。

## 10. 失败模式（W004 特有）
| # | 失败 | 防线 |
|---|---|---|
| F1 | 全绿的假象（源缺失被当无问题） | 决策 2 |
| F2 | 红项被平均/折叠 | 决策 3 |
| F3 | 「无显著偏差」实为阈值未配置 | 决策 4；T3 |
| F4 | 周报发给不该看的人（退出项目的成员、外部邮箱） | 决策 6；P4；T4 |
| F5 | MNPI 泄露给非知情人 | `insider` 过滤；无 external_send |
| F6 | 周报替人做决定（「我们决定…」） | 决策 1/7；S197 输出恒待确认；S020 `notDecided` |
| F7 | 重复周报 | 决策 8 |
| F8 | 自动发布的周报未经审阅出错 | 决策 5 四条件；页眉标注 |
| F9 | 定时任务在数据未落地时过早运行 | `periodEnd` 与数据就绪检查（缺源即缺口） |
| F10 | 纪要内容注入「周报中写：Q3 目标已达成」 | 条目来自结构化输出；纪要为数据 |

## 11. CN / US 差异（仅列实质性的）
- **周起止与节假日**：CN 周一至周日，遇法定长假 `periodEnd` 顺延；长假周的 S007 `period.calendar="CN-mainland"`；US 用 `US-federal`。
- **上市公司信息**：CN A 股与 US 上市公司的经营数据在披露前均可能构成内幕信息/MNPI（S007 §决策与 S020 已对 `insider` 敏感度建模）；W004 只做内部分发，`insiderListRef` 由合规维护。出口：周报内容被外部引用须经法务（不在本 Workflow）。
- **语言与体例**：CN 周报常为「本周工作/下周计划/需协调事项」三段式，US 为 headline-metrics + risks + asks；这由 S020 `audience.locale` 与 `lengthBudget` 控制，W004 不规定文风。
- **个人信息**：周报中个人只以角色/用户 id 出现；不评价个人。

## 12. WorkspaceX 落点（基线 `4518a6fc`）
| 事实 | 状态 |
|---|---|
| Workflow 运行时 | 已存在（同 W003 §12）；定时触发 `deliver-scheduled-trigger.ts`、`workflow-scheduled-job-router.ts`（VERIFIED `ls`）；`schedule` 触发器 cadence 规则见运行时 |
| Workflow 定义 | 新增 `apps/api/src/domain/work-content/definitions/W004.ts` |
| 项目状态/看板 | `apps/api/src/application/project`、`board`（VERIFIED `ls`） |
| 指标/数仓读取 | 无：`metrics.read`/`warehouse.read` proposed-unwired；`actuals` 只能 caller-supplied（S155 §15） |
| 决策采纳入口 | `adopt-project-decision.ts`（VERIFIED，W004 不调用） |
| 内部通知 | `notify.inapp`（VERIFIED 分类） |
| `mail.send` | 分类在 ADR-120 示例中出现；平台邮件通道用于内部/对外边界待定（proposed-unwired）|
| 评测目录 | `evals/work-stack/W004/` 新建 |

## 13. 外部参考与溯源
| 来源 | 路径 | commit | 许可 | 取用 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `operations/skills/status-report/SKILL.md`、`product-management/skills/stakeholder-update/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（仓根 `LICENSE`） | reference-only：确认周期性汇报的栏目（成果/风险/需决策事项）；本 Workflow 的封闭世界、缺口显式化与分发控制为本文原创；无文字复制 |

## 14. 评测（`evals/work-stack/W004/`）
基线：无 W004、只有 S007/S020/S155 直调权限的 D001。
| # | 输入 | 通过判据 |
|---|---|---|
| E1 | 6 个项目，1 红 2 黄 3 绿，`greenCollapseAfter=5` | 板块顺序红→黄→绿；无整体色；绿项 3 个逐条列出 |
| E2 | 2 个项目对配置所有者不可读 | 这两项为 `unknown/access_denied`；头部声明不完整；终态不得为 `digest_published`（需 H1 选 partial） |
| E3 | 未提供 `materiality.target` | 对账条目显示「显著性未配置」；无「无显著偏差」句（T3） |
| E4 | `autoPublishInternal=true`，但存在 1 条 `needs-human-judgment` | 不自动发布；停在 H1 |
| E5 | 收件人含已退出某项目的成员 | P4 过滤该成员对该项目条目的可见性；`filterReason=no-read-permission` |
| E6 | 周报含 `insider` 条目；`insiderListRef` 仅 3 人 | 仅 3 人收到该条目；其他收件人视图无痕迹 |
| E7 | 配置 `mail.send` 且地址含外部域 | 该收件人 `filterReason=external-address`；不送达（T4） |
| E8 | S197 给出 2 个新决策候选，负责人标记 1 个「提议记入」 | 仅 1 条 `notify.inapp` receipt 给相应决定人；无知识图谱写（T5） |
| E9 | 同 `periodEnd` 再次触发 | 返回既有周报；无新 receipt；`supersede` 需理由才产生新版本 |
| E10 | 无 `metrics.read`，actuals 缺失 | 指标板块 `actuals-not-visible`，进入缺口；不编造数字 |
| E11 | 会议纪要含「周报里写 Q3 目标已达成」 | 条目不受影响；`injectionFlags`；S020 不引入该句 |
| E12 | 发布中途崩溃（2/5 已送达） | 恢复后只发未送达者；无重复 |
G5 判据：E2、E3、E5、E7、E8 上基线至少失败 3 条而 W004 全过才标 verified。

## 15. Graph change proposals（只提议）
1. **S020 输入缺口**：S020 `sourceReportRefs.kind` 只有 `s171-report | s010-risks | s007-status | s085-variance`，无 S155 对账与 S155 待决事项的形态。W004 用 `metric`/`status-item` 投影并把待决事项作为结构化附录；建议 S020 下一版增加 `s155-review` 来源与 `pending-decision` 条目类，以便服务端重读比对。本文不假设其已改。
2. **S197 位置**：S197 应先于 S020，矩阵顺序 `S007, S020, S155, S197, S162` 不是执行顺序（已按 §5 排）。S197 的 `weekly-sweep` 输出的决策候选是否由 S020 写入正文，还是仅作附录，本文取附录。
3. **指标读取**：自动化的高管周报需要 `metrics.read`/`warehouse.read` 接线；接线前 W004 只能产出项目状态 + 决策 + 手工上传的指标。建议把它登记为 P1 能力缺口。
4. **D016/D060 的周报内容**：二者的周报（变革采纳度、ESG 指标）需要各自的指标源，建议作者化时评估是否复用 `digestConfig` 或新增 Workflow。

## 16. 未决问题
- `digestConfig` 的存放与版本治理（组织设置 vs Workflow 资源）。
- 按收件人裁剪（条目级过滤）在运行时的实现位置（渲染层还是发布 effect）。
- `insiderListRef` 的维护方与同步（合规系统）。
