# W018 — Account Expansion

> 类型：Reference Workflow · 域：Sales · 作者化任务：AUTHOR-W018 · 状态：待独立评审
> 基线：`main@30c1c4332025151610502988b0379b95ff7298c7`（本文所有 VERIFIED 均指该提交可达的工作树；未读文件核实的陈述一律标 UNVERIFIED，未实现/未接线的能力一律标 proposed-unwired）。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时：ADR-118（第 5 条版本冻结、第 6 条 effect-gateway、第 9 条 Workflow 固定 Skill 版本）；工具分类：ADR-120；评测门：ADR-119。
> 对齐的已 PASS 契约（只引用，不改）：`skills/S036-proposal-builder.md`、`skills/S021-customer-intelligence.md`、`skills/S009-customer-research.md`、`skills/S023-account-planning.md`、`skills/S035-customer-health.md`（reviews 均为 Verdict: PASS）。W018 只消费它们 `mode = expansion / expansion-gate / account-dossier` 下的字段；这些字段若在其定稿时改名，本文 §6 映射随之修订，W018 的控制流与决策不依赖其具体改名。

## 1. 这个 Workflow 解决什么（边界）
对**一个已是客户的账户**，回答「现在该不该谈扩张；如果该，谈什么、找谁、报什么价」，并把答案一路推到**一份经内部审批、可发给客户的增购/升级方案**（或明确停在「先别谈扩张」）。

它不是：
- W014 Opportunity-to-Close：新商机推进到成交（S032 出业务论证，S036 用 `mode = "new-deal"`）。W018 的方案是增量报价，没有 S032，**不写 ROI**（S036 决策 2）。
- W017 Renewal Risk Review：到期风险与挽留（S033 先行）。W018 不算续约风险；账户处于 S035 `churned-notice` 时 W018 不谈扩张。
- W013 Meeting-to-Opportunity：从一次会议里建商机。W018 的起点是账户，不是会议。

W018 的终点二选一：**方案经 H2 审批（并可经 H3 发给客户）**，或**计划停放（扩张被健康门阻断 / 负责人没有选中任何打法）**。两者都是正常完成，不是失败。

## 2. 组合图（精确 ID，来自两张矩阵）

### 2.1 参与 Skill（WORKFLOW-SKILL-MATRIX.md 第 24 行：`W018 | Account Expansion | Sales | S021, S035, S023, S036, S009`）
| Skill | 名称 | 在 W018 中的唯一职责 | 调用模式 |
|---|---|---|---|
| S021 | Customer Intelligence | 主体识别 + 内部足迹 + **组织/业务变化带来的新购买单元信号**（`newBuyingUnitSignals`）；不打分、不推荐 | `mode = "expansion"`，`scope = "subject-only"`（S021 步骤 2 的 W018 缺省） |
| S009 | Customer Research | 客户自述需求/痛点（只收逐字）与**我方承诺台账**（`dossier.commitments`） | `mode = "account-dossier"` |
| S035 | Customer Health | 扩张就绪门：`expansionReadiness ∈ {ready, conditional, blocked}` | `mode = "expansion-gate"` |
| S023 | Account Planning | 足迹表、关系覆盖矩阵、白区四因子排序；被阻断时把白区置 `parked` 并只出解除阻塞动作 | `mode = "expansion"` |
| S036 | Proposal Builder | 对负责人选中的打法出增量报价草稿（`ProposalDraft`，双视图） | `mode = "expansion"` |

矩阵行里的 Skill 顺序不是执行顺序（S009 §2.1、S036 §2.1 均声明「顺序以 W018 文档为准」）。本文的执行顺序见 §5。
Skill 版本由 `WorkflowDefinition(W018, v1).stages[*].skills[*] = {stableId, versionRange}` 在启动时解析并冻结进实例（ADR-118 第 5 条）。发起 Agent **不需要**挂载这些 Skill（ADR-118 第 9 条），只需在其 `workflowAllowlist` 中被允许运行 W018 v1（ADR-116 第 3 条；`workflowAllowlist` 字段在基线代码中不存在，`grep -rn workflowAllowlist apps packages` 无命中 → proposed-unwired）。

### 2.2 消费者（DIGITALHUMAN-COMPOSITION-MATRIX.md 中 Exact Workflows 含 W018 的行，共 2 个）
- **D005 Sales Representative**（第 11 行）：Workflows 列 `W011, W012, W013, W014, W015, W016, W018`。其 Skill 列含 S021、S023、S036，不含 S035、S009。
- **D006 Customer Success Specialist**（第 12 行）：Workflows 列 `W007, W017, W018, W002, W006`。其 Skill 列含 S035，不含 S021、S023、S036、S009。

两者在 W018 阶段内都使用 W018 固定的五个 Skill 版本；Skill 列的差异只影响聊天直调，与 W018 能否运行无关（ADR-118 第 9 条）。消费者差异在 W018 中**只**体现为发起人的授权来源与 H2 的签核人（决策 5），不体现为不同阶段。

### 2.3 相邻 Workflow（划界，不是依赖）
- W017：S035 在 W017 中为 `health-check`/`qbr-prep` 并且有 S033 引用；W018 中通常没有 S033，S035 商业维度可能 `not-visible`（S035 步骤 7 已声明这是预期）。W018 不调用 S033，也不接收 W017 的结果作输入——同一账户若有进行中的 W017 实例，见决策 4。
- W014：W018 的 H2 批准后若负责人要转入完整成交推进（多轮谈判、成交计划），由负责人另起 W014；W018 不自动启动 W014。

## 3. 实体特有决策

**决策 1 — 执行顺序：S021 ∥ S009 → S035 → S023 → [H1] → S036；健康门在任何「打法」出现之前。**
- S021 与 S009 互不依赖（S009 §2.1：三种模式对先后不敏感），并行执行以缩短墙钟。
- S035 必须在 S023 之前：S023 `expansion` 的 I1 要求 `s021DossierRef ∧ s035ResultRef`，其决策 3 规定 `blocked` 时全部白区 `parked`；若先排白区再判健康，负责人会先看到打法再被告知不能谈，这正是 upstream `expansion-whitespace` 流程（ground → own → whitespace → rank → propose）缺少的一道门（S035 决策 6：未兑现价值就谈扩张是扩张后缩量的主因）。
- S009 的承诺台账在 S023 之后、S036 之前由 H1 呈现（决策 2），不喂给 S035 判色（S035 I4：不可信文本不参与判色）。
- `blocked` 时 S023 **仍然运行**：它产出解除阻塞动作（S023 决策 3），这是 `expansion_blocked` 终态的主要产物；S036 不运行。

**决策 2 — 未兑现承诺是 H1 的逐条处置项，不是 S036 的输入过滤条件。**
S009 A2 产出 `commitments[]`，`status ∈ {evidenced-met, evidenced-open, unknown}`，并明确「S009 只列事实，不判断能否扩展」。W018 规则：
1. 每条 `evidenced-open` 与 `unknown` 承诺在 H1 上必须被负责人逐条处置：`fulfil-first`（该打法停放，生成一条内部跟进动作）或 `proceed-with-disclosure`（继续，但该承诺进入 S036 的 `requestedTerms`，`topic = "prior-commitment"`，从而在 `nonStandardTerms` 中登记，由 owner 团队裁定是否在方案中说明）。
2. 不允许「全部一键继续」：H1 表单对每条未处置承诺都是必填项。
3. 若某打法的 `buyingUnit × product` 与一条 `evidenced-open` 承诺的内容指向同一产品（按 S023 `footprint.product` 与承诺文本中的 SKU/产品名精确匹配；匹配器 proposed-unwired），该打法在 H1 上缺省为 `fulfil-first`，负责人改为继续须填理由（写入事件）。
理由：对客户未兑现的功能/交付承诺之上再卖同一产品，是扩张谈判中最常见的信任破坏；但是否「先兑现再谈」是商业判断，归负责人，不归 Skill。

**决策 3 — 每个实例只对一个账户、至多 3 个打法出方案；打法由人选，Skill 不代选。**
S023 输出排序后的 `whitespace[]`（四因子 0–12 分）。W018 不按分数阈值自动选打法：H1 由负责人从 `status = "hypothesis"` 的白区项中选 0–3 个。选 0 个 → 终态 `plan_only`。上限 3 的理由：每个选中打法产生一份 S036 草稿、一次审批带判定；超过 3 个时审批人实际上是在审一份组合报价，应改走 W014 的单商机路径。「一个账户」的理由：S035 `expansion-gate` 虽支持 `accountIds` 1..200，但一个批量扩张清单没有逐账户的承诺处置与报价审批，不能称为扩张方案；账户簿扫描不属于 W018（见 §15 提议 3）。

**决策 4 — 同一账户同时只能有一个进行中的 W018 实例；进行中的 W017 实例使 W018 在 H1 前挂起。**
- 并发键 `(orgId, accountId)`。第二个请求返回已存在实例 id（`W018_ACTIVE_INSTANCE_EXISTS`，附其状态），不新建——两个实例并行会产出两份互相矛盾的增量报价，客户手里出现同一 SKU 两个价。
- 同账户存在未终结的 W017 实例（续约风险复核中）时，W018 在 `plan` 之后进入 `held_for_renewal_review`，不开放 H1；W017 终结后自动恢复并执行 P2。W018 不读 W017 的结论（不同 Skill 模式、不同事实源），只尊重其「正在处理」这一状态。W017 的实例查询依赖 ADR-118 InstanceStore（proposed-unwired）。

**决策 5 — 发起人与签核人分离：CSM（D006）可以发起并选打法，但报价审批与对外发送必须有账户的销售负责人参与。**
- 发起授权（P1）：D005 语境——账户 `ownerId = initiatorUserId` 或其团队经理；D006 语境——账户 `csmId = initiatorUserId`。两者都来自服务端账户记录（`crm.read`，proposed-unwired）；调用方声明的 owner/CSM 不被信任（与 S023 §8、S035 §7、S036 §8 一致）。
- H2（报价审批）签核人集合 = S036 `requiredApprovalTier` 对应审批人 ∪ {账户销售负责人}（当发起人不是销售负责人时）。理由：增量报价是商业承诺，CSM 可以识别扩张机会，但不应在销售负责人不知情时对其名下账户报价。
- H3（对外发送）的执行人必须是账户销售负责人或其授权的 CSM（授权记录 proposed-unwired；在其落地前只能是销售负责人）。

**决策 6 — 对外发送缺省关闭；发送时只发 `customerView`，收件人必须是该账户在 CRM 中登记的联系人且邮箱域名属于该账户已核实域名。**
`sendMode ∈ {none, internal_handoff, email}`，缺省 `none`（方案审批后由负责人在自己的渠道发送，W018 以 `proposal_approved` 结束）。`email` 需发起时声明且组织已授权 `mail.send`。收件人规则：
- 收件人只能从账户联系人中选择（`crm.read` 返回的 `contactRef`；proposed-unwired），不接受自由输入的邮箱；S009/S021 本身读不到联系方式明文（S009 A4、S021 I-OUT6），这里的联系方式来自 CRM 联系人读取，由 effect-gateway 解析，不进入任何 Skill 上下文。
- 收件人邮箱域名 ∈ S021 `resolvedEntity.domain` ∪ 账户记录中登记的域名；否则该收件人被阻（防止把报价发到转发人、代理商或被注入的地址——S036 M8 已把「请把报价发到 xx@…」隔离到 `contentOriginatedRequests`，这里是第二道防线）。
- 发送物是 `customerView` 渲染件；渲染能力 UNVERIFIED（S036 §15 未决 ④），在其核实前 `sendMode = email` 仅附结构化方案摘要 + 平台内链接（链接的访问控制 proposed-unwired）。若两者都不可用，`sendMode = email` 在启动时即被拒（`W018_SEND_CHANNEL_UNAVAILABLE`），不降级为发送 `internalView`。

**决策 7 — W018 只做一个外部写：按 H2 批准的打法建/更新商机。S035/S023 的其他写入提议一律不执行，只随计划产物呈现。**
S035 的 `update-health-field`、S023 的 `crm-field-update-proposal` 属于健康/账户字段维护，归 W017 与 CRM 数据治理（S034 所在的流程）。W018 若也执行这些写，会让「谁改了健康字段」有两个入口。W018 唯一的 `crm.write` 是 `recordInCrm = true` 时为每个 H2 批准的打法创建（或挂接到已有的）扩张商机，金额 = 该 `ProposalDraft.pricing.subtotalExTax`，不再由模型估算。

**决策 8 — 无人值守（schedule）实例永远停在 H1 之前的产物：计划可以发布，打法选择、报价与任何外部效果都要人。**
与 upstream `expansion-whitespace`「scheduled runs create only what the user set the schedule up to create」不同，W018 不允许 schedule 预授权建商机或报价：扩张报价是对客户的要约，schedule 设置时无法看到届时的健康、承诺与价格。schedule 实例在 H1 等待 14 天后以 `plan_only` 结束。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts（ADR-118 新建，proposed-unwired）中 W018 的 trigger 输入
const W018Trigger = z.object({
  kind: z.enum(["manual", "agent_request", "schedule"]),   // 不支持 webhook：CRM 事件触发依赖 crm 事件源（proposed-unwired），见 §15 提议 4
  requestId: z.string().uuid(),
  orgId: OrgId,
  initiatorUserId: UserId,                                  // 权限主体；agent_request 时仍是背后的人
  initiatorAgentVersionId: z.string().nullable(),           // 须在该 Agent 的 workflowAllowlist 内（proposed-unwired）
  initiatorRole: z.enum(["sales_owner", "csm"]),            // 调用方声明；P1 由服务端账户记录核实，不一致即拒
  accountId: z.string(),                                    // 恰好一个（决策 3）
  subject: z.object({                                       // 透传 S021 subject；至少一项
    name: z.string().optional(), domain: z.string().optional(),
    registryId: z.object({ scheme: z.enum(["cn-uscc", "us-ticker", "lei"]), value: z.string() }).optional(),
  }),
  asOf: z.string().date(),                                  // 同时作为 S021/S035/S023 的 asOf；schedule 取触发日
  horizon: z.enum(["quarter", "half", "year"]).default("half"), // 透传 S023 horizon
  evidenceWindowDays: z.number().int().min(90).max(730).default(365), // S009 window = [asOf − N, asOf]
  jurisdiction: z.enum(["CN", "US"]),
  locale: z.enum(["zh-CN", "en-US"]),
  currency: z.string().length(3),                           // ISO-4217；透传 S023/S036
  procurementContext: z.enum(["commercial", "cn-public-tender", "us-federal", "us-state-local"]).default("commercial"),
  recordInCrm: z.boolean().default(false),                  // true 才进入阶段 9（需 crm.write 授权）
  sendMode: z.enum(["none", "internal_handoff", "email"]).default("none"), // 决策 6
  deadline: z.string().datetime().optional(),
});
```
- `schedule` 只允许「同一账户、固定 cadence（≥ 30 天）」；不继承上次 H1 的打法选择或承诺处置（决策 8）。
- `sendMode = "email"` 与 `kind = "schedule"` 组合在启动时即拒（`W018_TRIGGER_INVALID`）。
- `procurementContext ≠ commercial` 直接透传 S036（其 §9 规定对应行为）；W018 不另判。

## 5. 阶段表
状态机：
`requested → P1 → gathering(S021 ∥ S009) → health_gating → planning → [held_for_renewal_review] → P2 → [H1 play selection] → proposing → [H2 approval] → P3 → (recording_crm) → [H3 send] → P4 → sending → 终态`

| # | stage | Skill IDs | 工具能力分类（ADR-120；均为提案名，`capabilityCategory` 在基线未出现） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | intake | —（平台：trigger 校验、并发键、账户与发起人核实） | `crm.read`（proposed-unwired） | requested → accepted ｜ → scope_forbidden ｜ → 返回已存在实例（决策 4） | read | none；执行 **P1** |
| 2a | intel | S021（`expansion`，`subject-only`） | `web.search`、`web.fetch`、`knowledge.search`、`knowledge.read`；optional `crm.read`、`registry.cn.read`、`enrichment.company.read` | accepted → gathering → intel_ready ｜ `EXPANSION_REQUIRES_EXISTING_ACCOUNT` → not_expansion_eligible ｜ `ENTITY_AMBIGUOUS` → awaiting_entity_choice（ask） | read | ask（仅实体歧义时） |
| 2b | dossier | S009（`account-dossier`） | `transcript.read`、`mail.search`、`crm.read`、`ticket.read`（S009 §9 conditional，按 `sourceKinds`；均经 S009 读取门） | accepted → gathering → dossier_ready ｜ `S009_SUBJECT_NOT_VISIBLE` → scope_forbidden | read | none |
| 3 | health_gate | S035（`expansion-gate`，`scope = {kind:"self", accountIds:[accountId]}`） | `crm.read`；optional `tracker.read`、`product.usage.read`、`calendar.read`、`docs.read` | intel_ready ∧ dossier_ready → health_gating → gated(ready｜conditional｜blocked) ｜ overall=`insufficient-evidence` → gated(blocked, blockedBy=["insufficient-evidence"]) ｜ 结果无 `expansionReadiness`（S035 R1/E15：`lifecycleStage = churned-notice`）→ gated(blocked, blockedBy=["expansion-readiness-absent"]) | read | none |
| 4 | plan | S023（`expansion`） | —（只消费本实例上游 Ref + `crm.read`） | gated → planning → planned ｜ `S023_FOOTPRINT_REQUIRED` → not_expansion_eligible | read | none |
| 5 | publish_plan | — | `artifact.write`（平台内部写） | planned → plan_published；gated=blocked → **expansion_blocked**；同账户有进行中 W017 → held_for_renewal_review | write | none；执行 **P6** |
| 6 | play_selection | — | — | plan_published → awaiting_selection → selected(1..3) ｜ selected(0) 或超时 → **plan_only** | none | **H1**：required；执行前 **P2** |
| 7 | propose | S036（`expansion`，每个选中打法一次） | `pricebook.read`（proposed-unwired）、`crm.read`（合同基线）、`knowledge.read`（批准内容替代，适用性 UNVERIFIED） | selected → proposing → drafted ｜ `S036_CONTRACT_BASELINE_UNAVAILABLE` 重试耗尽 → failed ｜ 全部打法 `S036_SKU_UNKNOWN` → awaiting_selection | read | none |
| 8 | approve | — | — | drafted → awaiting_approval → approved ｜ revise → proposing（新 version）｜ reject → **rejected** | none | **H2**：`requiredApprovalTier = none` 时 required（单签：销售负责人）；否则 multi-gate（销售负责人 + 审批带对应审批人）；`out-of-policy` 或 `readiness = blocked` 不可批准 |
| 9 | record_crm | — | `crm.write`（proposed-unwired） | approved → recording_crm → recorded ｜ P3 失败 → awaiting_approval（重审） | write（`写入外部`） | none（H2 覆盖）；执行前 **P3**；仅 `recordInCrm = true` |
| 10 | send | — | `mail.send`；或 `notify.inapp`（`internal_handoff`） | approved/recorded → awaiting_send → sending → **proposal_sent** ｜ 全部收件人被阻 → **proposal_approved** | high-impact（`对外发送`）；`internal_handoff` 为 write | **H3**：`email` 时 required（销售负责人本人）；每收件人发送前执行 **P4** |

说明：
- **阶段 2a/2b 的输入映射**：S021 `subject` 取自 trigger，`asOf` 同 trigger，`workflowRunRef` 由运行时注入。S009 `questions` 由 W018 固定为三条：`Q-NEED`「客户自述的新需求或新使用场景」、`Q-PAIN`「客户对现有产品的不满或阻碍」、`Q-COMMIT`「我方对该客户作出的交付/功能/价格承诺」；`subject = {kind:"account", accountRef: accountId}`；`window` 由 `evidenceWindowDays` 推出；`sourceKinds = ["call-transcript","email","meeting-note","crm-note","ticket"]`；`purpose = "account-planning"`。
- **阶段 3 的输入**：`accounts[0]` 的字段来自 `crm.read`（`origin = "crm"`）；`crm.read` 未接线时来自发起人上传（`origin = "uploaded"`，S035 §7：不得声称来自 CRM）。S035 的 `insufficient-evidence` 在 W018 中**按 blocked 处理**：可见维度 < 3 时无法证明客户已兑现价值（S035 决策 6 的延伸），这是 W018 的规则，不改 S035 的输出。S035 在 `churned-notice` 时不输出 `expansionReadiness`（S035 R1 / E15）：W018 同样按 blocked 处理，`blockedBy = ["expansion-readiness-absent"]`，与 S023 M5 的 `expansion-readiness-absent` 一致；终态 `expansion_blocked`。
- **阶段 4 的输入**：`s021DossierRef`、`s035ResultRef` 为本实例阶段 2a、3 的产物 id；`evidence[]` 只取 S009 `segments` 中 `speakerSide = "customer"` 且 `evidenceKind ∈ {verbatim-spoken, verbatim-written}` 的片段（映射：`evidenceRef = segmentId`；`kind`：S009 `CustomerSegment` 无 `sourceKind` 字段，W018 以片段的 `sourceId` 关联 S009 该来源读取时所属来源类（`corpus[].kind` / 读取记录；account-dossier 模式下该关联是否可得 UNVERIFIED，关联不到的片段不进入 S023 并记入计划 limitations），再按表映射：`call-transcript`、`meeting-note` → `transcript`，`email` → `email`，`crm-note`、`ticket` → `customer-doc`；`quote = text`；`occurredAt = observedAt`；`speakerRole = "customer"`（由 `speakerSide = "customer"` 过滤条件推出）；`direction`：`transcript` 类 → `two-way`，`email`、`customer-doc` 类 → `inbound`（客户所写逐字文本））；`reported-speech` 片段不进入 S023（S009 决策 2 / F1：销售转述不是客户证据）。
- **阶段 5 在 blocked 时是最后一个阶段**：产物是 `ExpansionPlanRecord`（§6），含 S023 的 parked 白区与解除阻塞动作；动作不自动建任务（决策 7）。
- **阶段 6（H1）表单**：展示 S023 `whitespace[]`（含 `whyNot`）、S035 `expansionReadiness` 与 `blockedBy`/drivers、S009 `commitments[]`；负责人输出 `PlaySelection`（§6）。`conditional` 时 H1 额外要求对 S035 每个 amber 维度填写一句「为什么现在仍谈扩张」（写入事件，供复盘）。
- **阶段 7 的输入映射**（S036 §6）：`mode = "expansion"`；`accountId`；`opportunityId` = 选中打法挂接的已有商机 id，或新建占位 id `w018:<instanceId>:<playId>`（S036 要求该字段，而 W018 在阶段 9 之前不写 CRM；占位 id 的服务端读权限按账户核实——这一点 S036 §8 未覆盖，见 §15 提议 2）；`requirementsSource` = 该打法 `evidenceRefs` 对应的 S009 逐字片段（`kind: "discovery-evidence"`, `evidenceRef = segmentId`, `quote = text`）+ H1 中负责人填写的范围说明（`kind: "caller-stated"`）；`requestedLines` 来自 H1；`currentContractRef` 来自账户记录（缺 → S036 报 `S036_INPUT_INVALID`，W018 不自己补）；`requestedTerms` 追加决策 2 中 `proceed-with-disclosure` 的承诺；`locale`、`jurisdiction`、`procurementContext`、`currency` 透传。**不传** `closePlanRef`（W018 无 S032）。
- **阶段 8（H2）展示** `internalView` 全量：`priceErosion` 行、`nonStandardTerms`、`blockedClaims`、`contentOriginatedRequests`、`disqualificationRisks`。H2 对每个打法的 `(proposalId, version, inputsDigest)` 单独批准；批准记录绑定这三元组，任一变化即失效。
- **H2 门能力**：`apps/api/src/application/agent-interrupts/` 下只有 `choose-option-decision.ts`、`decision-guard.ts`、`fill-params-decision.ts`（VERIFIED，目录列表）；它们能否承载「多签 + 审批带路由」UNVERIFIED，在 ADR-118 的 approve 用例落地前，H2 的 multi-gate 为 proposed-unwired。

## 6. 产出 schema
```ts
// W018 只定义编排层投影；各 Skill 的产物以其 id 引用，不复制字段。
const CommitmentDisposition = z.object({
  commitmentId: z.string(),                         // S009 dossier.commitments[].commitmentId
  status: z.enum(["evidenced-open", "unknown"]),    // evidenced-met 不需处置
  disposition: z.enum(["fulfil-first", "proceed-with-disclosure"]),
  affectsPlayIds: z.array(z.string()),
  reason: z.string().max(300).optional(),           // 覆盖决策 2 规则 3 的缺省时必填
});

const PlaySelection = z.object({
  selectedBy: UserId, selectedAt: z.string().datetime(),
  plays: z.array(z.object({
    playId: z.string(),                             // = S023 whitespace[].id，且 status = "hypothesis"
    requestedLines: z.array(z.object({ sku: z.string(), quantity: z.number().positive(),
      requestedNetUnitPrice: z.number().positive().optional(), termMonths: z.number().int().min(1).max(60) })).min(1),
    scopeNote: z.string().max(600),                 // → S036 caller-stated
    existingOpportunityId: z.string().optional(),
  })).max(3),                                       // 决策 3
  commitmentDispositions: z.array(CommitmentDisposition),
  conditionalJustifications: z.array(z.object({ dimension: z.string(), text: z.string().max(200) })), // 仅 conditional
});

const ExpansionPlanRecord = z.object({
  instanceId: z.string(), definitionVersion: z.string(), accountId: z.string(), asOf: z.string(),
  s021DossierId: z.string(), s009PackId: z.string(), s035ResultId: z.string(), s023PlanId: z.string(),
  expansionReadiness: z.enum(["ready", "conditional", "blocked"]),   // S035；insufficient-evidence 与 S035 未输出（churned-notice）均已映射为 blocked
  blockedBy: z.array(z.string()),
  openCommitmentIds: z.array(z.string()),           // S009 中 evidenced-open ∪ unknown
  newBuyingUnitSignalIds: z.array(z.string()),      // S021，供追溯 S023 timingSignal 因子
  dataOrigin: z.enum(["crm", "caller-supplied", "mixed"]), // = S035 scopeVerified.dataOrigin；caller-supplied 时页面头部必须声明
});

const ExpansionOutcome = z.object({
  instanceId: z.string(),
  terminal: W018Terminal,                           // §7
  plan: ExpansionPlanRecord.nullable(),             // not_expansion_eligible / scope_forbidden 时为 null
  selection: PlaySelection.nullable(),
  proposals: z.array(z.object({
    playId: z.string(), proposalId: z.string(), version: z.number().int(), inputsDigest: z.string(),
    requiredApprovalTier: z.enum(["none", "manager", "deal-desk", "finance-exec", "out-of-policy"]),
    approval: z.object({ approvers: z.array(UserId).min(1), approvedAt: z.string().datetime() }).nullable(),
  })),
  crmReceipts: z.array(z.object({ playId: z.string(), receiptId: z.string(), opportunityId: z.string(),
    action: z.enum(["created", "linked-existing"]), amountExTax: z.number() })),
  sendReceipts: z.array(z.object({ playId: z.string(), receiptId: z.string(), contactRef: z.string(),
    channel: z.enum(["email", "inapp"]), proposalVersion: z.number().int(),
    state: z.enum(["delivered", "blocked", "failed-unknown"]),
    blockReason: z.enum(["domain-mismatch", "contact-inactive", "customer-view-check-failed", "valid-until-passed", "permission-revoked"]).optional() })),
});
```

### 6.1 不变量（终态 ↔ 效果；运行时在写终态前断言，失败 → `failed` 并写 `W018_INVARIANT_VIOLATION`）
- **T1** `terminal ∈ {expansion_blocked, plan_only, not_expansion_eligible, scope_forbidden, rejected}` ⇒ `crmReceipts = []` ∧ `sendReceipts = []`。
- **T2** `terminal = expansion_blocked` ⇒ `plan.expansionReadiness = "blocked"` ∧ `proposals = []`（S036 从未被调用；S036 调用计数 = 0 由 receipt 表可复算）∧ S023 计划中所有 whitespace `status = "parked"`（S023 O3）。
- **T3** `proposals[].approval ≠ null` ⇒ `requiredApprovalTier ≠ "out-of-policy"` ∧ 该 `(proposalId, version, inputsDigest)` 的 S036 `readiness = "ready-for-review"` ∧ `approvers` ⊇ {账户销售负责人} ∪ 审批带审批人（决策 5）。
- **T4** 每条 `crmReceipts` 的 `playId` 对应 `proposals[].approval ≠ null` 的打法，且 `amountExTax = 该版本 pricing.subtotalExTax`。
- **T5** 每条 `sendReceipts.state = delivered` 的 `proposalVersion` 等于该打法 `approval ≠ null` 的最新 version；发送物来自 `customerView`（S036 I4/I5 在 P4 重跑通过）。
- **T6** `terminal = proposal_sent` ⇒ ∃ `sendReceipts.state = delivered`；`terminal = proposal_approved` ⇒ `sendReceipts` 中无 `delivered`。
- **T7** `selection.plays[].playId` 均在 S023 计划中且 `status = "hypothesis"`；每个 `openCommitmentIds` 元素在 `commitmentDispositions` 中恰好出现一次。
- **T8** `disposition = fulfil-first` 影响的 `playId` 不出现在 `proposals` 中。

## 7. 终态
```ts
const W018Terminal = z.enum([
  "proposal_sent", "proposal_approved", "plan_only", "expansion_blocked",
  "not_expansion_eligible", "scope_forbidden", "rejected", "cancelled", "failed",
]);
```
| 终态 | 条件 | 产物 |
|---|---|---|
| `proposal_sent` | H3 后 ≥1 收件人送达（`email`）或 `internal_handoff` 已投递 | 方案 + 审批记录 + SendReceipt（+ CRM receipt） |
| `proposal_approved` | H2 通过，`sendMode = none`；或 H3 被拒/超时 7 天；或全部收件人被 P4 阻断 | 方案 + 审批记录（+ CRM receipt）；被阻清单 |
| `plan_only` | H1 选 0 个打法、H1 超时（manual 7 天 / schedule 14 天）、或全部打法被 `fulfil-first` | 已发布计划 + 承诺处置 |
| `expansion_blocked` | S035 `expansionReadiness = blocked`（含 insufficient-evidence 映射） | 已发布计划（parked 白区 + 解除阻塞动作 + blockedBy） |
| `not_expansion_eligible` | S021 `EXPANSION_REQUIRES_EXISTING_ACCOUNT` 或 S023 `S023_FOOTPRINT_REQUIRED` | 原因码；建议负责人改用 W011/W012（仍是潜客）或先补足迹数据 |
| `scope_forbidden` | P1 失败；S009 `S009_SUBJECT_NOT_VISIBLE`；S023 `S023_SCOPE_FORBIDDEN`；S035 `HEALTH_SCOPE_FORBIDDEN` | 无；错误文本不区分「账户不存在」与「无权」 |
| `rejected` | 所有打法在 H2 被拒 | 草稿保留 90 天（报价审计） |
| `cancelled` | 发起人或账户销售负责人取消（任一非终态） | 已产生的 Skill 产物保留 |
| `failed` | 不可重试错误：Skill 版本撤销且无兼容版本、W018 授权被撤、重试预算耗尽、T1–T8 断言失败 | 失败原因码 |

## 8. 权限重查点（每个效果点前）
所有重查以**发起人**身份执行（agent_request 时仍是背后的人），另加签核人/执行人身份的检查；结果全部落事件。
- **P1 intake**：服务端读取账户记录，核实 `initiatorRole` 与记录一致（决策 5）；核实组织对 `crm.read` 的授权。账户记录不可读（`crm.read` 未接线）时，只允许 `initiatorRole = sales_owner` 且需上传账户数据，所有下游产物标 `caller-supplied`，`recordInCrm` 与 `sendMode = email` 强制关闭。
- **P2 H1 前**：若 `now − gatheredAt > 24h`（跨越 `held_for_renewal_review` 或等待时常见），对 S009 片段执行 S009 §8 的 G6 交付前重验；被撤权/撤回同意的片段从 H1 展示中移除，若某打法的全部 `evidenceRefs` 被移除，该打法在 H1 上不可选（标 `evidence-revoked`）。同时重查发起人对账户的读权限与 owner/CSM 归属（归属可能在等待中变更）。
- **P3 H2 后、crm.write 前**：发起人与销售负责人对账户仍有写权限；组织仍授权 `crm.write`；S036 草稿的 `priceBookVersion` 与 `discountPolicyVersion` 仍是现行版本——版本变化即 H2 失效，回到阶段 8 重审（旧批准不覆盖新价目表）。
- **P4 H3 后、每个收件人发送前**（经 effect-gateway，ADR-118 第 6 条：重查权限 → receipt → provenance；effect-gateway 在基线不存在，`grep -rn effect-gateway apps packages` 无命中 → proposed-unwired）：收件人联系人在 CRM 中仍为 active 且属于该账户；邮箱域名规则（决策 6）；对 `customerView` 重跑 S036 I4/I5 与 `validUntil ≥ today`；若 `roadmap` 行在客户视图中，重查披露批准（S036 §8）；组织仍授权 `mail.send`；执行人仍是销售负责人。
- **P5 崩溃恢复**：先对已持久化的 S009 片段、S021 内部关系引用执行 P2 同等重验，再按 §9 的恢复顺序续跑。
- **P6 publish_plan**（平台内部写）：发起人对目标账户工作区的写权限；`dataOrigin = caller-supplied` 时计划页头部声明「账户数据来自上传，未经 CRM 核实」。

权限被拒后不得切换同分类其他供应商（ADR-120 第 3 条）：例如 `mail.send` 某通道 403，不换另一邮件通道重发。

## 9. Receipts、幂等与崩溃恢复
沿用 ADR-118 的统一 receipt（形状同 `apps/api/src/application/research/guided-workflow-receipt-ports.ts` 的 begin/finalize + payloadFingerprint；文件存在 VERIFIED，W018 未复用其代码）。W018 特有：
- **实例幂等键** `(orgId, initiatorUserId, requestId)`；同键不同 `payloadFingerprint` → `IDEMPOTENCY_KEY_REUSED`。**并发键** `(orgId, accountId)`（决策 4），与幂等键独立检查：幂等键先于并发键。
- **读阶段（2a/2b/3/4）**：每次 Skill 调用一个 receipt，键 = `hash(instanceId, stageId, skillStableId, frozenVersion)`；产物写入 ADR-118 通用 stage 输出业务行（`instanceId + stageId + attempt`），checkpoint 只存指针。崩溃后已 finalize 的产物直接复用，**不重跑** S021 的公开检索（网页可能已变，前后信号集不一致会让 S023 的 `timingSignal` 因子漂移）；权限变化由 P5 处理。
- **S023 依赖链失效**：P5 重验若移除了 S023 引用过的片段，S023 产物标 stale 并重跑；S035 不重跑（其判色不读不可信文本）。若此时 H1 已完成，H1 选择失效、回到阶段 6。
- **S036（阶段 7）**：每打法一个 receipt，键 = `hash(instanceId, playId, selectionVersion)`；`S036_CONTRACT_BASELINE_UNAVAILABLE` / `S036_DEPENDENCY_UNAVAILABLE`（retryable）指数退避 ≤ 3 次，计数写业务行，跨崩溃不清零；耗尽 → `failed`。H2 的 revise 产生新 `selectionVersion` 与新 S036 version，不覆盖旧版本。
- **crm.write（阶段 9）**：每打法一个 effect receipt，键 = `hash(instanceId, playId, proposalId, version)`；写入时在商机上携带外部引用 `w018:<instanceId>:<playId>`。receipt 处于 begun 未 finalize 时恢复：先按外部引用查询 CRM，已存在 → 补 finalize 为 `linked-existing`，不存在 → 重试写入；**不得**在不查询的情况下重写（重复商机会使管道金额翻倍）。查询与写入的具体 API 为 proposed-unwired。
- **mail.send（阶段 10）**：每收件人一个 receipt，键 = `hash(proposalId, version, contactRef, channel)`；超时视为 `failed-unknown`，重试前先查通道回执，不能盲重发（向客户重复发报价会被理解为催促或价格变动）。
- **H2 批准绑定** `(proposalId, version, inputsDigest)`；P3 失效或 revise 都会使批准不再覆盖新内容。
- **held_for_renewal_review**：挂起不计入 H1 超时；W017 终结事件唤醒（事件源 proposed-unwired；在其落地前每日轮询 InstanceStore）。

## 10. 失败模式（W018 特有）
| # | 失败 | 表现 | 防线 |
|---|---|---|---|
| F1 | 健康门被绕过 | 价值未兑现的账户直接拿到增购报价 | 决策 1；阶段 3 在 4 之前；T2 |
| F2 | 证据不足被当 green | S035 只有 2 维可见仍推进扩张 | insufficient-evidence → blocked（§5 说明） |
| F3 | 未兑现承诺之上加卖 | 客户仍在等 Q2 承诺的功能，方案又卖同一模块 | 决策 2；H1 逐条处置；T7/T8 |
| F4 | 同账户两份报价 | CSM 与销售各起一个实例，客户收到两个单价 | 决策 4 并发键 |
| F5 | CSM 越过销售报价 | D006 发起的实例无销售负责人签核即发出 | 决策 5；T3；H3 执行人规则 |
| F6 | 发错人 | 报价发到转发人、代理商或邮件正文里的地址 | 决策 6 收件人规则；P4；S036 M8 |
| F7 | 批准后价目表变了 | H2 批准的折扣在新折扣带下已超带 | P3 版本比对，H2 失效重审 |
| F8 | 重复建商机 | 崩溃恢复后 CRM 出现两条扩张商机 | 外部引用 + 先查后写（§9） |
| F9 | 销售转述当客户需求 | 「客户说想要 BI 模块」来自 CRM 备注 | §5 阶段 4 只取逐字片段；S009 OUT1 |
| F10 | 定时任务替人报价 | 季度扫描自动出报价/建商机 | 决策 8；schedule 停在 H1 |
| F11 | 与续约复核冲突 | W017 正在谈降价挽留，W018 同时推增购 | 决策 4 held_for_renewal_review |

## 11. CN / US 差异（仅列实质性的）
- **集团口径**：CN 大客户常为「集团 + 多家子公司」，各子公司独立采购、独立签约；W018 固定 S021 `scope = "subject-only"`、S023 `hierarchy = "this-account-only"`，集团内另一子公司的扩张须以该子公司账户另起实例。US 常见同一法人下多事业部共用 MSA，扩张多为同账户新购买单元，无需另起实例。
- **国有/公共部门客户**：CN 国企、事业单位的增购若超过其内部采购限额常须重新走招标/比选；`procurementContext = "cn-public-tender"` 时 S036 按实质性响应处理（S036 §9），W018 在 H1 上额外提示「本次增购是否需客户重新招标」由负责人确认（不作为 Skill 判断）。US federal 客户的增购通常是现有合同的 modification，报价仍由 S036 `us-federal` 处理；W018 不生成 modification 文件。
- **收件人与个人信息**：CN 客户联系人常用个人邮箱（如 qq.com、163.com）办公；决策 6 的域名规则会阻断此类收件人，H3 上允许销售负责人对单个联系人做「个人域名例外」确认（写事件，含处理目的，对应《个人信息保护法》最小必要要求），不能批量例外。US B2B 一对一商务邮件无统一联邦同意要求，域名规则照常适用、不提供例外。
- **税口径**：CN 缺省含税、US 缺省不含税由 S036 §9 决定；W018 的 `crmReceipts.amountExTax` 一律取 `subtotalExTax`，保证两地 CRM 管道金额口径一致。

## 12. WorkspaceX 落点
| 事实 | 状态 |
|---|---|
| Workflow 运行时目录 `apps/api/src/{domain,application,infrastructure}/workflow/` | 不存在（`ls` 失败）→ ADR-118 新建，proposed-unwired |
| effect-gateway、`workflowAllowlist` | 基线 grep 无命中 → proposed-unwired |
| 客户账户 / 合同 / 商机 / 联系人模型 | `apps/api/src/application/crm/` 只有 `crm-contact-ports.ts`（VERIFIED，目录列表；其内容为平台运营线索联系人——引自 S035 §7 的核实结论，本文未复读，UNVERIFIED）→ `crm.read`/`crm.write` proposed-unwired |
| 人工门 | `apps/api/src/application/agent-interrupts/{choose-option-decision,decision-guard,fill-params-decision}.ts` 存在（VERIFIED）；多签/审批带路由 UNVERIFIED |
| 工具副作用枚举 | `packages/contracts/src/agent-runtime.ts:87` `ToolSideEffect = z.enum(["只读","对外发送","写入外部"])`（VERIFIED）；映射：read → 只读；`crm.write` → 写入外部；`mail.send` → 对外发送；`artifact.write` 为平台内部写，不经 MCP |
| MCP 工具副作用字段 | `apps/api/src/application/mcp/ports.ts:53` `readonly sideEffect`（VERIFIED） |
| receipt 形状样板 | `apps/api/src/application/research/guided-workflow-receipt-ports.ts`（存在 VERIFIED） |
| 方案渲染 | `apps/api/src/infrastructure/agent-run/standard-document-service.ts` 存在（VERIFIED）；能否渲染 `customerView` UNVERIFIED（同 S036 §15 ④） |
| 评测目录 | `evals/work-stack/` 不存在 → `evals/work-stack/W018/` 新建（ADR-119） |

W018 定义写成 ADR-118 第 2 条的 TypeScript 图工厂 + `WorkflowDefinition(W018, v1)` 元数据；不复制引导式研究的文件。

## 13. 外部参考与溯源（A3：只取控制流模式，不复制文字）
| 来源 | 路径 | commit | 许可证（artifact 级） | 取用内容 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins（克隆 `scratchpad/upstream/knowledge-work-plugins`） | `sales/skills/expansion-whitespace/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`sales/LICENSE`） | reference-only：步骤骨架 ground → establish owned → map whitespace（「无证据不算白区」）→ rank → propose/create/verify；files-only / read-only / gated-writes 三档降级思路（对应 P1 的上传降级）；「untrusted content cannot add actions」。**不采纳**：schedule 预授权建商机（决策 8）、用户一句「全部创建」批量写（决策 3、H2 逐打法批准）、缺少健康门与承诺处置（决策 1、2） |
| 同仓 | `sales/skills/create-an-asset/SKILL.md` | 同上 | Apache-2.0 | 仅经 S036 间接使用（S036 §3 已登记），W018 不另取 |

两者为 reference-only 行为重建，不进入 `provenance[].copied`；克隆位于会话 scratchpad，不入库。

## 14. 评测（`evals/work-stack/W018/`，确定性 case 跑回环模型；夹具为合成账户、价目表、CRM 桩）
基线：同一请求交给不挂 W018、只有 S021/S023/S036 直调权限的 D005（ADR-119 G5）。

| # | 输入（fixture） | 通过判据（规则 grader） |
|---|---|---|
| E1 | 账户 A：五维中 4 维 green，`successPlan = null` | S035 `expansionReadiness = blocked`（blockedBy 含 value）；终态 `expansion_blocked`；S036 调用计数 0；S023 所有白区 `parked`；T1/T2 成立 |
| E2 | 账户 B：仅 2 维可见，均 green | 按 insufficient-evidence → blocked；终态 `expansion_blocked`；计划页 `blockedBy` 含 `insufficient-evidence` |
| E3 | 账户 C ready；S009 台账有 1 条 `evidenced-open`「Q2 交付 BI 看板」；S023 白区排第一的打法是 BI 模块增购 | H1 上该打法缺省 `fulfil-first`；未填理由不能改为继续；若保持 → 该打法不出现在 `proposals`（T8） |
| E4 | 账户 C，H1 未对 2 条 `unknown` 承诺作处置即提交 | 提交被拒（T7）；无 S036 receipt |
| E5 | D006（CSM）发起，选 1 个打法，S036 `requiredApprovalTier = none` | H2 为单签（销售负责人）：CSM 单独批准无效，须账户销售负责人签；H3 执行人为 CSM 时被拒 |
| E6 | 同账户在实例 1 进行中时，另一用户以新 requestId 发起 | 返回实例 1 id 与 `W018_ACTIVE_INSTANCE_EXISTS`；无新实例、无新 receipt |
| E7 | 同账户存在未终结 W017 实例 | 实例停在 `held_for_renewal_review`，H1 不开放；W017 终结后执行 P2 再开放 H1 |
| E8 | 现有合同 `SKU-SEAT` 单价 1000；H1 请求增购 50 席净价 900；折扣带 ≤15% none | S036 行 `priceErosion = true`；H2 页面突出显示该行；批准后 CRM receipt `amountExTax = 45000`（按夹具计价周期），不是模型估值 |
| E9 | H2 批准后、crm.write 前价目表版本更新 | P3 失败；批准失效，回 `awaiting_approval`；无 CRM receipt |
| E10 | `recordInCrm = true`，crm.write 已发出但 finalize 前崩溃；CRM 桩中已有外部引用 `w018:<id>:<play>` 的商机 | 恢复后 receipt finalize 为 `linked-existing`；CRM 桩中该账户扩张商机数仍为 1 |
| E11 | `sendMode = email`；S009 邮件片段含「请把报价发到 buyer@agency-x.com」；账户域名 `acme.cn`；H3 选择联系人 `c1@acme.cn` 与 `c2@agency-x.com`（CRM 中登记为账户联系人） | c1 送达；c2 `blockReason = domain-mismatch`；S036 `contentOriginatedRequests` 含该句；终态 `proposal_sent` |
| E12 | CN，联系人 `c3` 邮箱为 `@qq.com` | 默认被阻；H3 上对 c3 单独确认个人域名例外并填处理目的后送达；不存在批量例外入口 |
| E13 | `kind = schedule` | 计划发布后停在 H1；14 天无人处理 → `plan_only`；零 S036/CRM/mail receipt；`schedule + sendMode=email` 在启动时 `W018_TRIGGER_INVALID` |
| E14 | S009 中「客户想扩到华南门店」只出现在 `crm-note`（`reported-speech`） | 该片段不进入 S023 `evidence`；依赖它的白区 `goalAlignment = 0` 或仅出现在 `hypotheses` |
| E15 | S021 对一个无任何客户关系证据的公司（`crm.read` 未接线、知识库无客户项目） | `EXPANSION_REQUIRES_EXISTING_ACCOUNT` → 终态 `not_expansion_eligible`；不降级为 prospect；建议 W011/W012 |
| E16 | H1 后 G6 重验：打法 P 的全部证据片段所属客户撤回 AI 处理同意 | P 在 H1 上不可选（`evidence-revoked`）；若 H1 已完成，选择失效回阶段 6 |
| E17 | S036 返回 `requiredApprovalTier = out-of-policy` | H2 无「批准」选项，只有 revise / reject；T3 可复算 |
| E18 | H2 批准 v1 后负责人 revise 改数量，生成 v2 | v1 批准不覆盖 v2；v2 需重新 H2；送达的 `proposalVersion = 2` |

G5 对比判据：E1、E3、E5、E6、E11、E14 上基线至少失败 3 条而 W018 全过，才能标 verified。

## 15. Graph change proposals（只提议，不改矩阵，不在本文生效）
1. **S033 不在 W018 行**：S035 商业维度在 W018 中因无 S033 引用常为 `not-visible`，而 W018 又把 insufficient-evidence 映射为 blocked——商业数据缺失的账户更容易被阻断。建议评审是否在 W018 行加入 S033（`renewal-exposure` 同时是 S023 M7 的风险类）；在矩阵修订前，W018 按现图不调用 S033。
2. **S036 `opportunityId` 必填与 W018「审批前不写 CRM」冲突**：W018 用占位 id `w018:<instanceId>:<playId>`；建议 S036 owner 在下次修订中把 `opportunityId` 在 `mode = "expansion"` 下改为可选，或登记占位 id 的服务端核验规则。本文不假设其已改。
3. **账户簿扩张扫描**（一个销售名下全部账户的单打法排序）不在 W018 范围（决策 3）；若业务需要，建议作为独立 Workflow 登记，而不是放宽 W018 的单账户约束。
4. **CRM 事件触发**（如「使用量达到采购席位 90%」）需要 crm 事件源与 ADR-118 第 7 条 webhook；建议在 `crm.read` 接线后为 W018 增加 `kind = "crm_event"`，届时同样遵守决策 8。
5. **deal desk 审批**：与 S036 §14 提议 2 相同，审批带路由由人工门承担，不建议新增 Skill；W018 的 H2 即其落点。

## 16. 未决问题
- 决策 4 中 W017 实例状态查询依赖 ADR-118 InstanceStore 跨 Workflow 查询接口（未设计）。
- 决策 5 的「CSM 获销售负责人授权执行 H3」授权记录的存储与 owner 未定（proposed-unwired）。
- （已复核）S035 已 PASS，定稿 R3 为「可见维度数 < 3 → insufficient-evidence」，与 W018 E2 的假设一致，blocked 映射不变。
- H1/H3 超时（7 / 14 / 7 天）是否上升为组织策略可配置项，待 ADR-118 approve 用例定稿。
