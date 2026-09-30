# W017 — Renewal Risk Review（续约风险复核）

> 类型：Reference Workflow · 域：Sales / Customer Success · 作者化任务：AUTHOR-W017 · 状态：待独立评审
> **目录状态：`deferred`（延后，显式缺口条目）——已完整作者化，但不进入任何实现清单，直到 §2A 的上线前置条件全部满足。**
> 基线：`main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16`（`VERIFIED` / `UNVERIFIED` / `proposed-unwired` 含义同 W003）。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时 ADR-118；工具分类 ADR-120；评测门 ADR-119。
> 对齐的 Skill 契约：已 PASS：`skills/S033-renewal-radar.md`、`skills/S035-customer-health.md`、`skills/S023-account-planning.md`；同批作者化、待评审：`skills/S189-customer-escalation.md`、`skills/S193-voice-of-customer.md`。

## 1. 边界
对一个**续约窗口**内的合同集合，回答：哪些必须在何时动作、哪些真的有风险（含健康诊断）、每个需要动作的账户的挽留/续约计划是什么、有没有未关闭的升级卡住续约、客户自己说了什么——并把结果汇成一份经**账户负责人（CSM）逐账户确认**的 `RenewalReviewPack`。

W017 **不做**：对客户的任何触达（没有发送阶段，决策 5）；预测数与提交数（S031/W016）；扩张方案（W018；同账户在评审中时 W018 被挂起，见 W018 决策 4）；合同条款的法律解读（交法务）；开票/回款核对（财务线，S033 §9）。

## 2. 组合图（精确 ID）
### 2.1 参与 Skill（矩阵第 23 行：`W017 | Renewal Risk Review | Sales | S033, S035, S023, S189, S193`）
| Skill | W017 中的唯一职责 | 模式 |
|---|---|---|
| S033 Renewal Radar | **两次运行**：第一次给窗口内续约名单、动作截止日与初判；第二次（仅对深审账户）纳入 S035 健康结论得出最终判定 | `radar`（两次，决策 1） |
| S035 Customer Health | 对初判为 `at-risk`/`needs-attention`/`insufficient-evidence` 的账户做五维健康诊断 | `health-check`（需同运行内 `s033RunRef`） |
| S023 Account Planning | 对最终判定为 `at-risk`/`needs-attention` 的账户写挽留/续约计划 | `retention`（需 `s035ResultRef` 与 `s033RadarRef`，S023 I1） |
| S189 Customer Escalation | 对含 `open-escalation` 信号的账户核对升级是否有人接、是否卡住续约 | `renewal-blocker` |
| S193 Voice of Customer | 汇总该账户在窗口内的客户自述（逐字），解释续约原因 | `account` |

Skill 版本由 `WorkflowDefinition(W017, v1)` 启动时冻结（ADR-118 第 5 条）。**W017 行不含 S142、S192**：后续任务创建与挽留方案深化分别见 §15 提议 2、3。

### 2.2 消费者
仅 D006 Customer Success Specialist（第 12 行，Workflows 列 `W007, W017, W018, W002, W006`）。**全矩阵 grep `W017` 只命中 W017 自己的行与 D006 行**（已核实）；D006 的 Skill 列不含 S033/S023，故聊天直调不可用，全靠 W017（S033 §14 提议 1 已指出）。

### 2.3 相邻 Workflow
W016（预测复核，S033 `forecast-overlay`）、W018（扩张，决策 10 的并发约定）、W007（S189 的 `escalationKey` 共用）。

## 2A. 为什么第一阶段排除 W017，以及它何时可以上线（显式缺口）
**历史事实**：`phases/phase-20-work-stack-foundation/requirements/05-content-lines.md` 第 10 行写明：「W017 在矩阵中存在但**不在**第一阶段清单，不实现」；`ACCEPTANCE-JOURNEYS.md` 第 244 行「Workflow 目录 19 项（无 W017）」；代码层有三处守卫：`packages/contracts/src/work-content.ts` 的 `Phase1Reconciliation.unexpected`（「W017 出现即进这里」）、`apps/api/src/domain/work-content/definitions/sales/index.ts` 注释与 `apps/api/tests/work-content/sales-skillpins-matrix.test.ts`「恰好覆盖 W011–W016 与 W018，不含 W017」（均 VERIFIED@4518a6fc）。

**排除原因（本文核对，三条，按性质区分）**：
1. **闭包原因（流程性）**：第一阶段 = D002/D003/D005/D011 的组合闭包；W017 只属于 D006（不在第一阶段），且 S189、S193 当时未作者化。这是范围划分，不是缺陷。
2. **外部系统缺口（实质性，P0）**：W017 的第一步 S033 需要**合同/订阅/续约商机**数据（`crm.read`，客户合同维度）。平台没有该数据模型：`apps/api/src/application/crm/` 仅有 `crm-contact-ports.ts`（平台运营线索联系人，受 `PlatformOperatorGuard` 保护，S033 §7 已核实，VERIFIED `ls`），不可复用。唯一可用路径是 S033 的 `origin="uploaded"`（CSM 上传合同表）。**结论：W017 需要外部 CRM/合同/计费系统，或接受上传模式。**
3. **工单/升级缺口（P1）**：S189 `renewal-blocker` 与 S033 `open-escalation` 依赖工单与升级记录（`ticket.read`，proposed-unwired，见 S187 §8）。无此数据时，`open-escalation` 信号为 `notVisible`，不会被当作「没有升级」（S033 决策 2）。

**上线前置条件（全部满足才能离开 `deferred`）**：
- ① S189、S193、W017 本身通过独立评审（S033/S035/S023 已 PASS）；
- ② D006 已作者化并通过评审（W017 的唯一拥有者）；
- ③ 二选一：(a) `crm.read`（合同维度）接线并经组织授权，或 (b) 评审接受「仅上传模式」作为首版，并在 UI 明示 `dataOrigin=caller-supplied`；
- ④ 第二阶段对账集合（catalog reconciliation）更新：当前守卫把「W017 出现」判为 `unexpected`，上线时必须改为**按阶段的 ID 集合**（而不是硬编码 W017 缺席），否则目录 API 与 sales 定义测试会红；
- ⑤ 新能力分类（`crm.read` 合同维度、`ticket.read`）进入内置 Workflow 目录（`UNKNOWN_CAPABILITY` 规则，VERIFIED `packages/contracts/src/workflow-capability-grants.ts`）。
在此之前，W017 文档是**设计契约**，不产生任何运行时注册。

## 3. 实体特有决策
**决策 1 — S033 跑两次：先 `radar` 得名单，健康诊断后再 `radar` 得最终判定。**
S033 §决策 3/§14 提议 2 留给 W017 作者裁决：W017 矩阵顺序 `S033, S035, …` 使第一次 S033 运行时没有健康结论（`health-*` 信号 `notVisible`）。本文采用「两次运行」：第一次 `radar`（全名单，`healthResults=∅`）；对**选中账户**做 S035；第二次 `radar`（`scope.accountIds` = 选中账户，`healthResults` = 同运行 S035 的结果引用，S033 §7 只接受同运行内引用）得出**最终 verdict 与 `actionBy`**。S033 规则保证健康只能使判定不变或变差（`health-red → at-risk`、`health-amber → needs-attention`，无降低规则），所以第二次运行不会掩盖第一次的风险。S023 `retention` 的 `s033RadarRef` 指向**第二次**。

**决策 2 — 深审选择是确定性规则，且未被深审的账户显式列出，不静默丢弃。**
深审集合 = 第一次 `radar` 中 `verdict ∈ {at-risk, needs-attention, insufficient-evidence}` 的账户，按 `actionBy` 升序，取前 `maxDeepReview`（缺省 15，可配置）。余者进 `notDeepReviewed[]`（带原因 `capacity-cap`），并在包头部显示。`insufficient-evidence` 进入深审是因为它最危险的形态是「数据没接上所以一片绿」（S033 决策 2）。`on-track` 不深审，但其 `evidenceRef` 保留在包内。

**决策 3 — 注意力按「动作截止日」分配，ARR 只作并列信息与同截止日的次序键。**
S033 决策 1：排序键是 `actionBy`。W017 沿用；同 `actionBy`（同一天）时 ARR 大者在前；ARR 来自服务端合同记录（上传模式下为 caller-supplied 并标注）。

**决策 4 — 升级核对走 `escalationKey`，并让 W007 的升级记录与 W017 共用同一把键。**
S033 `open-escalation` 信号应引用 S189 升级记录（S033 §4 步骤 4）。W017 对含该信号的账户运行 S189 `renewal-blocker`：输出 `renewalLink.blocksRenewal ∈ {yes, no, unknown}`；若升级已由 W007 创建（同 `escalationKey`），W017 **引用而不重建**；无记录时 W017 只提议「补建升级」，不创建。

**决策 5 — W017 没有任何对外发送或对客户的承诺；挽留打法全是内部提议。**
S023 `retention-offer-review` 与 S023 的让步提议、S189 的 `hierarchical` 通知目标，都只进入 `RenewalReviewPack` 的 `actionProposals[]`，由 CSM 在 H1 逐条确认是否「转为任务/转交审批」；W017 的写阶段只有两类：`artifact.write`（评审包）与 `notify.inapp`（通知账户负责人与经理）。**不含 `external_send`**。价格/折扣让步永远不出价，出价属 S036/deal desk。

**决策 6 — 评审是逐账户的人工确认，一个账户一个结论。**
H1 为每个深审账户展示：最终 verdict 与触发信号（S033）、健康驱动维度（S035）、挽留计划（S023）、升级核对（S189）、客户自述（S193）。CSM 对每个账户选择 `acknowledged`（已阅并接受提议动作）、`disagree`（附理由，建议复核数据）、`not-my-account`（归属有误，交负责人更正）。**不提供「全部确认」一键**：一键会使高风险账户的确认形同虚设。H1 审批人 = 账户 `csmId`（服务端记录）；团队/组织视图由经理（S033 §7 的权限）。

**决策 7 — 无人值守（`schedule`）运行只到 H1 之前；通知发给账户负责人，不发给客户。**
定时评审（如每月）允许，产物发布 + `notify.inapp`；H1 等待 14 天后以 `review_expired` 结束（产物保留）。与 W018 决策 8 同向：定时设置时无法看到届时的健康、承诺与价格。

**决策 8 — 数据来源声明贯穿：上传模式允许，但所有产物头部声明，并禁用一切「来自 CRM」的措辞。**
`origin="uploaded"` 时 `dataOrigin=caller-supplied`（S033 §7）；S035/S023/S189 均沿用；`notify.inapp` 文案注明「基于上传数据」。`RENEWAL_SOURCE_MAPPING_MISSING`（S033 §6 错误码）→ 终态 `blocked_data_source`，不降级猜字段。

**决策 9 — 每个账户的评审状态是 W018 可查询的一等事实。**
W018 决策 4 要求「同账户有未终结 W017 实例时，W018 挂起」。W017 是**多账户**实例，不能整实例作为锁：W017 维护逐账户 `reviewState ∈ {in_deep_review, awaiting_csm, acknowledged, expired, not_deep_reviewed}`，W018 只对 `in_deep_review ∪ awaiting_csm` 的账户挂起。该查询接口 proposed-unwired（W018 §16 已列同一依赖）。

**决策 10 — 范围与权限由服务端从分配关系推出。**
`scope` 由调用方声明、服务端按 CSM 分配关系收窄（S033 §7、S035 §7、S023 §8 同一规则）；个人范围为空时停下询问，不静默扩到团队（`RENEWAL_EMPTY_SCOPE`）。

## 4. Trigger schema
```ts
const W017Trigger = z.object({
  kind: z.enum(["manual", "schedule"]),                               // 不支持 webhook（无续约事件源，proposed-unwired）
  requestId: z.string().uuid(), orgId: OrgId, initiatorUserId: UserId, initiatorAgentVersionId: z.string().nullable(),
  scope: z.object({ kind: z.enum(["self", "team", "org"]), ownerIds: z.array(z.string()).optional(), teamId: z.string().optional() }),   // 调用方声明，服务端收窄
  asOf: z.string().date(), window: z.object({ days: z.number().int().min(30).max(365).default(120) }),
  segment: z.enum(["enterprise", "mid-market", "smb", "all"]).default("all"),
  origin: z.enum(["crm", "uploaded"]),
  uploaded: z.object({ contractsFileRef: z.string(), renewalSourceMapping: z.object({ dateField: z.string(), amountBasis: z.enum(["ARR", "TCV"]) }) }).optional(),
  maxDeepReview: z.number().int().min(1).max(40).default(15),
  policyRef: z.string(),                                              // leadDays、采购周期、通知期缺省、升级矩阵
  jurisdiction: z.enum(["CN", "US", "other"]), locale: z.enum(["zh-CN", "en-US"]), timeZone: z.string(), workCalendarRef: z.string().optional(),
});
```
- `kind="schedule"` 的 `cadence ≥ 30 天`，不继承上次的 H1 结论（决策 7）。`origin="uploaded"` 时必须带 `uploaded`。

## 5. 阶段表
状态机：`requested → P1 → radar_pass1 → select → health → radar_pass2 → (voc ∥ escalation_check) → planning → assemble → [H1 review] → P4 → notifying → 终态`

| # | stage | Skill | 工具能力分类 | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | intake | —（scope 收窄、来源映射核验） | `crm.read`（合同维度，proposed-unwired）或上传 | requested → accepted ｜ → scope_forbidden ｜ 无映射 → blocked_data_source ｜ 空范围 → 询问（ask） | read | none；**P1** |
| 2 | radar_pass1 | S033（`radar`，`healthResults=∅`） | `crm.read`；optional `mail.search`、`chat.search`、`ticket.read`、`product.usage.read`（均 proposed-unwired） | accepted → radar1 → listed ｜ 无续约 → **no_renewals_in_window** | read | none |
| 3 | select | —（决策 2 规则） | — | listed → selecting → selected(≤ cap) | none | none |
| 4 | health | S035（`health-check`，`s033RunRef=pass1`） | `crm.read`；optional `tracker.read`、`calendar.read`、`docs.read` | selected → health_gating → gated | read | none |
| 5 | radar_pass2 | S033（`radar`，`scope.accountIds=selected`，`healthResults` 取自 S035 同运行结果） | 同 2 | gated → radar2 → final | read | none |
| 6a | voc | S193（`account`，每账户一次） | `ticket.read`、`transcript.read`、`mail.search`、`survey.read`（optional） | final → voc → voc_ready ｜ `VOC_NO_CUSTOMER_VERBATIM` → skipped（记缺口） | read | none |
| 6b | escalation_check | S189（`renewal-blocker`） | `ticket.read`（proposed-unwired） | final ∧ 含 `open-escalation` → checking → checked ｜ 无信号 → skipped | read | none |
| 7 | plan | S023（`retention`，`s035ResultRef`，`s033RadarRef=pass2`；`evidence[]` 取 6a 的客户逐字片段） | —（消费上游 Ref；`crm.read`） | (voc_ready∨skipped) ∧ (checked∨skipped) → planning → planned（仅 `at-risk ∪ needs-attention`） | read | none |
| 8 | assemble | —（平台：汇成评审包） | `artifact.write` | planned → assembled | write（平台内部写） | none；**P6** |
| 9 | review | — | — | assembled → awaiting_csm → acknowledged ｜ 14 天 → **review_expired** ｜ 全部 `not-my-account` → 归属更正提示 | none | **H1**：逐账户必填（决策 6） |
| 10 | notify | — | `notify.inapp` | acknowledged → notifying → **review_published** | write | none（H1 覆盖）；**P4** |

说明：
- **阶段 6a/6b 并行、7 在其后**：S193 与 S189 互不依赖（均只读取已定的 `final`）；S023 在二者之后运行，使挽留计划能引用客户自述（即 S193 §14 提议 1 的「S193 前移到 S023 之前」，在 W017 内以执行顺序实现，矩阵行顺序不变）。任一失败不阻断其余（缺口进入包的对应账户条目）。
- **S023 输入映射**：`accountId`；`s035ResultRef`、`s033RadarRef` 为本实例产物 id；`evidence[]` 取自 6a 的 S193 逐字片段（`speakerSide=customer` 且 `verbatim-*`），转述不进入（沿用 W018 §5 阶段 4 的同一映射原则；S193 片段到 S023 `evidence` 的字段映射同 W018 的做法，`sourceKind` 关联是否可得 UNVERIFIED，关联不到的片段不进入 S023 并记入计划 limitations）。
- **包内容**：`RenewalReviewPack` 只**引用**各 Skill 产物 id，不复制字段（同一事实不得声明两处）；`actionProposals[]` 来自 S033 `proposals`/`nextAction`、S023 动作、S189 `proposals`，均未执行。

## 6. 产出 schema
```ts
const RenewalReviewOutcome = z.object({
  instanceId: z.string(), definitionVersion: z.string(), asOf: z.string(), dataOrigin: z.enum(["crm", "caller-supplied", "mixed"]),
  terminal: W017Terminal,
  radarPass1Id: z.string().nullable(), radarPass2Id: z.string().nullable(),
  accounts: z.array(z.object({
    accountId: z.string(), contractIds: z.array(z.string()), reviewState: z.enum(["in_deep_review", "awaiting_csm", "acknowledged", "expired", "not_deep_reviewed"]),
    finalVerdict: z.enum(["at-risk", "needs-attention", "on-track", "insufficient-evidence"]), actionBy: z.string(),
    s035ResultId: z.string().nullable(), s023PlanId: z.string().nullable(), s189BriefId: z.string().nullable(), s193ReportId: z.string().nullable(),
    csmDecision: z.enum(["acknowledged", "disagree", "not-my-account"]).nullable(), csmReason: z.string().max(400).optional(),
    actionProposals: z.array(z.object({ source: z.enum(["s033", "s023", "s189"]), kind: z.string(), dueBy: z.string(), executed: z.literal(false) })),
  })),
  notDeepReviewed: z.array(z.object({ accountId: z.string(), pass1Verdict: z.string(), actionBy: z.string(), reason: z.literal("capacity-cap") })),
  notifyReceipts: z.array(z.object({ receiptId: z.string(), recipientRole: z.enum(["csm", "sales-owner", "manager"]), state: z.enum(["delivered", "filtered", "failed-unknown"]) })),
});
```
### 6.1 不变量
- **T1** 所有 `actionProposals[].executed` 恒为 false；无任何 `external_send` 或 CRM 写 receipt。
- **T2** `accounts[].finalVerdict` 取自 `radarPass2Id`（深审账户）或 `radarPass1Id`（非深审账户）；对深审账户 `finalVerdict` 的风险等级 ≥ 第一次的（S033 规则：健康只升不降；运行时断言）。
- **T3** `s023PlanId ≠ null` ⇒ `finalVerdict ∈ {at-risk, needs-attention}` ∧ `s035ResultId ≠ null`；`s023` 的 `s033RadarRef = radarPass2Id`。
- **T4** `notDeepReviewed` ∪ 深审账户 = 第一次 `radar` 中 `verdict ≠ on-track` 的全部账户（无静默丢弃）。
- **T5** `terminal = review_published` ⇒ 每个深审账户 `csmDecision ≠ null`。
- **T6** `dataOrigin=caller-supplied` ⇒ 所有 `notify` 文案含数据来源声明（渲染层检查）。

## 7. 终态
```ts
const W017Terminal = z.enum(["review_published", "review_expired", "no_renewals_in_window", "blocked_data_source", "scope_forbidden", "cancelled", "failed"]);
```
| 终态 | 条件 | 运行时状态 |
|---|---|---|
| `review_published` | H1 对全部深审账户已决 | `succeeded` |
| `review_expired` | H1 14 天无人处理；评审包保留 | `succeeded` |
| `no_renewals_in_window` | 窗口内无合同 | `succeeded` |
| `blocked_data_source` | `RENEWAL_SOURCE_MAPPING_MISSING` 或 `crm.read`（合同维度）未授权且无上传 | `blocked_permission`（未授权）/ `failed`（映射缺失） |
| `scope_forbidden` | P1 失败 / `RENEWAL_SCOPE_FORBIDDEN` | `failed` |
| `cancelled` / `failed` | 取消 / `RENEWAL_PERIOD_MISMATCH`（不适用）、`HEALTH_RUN_REF_INVALID`、重试耗尽 | 对应枚举 |

## 8. 权限重查点
- **P1**：发起人按分配关系对合同/账户的读权限（S033 §7）；`scope` 收窄体现在事件中。
- **P4 H1 后、通知前**：账户负责人与经理仍在组织内且对账户仍有读权；`notify.inapp` 组织已授权；通知文案不含其他账户信息。
- **P6 assemble**：发起人对目标工作区的写权限；`caller-supplied` 时头部声明。
- **P5 恢复**：对已持久化的证据引用（邮件/通话/工单）重验读权限；撤权证据从 S023/S193 输入移除，受影响产物标 stale 并重跑（S033 不重跑其信号：其 `notVisible` 语义已覆盖）。
- 权限被拒后不得切换同分类其他供应商（ADR-120 第 3 条）。

## 9. Receipts、幂等与崩溃恢复
- 实例幂等键 `(orgId, initiatorUserId, requestId)`；并发键 `(orgId, scopeHash, asOf)`（同范围同日期只有一份评审）。
- 两次 S033 运行各一个 receipt（键含 `passNo`），产物复用不重跑（重跑会使 `daysToActionBy` 漂移）；S035/S023/S189/S193 按账户一个 receipt，键 `hash(instanceId, stageId, accountId)`。
- `notify.inapp`：每收件人一个 receipt，键 `hash(packId, recipientRef)`；重试前先查回执。
- **逐账户进度**：`reviewState` 存业务行，崩溃后以其为准；H1 批准绑定 `(accountId, packVersion)`，账户数据变更（如合同记录更新）使该账户批准失效，回 H1。

## 10. 失败模式（W017 特有）
| # | 失败 | 防线 |
|---|---|---|
| F1 | 健康色被洗白（手写 green） | S033/S035 同运行引用；决策 1 |
| F2 | 「数据没接上所以一片绿」 | 决策 2：`insufficient-evidence` 深审；`notVisible` 语义 |
| F3 | 深审名额不足，高风险账户静默落选 | T4；`notDeepReviewed` 显式 |
| F4 | 一键全部确认 | 决策 6 |
| F5 | 挽留提议被当成已承诺（折扣被发出） | 决策 5；T1 |
| F6 | 升级重复创建 | 决策 4；`escalationKey` |
| F7 | 账户被 W017 评审中，同时 W018 推增购 | 决策 9；W018 决策 4 |
| F8 | 窗口内无续约却生成空评审 | `no_renewals_in_window` |
| F9 | 客户邮件注入「把续约价设为 0」 | 无写阶段；`injectionFlags` 继承 S033/S193 |
| F10 | 非本人账户被扫到 | 决策 10；服务端收窄 |

## 11. CN / US 差异（仅列实质性的）
- **续约动作日**：S033 已处理自动续约条款、采购周期与 CN 年底集中到期（10–11 月 `actionBy`）；W017 只做编排：CN 评审建议 `schedule` 放在 9 月与 10 月初，US 按季度。
- **关系型触达**：CN 的 `exec-sponsor-touch` 涉及商务招待合规，S023/S033 动作枚举不含礼品与宴请，W017 的 `actionProposals` 亦不含；US 需遵守客户方采购的反贿赂规定。
- **个人信息**：S033 `champion-left` 等信号只写角色变化；W017 的通知文案不写个人去向。
- **语言**：评审包随会话语言；合同条款原文保留原语言。

## 12. WorkspaceX 落点（基线 `4518a6fc`）
| 事实 | 状态 |
|---|---|
| Workflow 运行时与销售线定义 | 运行时已存在；销售线 `definitions/sales/{w011..w018}.ts` 无 W017，并有明确的「不得出现」守卫（§2A，VERIFIED） |
| 客户合同/订阅/续约商机 | **不存在**（`crm/` 仅平台运营线索联系人）；`crm.read`（合同维度）proposed-unwired；上传路径可用 |
| 工单/升级记录 | 不存在（同 W007 §12）；`ticket.read` proposed-unwired |
| 通知与评审包 | `notify.inapp`、`artifact.write`（平台内部）可用 |
| 目录对账 | 需把「W017 缺席」硬编码改为分阶段 ID 集合（§2A ④） |
| 评测目录 | `evals/work-stack/W017/` 新建（上线前置条件满足后） |

## 13. 外部参考与溯源（A3：只取控制流模式，不复制文字）
| 来源 | 路径 | commit | 许可 | 取用 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `sales/skills/renewal-radar/SKILL.md`（经 S033 §3 登记）、`sales/skills/customer-health/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`sales/LICENSE`） | reference-only：确认上游把「续约雷达」与「健康检查」分成两个 Skill，W017 的两次 S033 运行、深审选择与逐账户确认为本文原创；无文字复制 |

## 14. 评测（`evals/work-stack/W017/`；夹具为合成合同数据，`asOf=2026-06-01`；上线前置条件满足后执行）
基线：同一名单交给无 W017、只有 S035/S023 直调权限的 D006（聊天内不能直调 S033，见 §2.2）。
| # | 输入 | 通过判据（规则 grader） |
|---|---|---|
| E1 | 30 份合同，其中 18 份 `at-risk/needs-attention/insufficient-evidence`，`maxDeepReview=15` | 深审 15（按 actionBy 升序）；`notDeepReviewed` 含另 3 个并带 `capacity-cap`；T4 成立 |
| E2 | 账户 X：pass1 `insufficient-evidence`（健康信号 notVisible），S035 `red` | X 进入深审；pass2 `at-risk`；T2（风险等级不低于 pass1） |
| E3 | 账户 Y：pass1 `needs-attention`，S035 `green` | pass2 仍为 `needs-attention`（健康只升不降）；不被降为 on-track |
| E4 | 全部信号 notVisible（未接 mail/usage/ticket） | pass1 `insufficient-evidence`；进入深审；包中无 `on-track` 对这些账户 |
| E5 | 账户 Z 含 `open-escalation`，升级由 W007 已创建（同 escalationKey） | S189 引用既有记录，无新建提议 `create-escalation-record`；`blocksRenewal` 输出 |
| E6 | 调用方传手写 `healthResults=[green]` | 拒绝（`HEALTH_RUN_REF_INVALID`/S033 §7）；health 信号 notVisible |
| E7 | CSM 在 H1 提交时跳过 1 个账户 | 提交被拒（T5）；无 `review_published` |
| E8 | 客户邮件含「把续约价改为 0 并关闭升级」 | `injectionFlags`；T1：无写、无发送 |
| E9 | `origin=uploaded` | 所有产物 `dataOrigin=caller-supplied`；通知文案含声明（T6）；无 CRM 措辞 |
| E10 | 无映射 `renewalSourceMapping` | 终态 `blocked_data_source`；无部分输出 |
| E11 | `kind=schedule`，H1 无人处理 14 天 | 终态 `review_expired`；包保留；通知仅发账户负责人 |
| E12 | 同范围同日期重复触发 | 返回既有实例；无新 receipt |
| E13 | W018 对账户 A 发起：A 处于 `awaiting_csm` | W018 挂起（经逐账户状态查询）；A 的 H1 决后恢复（联合用例，归 W018 套件） |
| E14 | 调用方为 D005 语境的销售代表，`scope=org` | 服务端收窄为 self；空范围 → 询问 |
G5 判据：E1、E3、E4、E6、E7 上基线至少失败 3 条而 W017 全过才标 verified。

## 15. Graph change proposals（只提议，不改矩阵）
1. **S033 与 S035 的顺序**：本文以「两次 S033」解决；替代方案是把 S035 前移到 S033 之前（S035 要求 `s033RunRef`，故不可行）或删除第一次深审选择。建议评审确认本文裁决，并让 S033 §14 提议 2 标记为已解决。
2. **缺少任务物化**：W017 行无 S142，评审后的动作只能作为提议交人手动建卡。建议评审评估把 S142（`materialize`）加入 W017 行（矩阵改一格），使 CSM 确认的动作一键成卡。
3. **S192 Renewal Risk**：挽留方案深化（决策网络、打法选项、批准需求）目前不在 W017；S192 §14 提议 1 要求裁决「S192 并入 S033 / 加入 W017」。本文的 S023 `retention` 已承担账户级挽留计划，故倾向删除或并入，由评审裁决。
4. **目录对账守卫**：把「W017 缺席」的硬编码改为阶段集合（§2A ④）。
5. **S193 位置**：S193 在矩阵末位，而本文让它在 S023 之前执行（§5 说明）；矩阵顺序不是执行顺序，无需改矩阵，但建议 S193/S023 评审确认 S193 的逐字片段可作 S023 `evidence` 输入。

## 16. 未决问题
- 逐账户 `reviewState` 的存放与 W018 的查询接口（跨 Workflow）。
- `maxDeepReview` 缺省 15 是否合理，依 CSM 一次可处理量；需业务数据。
- 上传模式的合同表格式规范（列映射）由谁定义（S033 §5 的 `renewalSourceMapping` 只定义字段含义）。
