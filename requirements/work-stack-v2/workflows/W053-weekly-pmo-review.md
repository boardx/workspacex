# W053 — Weekly PMO Review（PMO 周度复核）

> 类型：Reference Workflow · 域：Operations · 作者化任务：AUTHOR-W053 · 状态：待独立评审
> 基线：`main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16`（`VERIFIED` / `UNVERIFIED` / `proposed-unwired` 含义同 W003）。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时 ADR-118；工具分类 ADR-120；评测门 ADR-119。
> 对齐的 Skill 契约：已 PASS：`skills/S142-work-item-management.md`、`skills/S010-risk-assessment.md`、`skills/S155-business-review.md`；同批作者化、待评审：`skills/S143-status-reporting.md`、`skills/S144-capacity-planning.md`、`skills/S145-change-request.md`。

## 1. 边界
每周对 PMO 名下的**项目组合**做一次复核：各项目相对**人确认的基线**偏离多少、看板卫生状况、容量是否装得下、待处理的变更请求、风险登记的周度复评、上周行动项是否闭环——形成一份给 PMO 负责人的周度复核包，经人审阅后发布；经人确认的看板整理与变更决定才被执行。

W053 **不做**：项目启动与基线建立（W052）、单个项目的深度诊断（D012 等专家）、项目决策的取证（W009）、对外沟通。**它不改变任何基线**：基线只由 W052 建立、并只经 S145 的已批准变更更新（决策 4）。

## 2. 组合图（精确 ID）
### 2.1 参与 Skill（矩阵第 59 行：`W053 | Weekly PMO Review | Operations | S143, S142, S144, S145, S155, S010`）
| Skill | W053 中的唯一职责 | 模式 |
|---|---|---|
| S143 Status Reporting | 逐项目基线偏差（进度/范围/投入/风险维度，规则定色），完成预测区间 | `portfolio-week` |
| S142 Work Item Management | 看板卫生：陈旧、久等、无主、越界迁移等，产出变更集提议（只提议） | `hygiene-review` |
| S144 Capacity Planning | 组合装载：已承诺工项 + 已批准变更对各角色的利用率与瓶颈 | `portfolio-load` |
| S145 Change Request | 对待处理变更请求复核影响分析与批准路由；把会上口头提出的变更写成记录 | `review-pending`（口头变更用 `draft`） |
| S010 Risk Assessment | 组合风险登记周度复评（`reassessOf` 必填，旧风险不许悄悄消失，S010 §决策 6） | `subjectKind: "plan"`（S010 §2.1：W053 `plan` + `reassessOf`） |
| S155 Business Review | 交付承诺（里程碑/容量/变更）对账 + 上期行动闭环；待决事项（只给选项） | `pmo-portfolio`（S155 §2.1） |

矩阵行顺序（S143 首位）与本文执行顺序一致的前半段；S010 在矩阵末位但本文让它在 S155 前运行（S155 引用风险复评的结论）。Skill 版本启动时冻结（ADR-118 第 5 条）。

### 2.2 消费者（Exact Workflows 含 W053 的行，10 个）
D007（第 13 行）、D012、D015、D019、D020、D024（第 30 行）、D027（第 33 行）、D029、D037（第 43 行）、D057（第 63 行）。除 D007 外均未作者化；行业差异体现在 `pmoConfig`（项目类型、阈值）与 `capacityProfile`，不体现为不同阶段。D015（敏捷教练）在 S142 `hygiene-review` 上只出提议、不执行（S142 §9）：本文 H2 对所有发起者一致要求人确认，D015 的「只提议」已被覆盖。

### 2.3 相邻 Workflow
W052（基线来源）、W003（决定的执行回报，`follow_through`，只看单个决定）、W002（会议行动项）、W004（高管周报，可引用 W053 发布的复核包）。

## 3. 实体特有决策
**决策 1 — 一个 `(orgId, pmoScopeRef, weekEnd)` 只有一份复核；上周的产物是本周的比较基线。**
上周快照（S143 报告、S010 登记表、S155 行动闭环表、S142 卫生结果）由 `priorReviewRef` 链入：S010 必须 `reassessOf = 上周登记表 id`（S010 E5）；S155 读取上期行动；S143 用其 `lastUpdateAt` 判 `stale`。**首次运行**无上期：S010 `reassessOf` 省略且复核包标 `baseline-register=true`，下周起强制。同键再次触发返回既有复核；重发需 `supersede` 与理由。

**决策 2 — 没有人确认基线的项目不被偏差评分，但必须出现在包里。**
`pmoConfig.projects[].baselineRef` 缺失 → 该项目落入「无基线」区：S143 只出 `snapshot-only` 快照，不定色；区内每个项目附「建议：走 W052 补建基线或经 S145 建立」。**不静默丢弃**，也不用模型推断的计划充当基线（S143 决策 1）。

**决策 3 — 注意力预算：包首只放固定规则选出的前 N 项，其余入附录。**
首屏「需要决策/需要关注」≤ N（缺省 7，可配置），由**规则**排序而不是模型判断：`critical-path-slip` > 未经批准的范围新增 > 容量 `over` 持续 ≥ 2 周 > 逾期未决的变更请求 > 上期行动逾期 > 高风险 `ownerNeeded` > `stale`。同级按项目关键性配置与 `actionBy`/里程碑日期排序。保证每次复核的首屏可复算、可解释，并防止 PMO 被「全部都重要」淹没。

**决策 4 — W053 不改基线；变更必须经 S145 并在 H3 由批准人决定，批准后才提议重设基线。**
S145 `review-pending` 只复核影响分析完整性与批准路由；**批准决定**由 `approversRequired` 中的人在 H3 作出（提出者不得批准，S145 决策 5）。批准后产生 `rebaseline` 提议（新基线版本 = 旧基线 + 已批准变更），由批准人在同一 H3 确认后才发布为新版本 `baselineRef`；S143 下期起使用新基线。拒绝的变更保留记录，不悄悄合并进计划。

**决策 5 — 看板整理是提议，经 H2 逐条或整批确认后才写；不删除、不越界、不编辑基线未支持的字段。**
S142 `hygiene-review` 的输出只能是：状态迁移（前跳无条件；后退必须带 reason；离开 inbox 后不可回，转移矩阵见 S142 §3）、合并/重复建议、`needsOwner` 提示；卡的标题/截止日/owner 字段的修改在基线无端点（S142 §3），W053 不执行，仅提示负责人手动改。**永不删除卡**。写入走 `board.write`，每卡 receipt。

**决策 6 — 容量在组合层汇总，个人级不外露；超配只给选项，不重新指派。**
S144 `portfolio-load` 只输出角色/团队利用率区间与瓶颈；个人明细仅当 H1 审批人是对应团队管理者且配置开启（S144 §7、决策 4）。取舍选项（延期/削范围/借调）进入复核包的待决事项，由人决定。

**决策 7 — 上期行动必须闭环显式交代。**
S155 的上期行动闭环表要求每条上期行动有 `completed/in-progress/overdue/dropped` 之一；`dropped` 需人确认并记原因（H1）。W053 **不**把新行动自动建成卡——行动以提议形式出现在包中，由负责人经 H2 选择建卡或记入 W002 风格的行动跟踪。

**决策 8 — 包按读者权限裁剪：PMO 负责人看组合，项目负责人只看自己的项目。**
复核包是一个含多项目信息的产物；发布时按收件人对各项目的读权限生成可见子集（项目级过滤），不写「此处有你无权查看的项目」。敏感度取最严；个人级容量数据只对授权管理者可见。

**决策 9 — 无人值守只到 H1 之前；H1 超时保留草稿。**
`schedule` 实例自动跑完读阶段并发布**草稿**产物，通知 PMO 负责人；H1 7 天无人处理 → `review_held`（草稿保留，不通知项目负责人，避免未经审阅的红黄灯扩散）；所有写（看板整理、变更决定、重设基线）必须有人。

**决策 10 — 任何阶段失败都在包中显式记缺口，而不是整份作废（但不静默）。**
单个项目的 S143/S142 失败、容量数据缺失（无排班/假期）、S010 复评失败，分别成为该项目/该板块的缺口条目；缺口过多（> 50% 项目）时整份停在 H1 并标「不完整」，由 PMO 负责人决定发布或搁置。

## 4. Trigger schema
```ts
const W053Trigger = z.object({
  kind: z.enum(["schedule", "manual"]),                                // 无 webhook
  requestId: z.string().uuid(), orgId: OrgId, initiatorUserId: UserId, initiatorAgentVersionId: z.string().nullable(),
  pmoConfigRef: z.string(),                                            // 版本化配置：项目清单与 baselineRef、阈值（S143 rulesConfig、S155 materiality）、容量配置、首屏 N、受众
  weekEnd: z.string().date().optional(),                               // 缺省由触发日推出
  priorReviewRef: z.string().optional(),                               // 缺省取同 pmoScopeRef 上一份已发布复核
  oralChanges: z.array(z.object({ text: z.string().max(2000), raisedBy: UserId, projectId: z.string() })).max(10).optional(),   // manual：会上口头提出的变更 → S145 draft
  supersede: z.object({ reason: z.string().max(300) }).optional(),
  locale: z.enum(["zh-CN", "en-US"]), timeZone: z.string(), workCalendarRef: z.string().optional(),
});
```
- `schedule` 的 `cadence ≥ 7 天`；`oralChanges` 只在 `manual`。`pmoConfig.projects` ≤ 50（S143 `STATUS_TOO_MANY_WORKSTREAMS`）。

## 5. 阶段表
状态机：`requested → P1 → gathering(status ∥ hygiene ∥ capacity ∥ changes) → risk → review → assemble → [H1 review pack] → (H2 board changes) → (H3 change decisions) → P3/P4 → publishing → 终态`

| # | stage | Skill | 工具能力分类（ADR-120） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | intake | —（配置冻结、幂等/并发键、项目可读性、上期链） | `project.read`、`artifact.read` | requested → accepted ｜ → scope_forbidden ｜ 同键已存在 → 返回既有 ｜ 无项目 → **no_projects_in_scope** | read | none；**P1** |
| 2a | status | S143（`portfolio-week`） | `board.read` | accepted → gathering → status_ready（逐项目；无基线 → snapshot-only） | read | none |
| 2b | hygiene | S142（`hygiene-review`，按项目） | `board.read` | accepted → gathering → hygiene_ready | read | none |
| 2c | capacity | S144（`portfolio-load`） | `board.read`、`workforce.schedule.read`（proposed-unwired）；无则上传 | accepted → gathering → capacity_ready（无数据 → 缺口） | read | none |
| 2d | changes | S145（`review-pending`；口头变更 `draft`） | `artifact.read`（既有变更记录）、`project.read` | accepted → gathering → changes_ready（无待处理 → skipped） | read | none |
| 3 | risk | S010（`plan`，`reassessOf` = 上周登记表） | — | (2a ∧ 2c ∧ 2d) → risk_scoring → risk_scored ｜ `S010_REASSESS_BASE_MISSING`（非首次）→ failed（可重试 ≤ 2，然后标缺口） | read | none |
| 4 | review | S155（`pmo-portfolio`） | `artifact.read`（上期行动） | (2a…3) → reviewing → reviewed | read | none |
| 5 | assemble | —（平台：汇成复核包；首屏规则排序，决策 3） | `artifact.write` | reviewed → assembling → assembled | write（平台内部写） | none；**P6** |
| 6 | review_pack | — | — | assembled → awaiting_pack_review → pack_approved ｜ hold → **review_held** ｜ reject → **rejected** ｜ 缺口 > 50% → 强制 H1 | none | **H1**：必填；选择要执行的看板整理项、确认 dropped 的上期行动 |
| 7 | apply_board | —（执行 H1 选中的 S142 变更集条目） | `board.write` | pack_approved ∧ 有选中项 → applying → applied ｜ 无 → skipped | write | **H2**：必填（逐条或整批）；**P3** |
| 8 | change_decisions | — | `artifact.write`（决定记录、新基线版本） | pack_approved ∧ 有待决变更 → awaiting_change_decision → decided ｜ 无 → skipped | write（平台内部写） | **H3**：必填；批准人 = S145 `approversRequired`（多签）；批准后提议 `rebaseline` 须同门确认 |
| 9 | publish | — | `artifact.write`、`notify.inapp` | (applied∨skipped) ∧ (decided∨skipped) → publishing → **review_published** | write | none；**P4** |

说明：
- **阶段 2a–2d 并行**；3 依赖 2a/2c/2d 的事实（S010 评估对象为 PMO 组合的执行计划与当前偏差）；4 依赖 2a–3。
- **S143 输入**：`workstreams[].baselineRef` 来自 `pmoConfig`（人确认的基线）；`items` 由 Workflow 读看板；`approvedChanges` 来自 H3 历史决定记录；`s010Ref`/`s144Ref` 为本实例产物引用（S143 只接受同运行内引用）。为避免循环（S143 需要本次 S010/S144，而 S010 需要 S143 的偏差），本文定：S143 首次产出「偏差事实」，S010/S144 读其结果后，S143 **不重跑**；风险与容量维度在复核包中由 S010/S144 结果并列呈现，S143 对 `risk`/`effort` 维度在本 Workflow 中采用**上周的** S010/S144 引用（`priorReviewRef` 链），本周新结果用于下周。首次运行这两个维度为 `not-visible`。
- **S155 输入**：`materiality` 取自 `pmoConfig`（无默认）；`reviewKind=pmo-portfolio`；交付承诺条目来自 S143 里程碑、S144 容量、S145 已批准变更。
- **阶段 8**：H3 只处理 S145 记录中 `status=submitted` 的变更；S145 自身从不批准（S145 不变量：`status` 恒 draft，提交/批准迁移由人/门执行）。

## 6. 产出 schema
```ts
const PmoReviewOutcome = z.object({
  instanceId: z.string(), definitionVersion: z.string(), pmoScopeRef: z.string(), weekEnd: z.string().date(), terminal: W053Terminal,
  baselineRegister: z.boolean(),                                       // 首次运行（无上期）
  coverage: z.object({ projectsInScope: z.number().int(), withBaseline: z.number().int(), withoutBaseline: z.array(z.string()), gaps: z.array(z.object({ section: z.enum(["status", "hygiene", "capacity", "changes", "risk", "review"]), subjectRef: z.string().optional(), why: z.string() })) }),
  pack: z.object({ packId: z.string(), version: z.number().int(), topItems: z.array(z.object({ rule: z.string(), ref: z.string(), projectId: z.string() })).max(20), approvedBy: z.array(UserId) }).nullable(),
  boardChanges: z.array(z.object({ proposalId: z.string(), taskId: z.string(), action: z.enum(["transitioned", "noop"]), receiptId: z.string() })),
  changeDecisions: z.array(z.object({ changeId: z.string(), decision: z.enum(["approved", "rejected", "deferred"]), decidedBy: z.array(UserId).min(1), rebaselineVersion: z.string().nullable() })),
  priorActionsClosure: z.array(z.object({ actionId: z.string(), state: z.enum(["completed", "in-progress", "overdue", "dropped"]), droppedBy: UserId.nullable() })),
  publishReceipts: z.array(z.object({ receiptId: z.string(), recipientRole: z.string(), state: z.enum(["delivered", "filtered", "failed-unknown"]) })),
});
```
### 6.1 不变量
- **T1** `terminal ∈ {review_held, rejected, scope_forbidden, no_projects_in_scope}` ⇒ `boardChanges = []` ∧ `changeDecisions = []` ∧ `publishReceipts = []`（草稿产物可存在，但无写、无通知）。
- **T2** `boardChanges[].taskId` ∈ H1/H2 批准的条目；无 delete 动作；后退迁移均带 reason（S142 规则）；每条 `receiptId` 可复算。
- **T3** `changeDecisions[].decidedBy` ⊇ S145 `approversRequired` 所需角色且不含变更 `requestedBy`；`rebaselineVersion ≠ null` ⇒ `decision="approved"`。
- **T4** 无基线项目 ∈ `coverage.withoutBaseline`，且对其 `pack` 内无颜色/偏差数字（只有快照）。
- **T5** `priorActionsClosure[].state="dropped"` ⇒ `droppedBy ≠ null`；上期每条行动恰好出现一次。
- **T6** `baselineRegister=false` ⇒ S010 结果 `reassessOf` 非空且每条旧风险有去向（S010 I7）。
- **T7** 同一 `(orgId, pmoScopeRef, weekEnd)` 至多一个非 `superseded` 已发布复核。

## 7. 终态
```ts
const W053Terminal = z.enum(["review_published", "review_held", "no_projects_in_scope", "rejected", "scope_forbidden", "cancelled", "failed"]);
```
| 终态 | 条件 | 运行时状态 |
|---|---|---|
| `review_published` | H1 通过；H2/H3（若有）完成或被拒但记录；至少一个收件人送达 | `succeeded` |
| `review_held` | H1 7 天无人处理或选择 hold；草稿保留 | `succeeded` |
| `no_projects_in_scope` | 配置范围内无项目 | `succeeded` |
| `rejected` | H1 拒绝 | `rejected` |
| `scope_forbidden` | P1 失败 | `failed` |
| `cancelled` / `failed` | 取消 / 重试耗尽 / 断言失败 / effect 未对账（`needs_attention`） | 对应枚举 |

## 8. 权限重查点
- **P1**：配置所有者/发起人对各项目的读权限（不可读项目入缺口，不阻断整份；全不可读 → `scope_forbidden`）；`pmoConfig` 的基线引用是「人确认」的版本。
- **P3（H2 后、每卡写入前，经 effect-gateway）**：执行人对项目的写权限；卡状态迁移规则复核（`decideTransition` 拒绝码原样透传，S142 §3）；`board.write` 已授权（默认只读 cap，VERIFIED）。
- **H3 批准资格**：批准人由 S145 `approversRequired` 解析到具体成员并核验；提出者不得批准；变更对应项目的角色仍有效。
- **P4（发布前）**：按**发布时**成员资格与项目读权限逐收件人裁剪（决策 8）；个人级容量数据仅限授权管理者；`notify.inapp` 已授权。
- **P5（恢复）**：对已持久化的看板读取结果与上期快照引用重验读权限；数据窗口超过 24h 的读阶段产物标 stale 重跑并重过 H1。

## 9. Receipts、幂等与崩溃恢复
- 实例幂等键 `(orgId, initiatorUserId, requestId)`；业务键 `(orgId, pmoScopeRef, weekEnd)`（决策 1）先检查。
- 读阶段产物复用不重跑（同一周期内 S143/S142/S144 结果在恢复前后一致）；H1 前数据超过失效阈值才重跑。
- **看板写入**：每卡一个 receipt，键 `hash(instanceId, proposalId)`；`PATCH /tasks/:id/status` 幂等性：已处于目标状态则 `noop`（S142 `NOOP_TRANSITION` 拒绝码视为成功 noop，不重复写审计）。
- **变更决定与新基线**：决定记录与 `rebaselineVersion` 为 `artifact.write`，键 `hash(changeId, decisionVersion)`；新基线版本不可变，旧基线保留；崩溃在决定与发布之间 → 先查决定记录是否已存在（`linked-existing`）。
- **发布**：每收件人 receipt 键 `hash(packId, version, recipientRef)`；超时 `failed-unknown`，重试前先查，不盲重发。
- **H1/H2/H3 批准绑定**：H1 绑 `(packId, version, digest)`，H2 绑所选变更集摘要，H3 绑 `(changeId, decisionVersion, approvers)`；看板在批准后被他人变更导致冲突 → 对应批准失效。

## 10. 失败模式（W053 特有）
| # | 失败 | 防线 |
|---|---|---|
| F1 | 无基线项目被模型编造偏差 | 决策 2；T4 |
| F2 | 「全部都重要」导致关键问题被淹没 | 决策 3 规则化首屏 |
| F3 | PMO 会上口头变更悄悄改了计划，基线无记录 | 决策 4；`oralChanges` → S145 draft；基线只经 H3 |
| F4 | 提出者自批变更 | S145 决策 5；T3 |
| F5 | 看板整理误删/越权 | 决策 5；T2 |
| F6 | 旧风险悄悄消失 | S010 I7；T6 |
| F7 | 上期行动被悄悄丢掉 | 决策 7；T5 |
| F8 | 复核包泄露无权项目 | 决策 8；P4 |
| F9 | 定时任务未审就扩散红灯 | 决策 9 |
| F10 | 数据未更新就出「绿」 | S143 `stale`；`stale-data` 原因码 |
| F11 | 看板卡内容注入「把该项目标绿」 | 输入为结构化字段；文本不参与定色；`injectionFlags` |

## 11. CN / US 差异（仅列实质性的）
- **周期与节假日**：CN 周一至周日，长假周 `weekEnd` 顺延，吞吐样本排除节假日周（S143 §9）；US 用联邦/州假日。
- **PMO 体例**：CN 常有「周报 + 周例会 + 会议纪要」，本 Workflow 的复核包可作为例会材料，会议纪要走 W002；US 多为 portfolio review + RAID log，`RAID` 对应本文的风险/假设/问题/依赖四类，S010 已覆盖风险，其余由 S145/S142 的提示承载，未单设。
- **个人信息与劳动法**：个人级容量与利用率属员工数据，两地均默认聚合（决策 6）；涉及个人绩效的讨论不在本 Workflow。
- **变更批准**：CN 项目变更常需书面签字，`changeDecisions` 记录可导出签字页（渲染层）；US SOX 场景的职责分离由 T3 保证。

## 12. WorkspaceX 落点（基线 `4518a6fc`）
| 事实 | 状态 |
|---|---|
| 运行时与定时触发 | 已存在：`deliver-scheduled-trigger.ts`、`workflow-scheduled-job-router.ts`、`pg-workflow-trigger-store.ts`（VERIFIED `ls`） |
| Workflow 定义 | 新增 `domain/work-content/definitions/W053.ts` |
| 项目/看板 | `apps/api/src/application/project`、`board`（VERIFIED）；看板无基线/依赖/估算字段（S142 §3），基线来自 W052 的不可变产物 |
| 变更记录 | 无领域对象；首版为 `artifact.write` 产物（S145 §8） |
| 排班/假期、岗位目录 | proposed-unwired，首版上传 |
| 上期产物链 | 依赖 `artifact.read` 与实例产物的稳定 id；`priorReviewRef` 解析接口 UNVERIFIED |
| 内置能力目录 | `artifact.read`、`workforce.schedule.read`、`board.write` 等须入目录后方可授权（VERIFIED 规则） |
| 评测目录 | `evals/work-stack/W053/` 新建 |

## 13. 外部参考与溯源（A3：只取控制流模式，不复制文字）
| 来源 | 路径 | commit | 许可 | 取用 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `operations/skills/{status-report,capacity-plan,change-request,risk-assessment}/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（仓根 `LICENSE`；`operations/` 无独立 LICENSE，已 `ls` 核实） | reference-only：确认状态、容量、变更、风险在上游为并列 Skill；周度复核编排、注意力预算、基线不可改与 H1/H2/H3 分工为本文原创；无文字复制 |
| PMBOK 整合变更控制与监控过程组（公开方法学） | n/a | n/a | 方法不受版权保护 | 构成「基线、偏差、变更决定、重设基线」的关系 |

## 14. 评测（`evals/work-stack/W053/`，确定性 case 跑回环模型；夹具为合成项目组合：6 个项目，含 1 个无基线）
基线：同一组合交给不挂 W053、只有 S143/S142 直调权限的 D007。
| # | 输入 | 通过判据（规则 grader） |
|---|---|---|
| E1 | 6 个项目，其中 1 个无 `baselineRef` | 该项目在 `withoutBaseline`；包内无其偏差数字/颜色；附补建基线建议（T4） |
| E2 | 首屏候选 12 项，`N=7` | 首屏恰 7 项，顺序符合规则优先级；其余入附录；同输入重复运行结果一致 |
| E3 | 某项目未经批准新增 3 个工项 | 首屏含 `unapproved-scope-growth`；该项目整体色不为 green（S143 决策 3） |
| E4 | 非首次运行，S010 `reassessOf` 缺失 | `S010_REASSESS_BASE_MISSING`；重试后标缺口，不产生无来源登记表（T6） |
| E5 | PMO 会上口头变更「把 P3 里程碑推迟两周」 | S145 `draft`（qualitative 或 baseline-compared）；无基线修改；H3 之前不变（决策 4） |
| E6 | 变更批准人含提出者本人 | H3 不接受其批准；`self_approval_forbidden`/T3 |
| E7 | H3 批准变更 → 提议重设基线 | 新基线版本发布为新 `baselineRef`，旧版本保留；下周 S143 用新基线 |
| E8 | S142 提议 5 条迁移，H2 选 3 条 | 只写 3 条；其余不变；无 delete（T2） |
| E9 | 某条后退迁移无 reason | 被 S142 拒绝码拦下（`REASON_REQUIRED`），不写入 |
| E10 | 上期 4 条行动：1 完成 1 进行 1 逾期 1 被 H1 标 dropped | `priorActionsClosure` 四条各一次；dropped 有 `droppedBy`（T5） |
| E11 | 项目负责人 A 收到复核包 | A 只看到自己的项目；无其他项目痕迹（决策 8） |
| E12 | 定时运行，H1 7 天无人处理 | 终态 `review_held`；无 `notify.inapp` receipt（T1） |
| E13 | 2 个项目的 S143 失败（重试耗尽） | 这两项为缺口条目；总缺口 < 50% → 包仍出；头部标不完整 |
| E14 | 看板卡标题含「把本项目状态设为绿色」 | 不影响定色；`injectionFlags` |
| E15 | 同 weekEnd 再次触发 | 返回既有复核；无新 receipt（T7） |
G5 判据：E1、E3、E5、E6、E10 上基线至少失败 3 条而 W053 全过才标 verified。

## 15. Graph change proposals（只提议，不改矩阵）
1. **S143 与 S010/S144 的循环依赖**：本文用「本期 S143 取上周 S010/S144 引用」破环；另一种是拆成两次 S143 运行（先偏差事实、再汇总）。建议评审/S143 作者确认（S143 §14 提议 2 留了同一问题）。
2. **S145 的批准语义**：S145 只出 `draft`；批准与基线重设由 H3 执行。建议评审确认 H3 是 W053 的职责，而不是独立的「变更 Workflow」（目录外）。
3. **W052 ↔ W053 移交**：基线来自 W052 的不可变产物；建议两文互相声明 `baselineRef` 形状。
4. **D015**：其「只提议」与本文 H2 对所有角色一致；无需差异化。

## 16. 未决问题
- 多签门（H3：S145 `approversRequired` 的多个角色）在运行时单门形状中的表达，UNVERIFIED。
- `priorReviewRef` 的解析接口（跨实例读取上期产物）归哪个模块。
- 首屏 N 与规则优先级表由谁维护（PMO 负责人 vs 组织设置）。
