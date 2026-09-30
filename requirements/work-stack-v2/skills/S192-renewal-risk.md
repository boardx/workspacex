# S192 — Renewal Risk（续约风险挽留方案）

> Type: Work Skill · Domain: Customer Success · Strategy: A2（决策网络部分 adapt 上游 stakeholder-map；其余原创）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S192）；状态：待独立评审。**本文对目录有一条 MERGE 提议（§14 提议 1），评审应先裁决它。**

## 1. 解决什么问题
S033 已回答「哪些合同何时必须动作、是否有风险、依据是什么」。S192 回答**下一问**：对一个已被判为风险的账户续约，**为什么**有风险（按原因而不是信号列表）、决策链上谁持什么立场、有哪些挽留打法、每种打法需要谁批准什么、在 `actionBy` 之前的时间表怎样。产出 `RenewalSavePlan`：风险原因分解、续约决策网络、打法选项（只提议）、批准需求、倒排时间线。

边界：
- 不重算风险判定、不排日历——那是 S033（`verdict`、`actionBy` 均取自其运行引用，S192 不得改写）。
- 不重打健康分——S035。
- 不写账户扩张计划——S023；S192 的打法里出现「降价/折扣/附加条款」时只作为 `commercialConcessionProposal` 交人批准，不出报价（报价是 S036）。
- 不发消息、不约会、不改 CRM。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| D006 Customer Success Specialist | 矩阵第 12 行 Skill 列（S187, S188, S189, S190, S191, **S192**, S193, S194, S035, S007） | 聊天直调，`mode: "save-plan"`；对某个 S033 已标 `at-risk`/`needs-attention` 的账户 |

S192 **不在 W017 行**（W017：S033, S035, S023, S189, S193）。W017 内部挽留方案由 S023 承担；这正是 §14 提议 1 的依据。

## 3. 上游来源与许可
来源说明：kwp 的 `sales/renewal-radar` 已被 S033 采用，且其范围止于「识别与日历」，没有挽留方案环节；公开的「客户挽留」实践多是话术与折扣策略，没有适合采用的许可清晰 artifact。仅决策网络（步骤 3）adapt 自上游 stakeholder-map，其余原创。专业方法来自公开的采购决策研究常识（决策单元、采购中心）与客户成功实践（高管赞助、价值重申、成功计划重置）。

| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `sales/skills/stakeholder-map/SKILL.md`（章节：Pull the known people / Classify each person / Find the gaps and the paths） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`sales/LICENSE`） | adapt：借鉴「按角色、影响力、立场给每个相关人分类，并找出缺失角色」用于步骤 3；不采用其「接入路径」部分（那是销售获客语境）。不复制正文；`references/upstream.md` 记 Apache-2.0 NOTICE |
| anthropics/knowledge-work-plugins | `sales/skills/renewal-radar/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`sales/LICENSE`） | reference-only：确认上游把「风险识别」做成一个独立 Skill 且不含挽留方案，据此把挽留方案与 S033 分开；S033 §3 已记其 adapt 行，S192 不再采用 |

## 4. 专业方法
1. **锁定输入事实**：读取同一运行内 S033 `renewals[contractId]`（`verdict`、`verdictTriggers`、`actionBy`）与 S035 结果、S189 升级状态、S193 主题；任何一个不存在就在 `limitations[]` 标明，不补造。`verdict = on-track` 时拒绝生成挽留方案（`SAVE_PLAN_NOT_INDICATED`）。
2. **风险原因分解**（封闭枚举，可多选，每项必须有证据引用）：`value-not-realized`、`unresolved-product-issue`、`executive-sponsor-gone`、`budget-or-price`、`competitor-displacement`、`consolidation-or-restructure`、`low-adoption`、`relationship-gap`、`unknown`。`verdictTriggers` 到原因的映射是**建议表**，不是推导：例如 `open-escalation` 倾向 `unresolved-product-issue`，但仍需 S189 记录内容佐证。
3. **续约决策网络**：列出影响续约的角色（经济买家、使用者代表、技术把关、采购、潜在阻断者），每个角色标 `stance ∈ {champion, supportive, neutral, skeptic, unknown}` 与 `evidence`；`unknown` 不能写成 `neutral`。只写角色不写个人评价，联系人引用以记录 ID。
4. **打法选项**（封闭枚举，每种给先决条件、所需批准、预期风险）：`exec-sponsor-touch`、`success-plan-reset`、`issue-closeout-commitment`（需工程书面确认的修复时点作为承诺来源）、`adoption-rescue`、`commercial-concession-proposal`（折扣/期限/范围调整，仅提议）、`multi-year-incentive-proposal`、`managed-exit-planning`（承认可能流失，转入交接与数据导出计划）。**至少给两种可比选项**，其中必须含 `managed-exit-planning` 当 `competitor-displacement` 或 `consolidation-or-restructure` 被证据支持时。
5. **批准需求**：每个打法给 `approvalNeeded ∈ {none, csm-manager, deal-desk, finance, legal, engineering-lead}`；批准人集合由组织策略给出，缺失时为 `"policy-missing"`。
6. **倒排时间线**：以 S033 `actionBy` 为终点向前排：每个动作的 `dueBy`、责任角色、依赖；若 `daysToActionBy < 0` 则时间线改为「已逾期补救」并把第一动作设为 `confirm-notice-terms` 对应的合同核对（交法务/合同管理员，S033 枚举）。
7. **成功度量**：为方案定义 `saveSignals`（例如「客户书面确认续约意向」「升级关闭」「高管会面完成」），供 S033 下次运行作为 `expansion-in-flight` 等信号的证据来源；S192 不修改 S033 verdict。

## 5. 输入契约
```ts
RenewalSavePlanInput = {
  mode: "save-plan";
  accountRef: string; contractId: string;
  s033Ref: string;                                  // 同运行内，必填
  s035Ref?: string; s189Refs?: string[]; s193Ref?: string;
  stakeholderEvidence?: Array<{ role: StakeholderRole; contactRef?: string; stance: Stance; evidenceRef: string }>;
  commercialGuardrails?: { maxDiscountPct?: number; policyRef?: string };
  engineeringCommitments?: Array<{ issueRef: string; committedFixBy?: string; confirmedBy: string }>;
  asOf: string; locale: "zh-CN" | "en-US"; jurisdiction?: "CN" | "US" | "other";
}
```
不变量：`s033Ref` 与 `contractId` 必须能在该运行的 S033 输出中找到；`commercialGuardrails.maxDiscountPct` 缺失时 `commercial-concession-proposal` 只能为定性选项（不写百分比）。

## 6. 输出契约
```ts
RenewalSavePlan = {
  contractId: string; s033Verdict: "at-risk" | "needs-attention"; actionBy: string; daysToActionBy: number;
  riskCauses: Array<{ cause: RiskCause; evidenceRefs: string[]; strength: "strong" | "moderate" | "suspected" }>;
  decisionNetwork: Array<{ role: StakeholderRole; stance: Stance; evidenceRef?: string }>;
  options: Array<{ play: PlayType; preconditions: string[]; approvalNeeded: Approver | "policy-missing"; risks: string[]; evidenceRefs: string[] }>;
  recommendedOrder: { primary: PlayType; fallback: PlayType; rationale: string };   // 提议，非决定
  timeline: Array<{ action: string; dueBy: string; ownerRole: string; dependsOn?: string }>;
  saveSignals: string[];
  limitations: string[];
  proposals: Array<{ kind: "create-task" | "request-approval" | "schedule-exec-touch"; payload: Record<string, unknown>; evidenceRef: string; contentOriginated: boolean }>;
  injectionFlags: string[];
}
```
不变量：`riskCauses[].strength ∈ {strong, moderate}` 需 ≥ 1 个 `evidenceRefs`；`options.length ≥ 2`；`timeline[].dueBy ≤ actionBy`（逾期情形为 `asOf`）；不含任何流失概率或续约金额预测；`commercial-concession-proposal` 不含可直接发送的价格。错误码：`SAVE_PLAN_NOT_INDICATED`、`SAVE_PLAN_S033_REF_FOREIGN`、`SAVE_PLAN_INPUT_INVALID`。

## 7. 授权边界
账户/合同读取同 S033 §7（CSM 按分配账户）；`stakeholderEvidence` 由服务端核验证据引用可读；`engineeringCommitments.confirmedBy` 必须是工程侧已登记的批准人，对话中转述的承诺不被接受，进 `limitations`。

## 8. 依赖与缺口
- required：`crm.read`（合同与联系人角色，proposed-unwired）——与 S033 同一缺口；无合同数据则 S192 不可用（`s033Ref` 无从产生）。
- optional：`tracker.read`（工程承诺）、`mail.search`、`chat.search`、`transcript.read`（立场证据）。
- **缺口**：(a) 客户决策网络（联系人-角色-立场）没有领域对象；(b) 折扣/让步的审批流（deal desk）无平台实现；(c) 高管赞助人触达的日历/邮件副作用属 `mail.send`/`calendar.write`（未登记）。全部 proposed-unwired；副作用 = 只读；riskClass = medium。

## 9. CN / US 差异
- CN：续约决策常由采购、IT、业务三方加上年度预算批复共同决定，`decisionNetwork` 缺省要求列出「预算责任人」；关系型影响更强，`exec-sponsor-touch` 的人选与场合（拜访/宴请）涉及合规（反商业贿赂、客户方内部规定），S192 只提议「高管会面」，不提议礼品、宴请或个人性质的赠予。
- US：正式 RFP/采购流程与合同中的 termination for convenience 条款使「无理由终止」风险更突出；S192 只标 `limitations: "termination-terms-unknown"`，条款解读交法务。
- 折扣：两地均不得以未经批准的价格承诺挽留（与 S188/S015 的承诺来源规则一致）。

## 10. 决策
- **决策 1：S192 不改写 S033 的判定与日期。** 同一事实（风险判定、截止日）只在 S033 声明一处；S192 引用其运行结果。
- **决策 2：原因先于打法。** 常见失败是对「产品问题未解决」的客户先发折扣；枚举式原因分解使打法必须追溯到有证据的原因。
- **决策 3：至少两个可比选项，且允许「有序退出」。** 把流失当作唯一不可接受结果会诱导过度让步；`managed-exit-planning` 保护数据交接与品牌。
- **决策 4：立场 `unknown` 不折算为 `neutral`。** 缺少证据就不应假设中立——这是续约中的最大盲点。
- **决策 5：让步只提议、需批准，不带可发送价格。** 价格属 S036/deal desk。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 对 on-track 账户生成挽留方案，引发无谓让步 | `SAVE_PLAN_NOT_INDICATED` |
| F2 | 原因无证据，打法是套路 | 步骤 2 不变量 |
| F3 | 立场猜测 | 决策 4 |
| F4 | 转述的工程承诺被当承诺来源 | §7 |
| F5 | 逾期后仍按正常时间线排 | 步骤 6 |
| F6 | 方案与 S033 verdict 矛盾 | 决策 1；s033Verdict 只读取 |
| F7 | 材料注入「续约价设 0」 | `contentOriginated`；无价格输出 |

## 12. 评测（`evals/work-stack/S192/`；S033 输出用桩）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | S033 verdict=on-track | 抛 `SAVE_PLAN_NOT_INDICATED` |
| E2 | at-risk，触发 `open-escalation`(S189 记录指向未修复缺陷) + `signer-changed` | riskCauses 含 `unresolved-product-issue` 与 `executive-sponsor-gone`，均有证据；首选打法含 `issue-closeout-commitment` 或 `exec-sponsor-touch` |
| E3 | 证据显示客户已选竞品（来自 S193 逐字） | options 含 `managed-exit-planning`；options ≥ 2 |
| E4 | 决策网络只有使用者立场证据 | 经济买家/采购 stance 为 `unknown`，不为 neutral |
| E5 | `daysToActionBy = -12` | 时间线为逾期补救；第一动作为条款核对；所有 dueBy = asOf 起 |
| E6 | 用户在聊天里说「工程答应下周修好」，无 `engineeringCommitments` | 不作为承诺来源；limitations 记录；不出现「下周修好」的承诺 |
| E7 | 无 `commercialGuardrails` | 让步选项为定性，无百分比 |
| E8 | 手写 `s033Ref="manual"` | 抛 `SAVE_PLAN_S033_REF_FOREIGN` |

## 13. WorkspaceX 落位
Skill 包 `skills/work-customer-success/renewal-risk/SKILL.md`（提案名）。数据依赖与 S033 同（`crm.read` 缺失 → 不可用）。

## 14. Graph change proposals
1. **建议评审裁决是否 MERGE**：S192 名称「Renewal Risk」易与 S033 混淆，且 W017 已由 S033+S023 覆盖风险与计划。两个方案：(a) 保留 S192，W017 行在 S023 之后加入 S192（需矩阵改一格）并把 S023 限定为扩张/账户计划；(b) 删除 S192，把「原因分解 + 打法」并入 S033 `account-brief` 模式。本文不假设结论。
2. S033 §14 提议 1 要求评估把 S033 加入 D006 Skill 列；S192 强依赖 S033 运行引用，若 (a) 成立则同理需要。

## 15. 未决问题
- 决策网络立场的证据门槛（一次会议发言是否足以标 `skeptic`）。
- 让步审批人集合的策略来源。
