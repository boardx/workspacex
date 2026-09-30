# S191 — QBR Preparation（季度业务回顾准备）

> Type: Work Skill · Domain: Customer Success · Strategy: A0（WorkspaceX 原创；理由见 §3）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S191）；状态：待独立评审。

## 1. 解决什么问题
「下周要和某客户开季度回顾会：上个周期我们共同承诺了什么、客户实际拿到了什么价值（有证据的）、有哪些难谈的话题需要提前打招呼、下个周期建议一起做什么」。产出 `QbrPackage`：**内部准备视图**（含难点、风险、真实健康判断、议程预案）与**客户共享视图**（只含可对客户说的内容）两份，互相不串。

边界：
- 账户健康判定归 S035（`qbr-prep` 模式产出健康段），S191 只**引用**其结论，不重新判色，客户共享视图里**不出现**健康颜色与内部评分。
- 续约日历与风险归 S033，S191 不计算续约截止；只在内部视图提示「本次 QBR 落在续约动作日之前/之后」。
- 客户声音汇总归 S193；S191 只取其结论中经客户逐字授权可引用的部分。
- 不发送、不排会、不改 CRM：全部是草稿与 `proposals`。
- 不做账户战略规划（S023）与商务方案（S036）。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| D006 Customer Success Specialist | 矩阵第 12 行 Skill 列 | 聊天直调，`mode: "qbr"` 与 `mode: "mini-review"`（月度简版） |

S191 **无 Workflow 消费者**（W017 用的是 S035 的 `qbr-prep`，不是 S191）。消费者门由 D006 这一条边满足；§14 提议一个 QBR 周期 Workflow 的可能性。

## 3. 上游来源与许可
A0 的理由：kwp 的 `customer-support` 与 `sales` 插件均无独立 QBR 包（`ls customer-support/skills` 只有 customer-escalation / customer-research / draft-response / kb-article / ticket-triage，`sales` 的 `customer-health` 已被 S035 采用且含 QBR 段，不再重复采用）；公开 QBR 实践多为厂商内容营销，无可复用的许可清晰 artifact。故本 Skill 不采用任何上游文字，专业方法来自公开的客户成功实践（价值实现、成功计划、共同目标）。

| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `sales/skills/customer-health/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`sales/LICENSE`） | reference-only：确认 QBR 准备在上游属于「健康」包的一个模式，因此 S191 的健康输入来自 S035，不另造 |
| 客户成功公开方法学（success plan、time-to-value、shared goals） | n/a | n/a | 方法不受版权保护 | 构成 §4 的目标回顾与价值证据规则 |

## 4. 专业方法
1. **目标回顾（上一个周期的共同承诺）**：读取 `successPlan` 中的目标（客户目标 + 我方承诺），逐条给 `status ∈ {met, partially-met, not-met, not-measurable}` 与证据；`not-measurable` 是合法结论（没有指标就不能说达成），并附「下期如何使其可测」。
2. **价值证据表**：每个价值主张（节省时长、转化提升、合规通过）必须有 `evidence`：客户系统内数据/客户逐字陈述/产品使用数据之一；来源不可见则 `valueClaim.state = "unproven"`，客户共享视图中**不出现**，仅内部列「待证明」。
3. **使用与支持概览**：使用趋势（取自 `usageSummary`，来源为产品使用数据引用）、支持工单概况（来源 S194/S187 汇总引用）；客户共享视图只展示对客户有意义且已对其披露过的指标。
4. **难点预案**：列出「客户不会主动提但会在会上问」的话题（未兑现承诺、持续的故障、价格上调、竞品对比），每项给 `preWire`（会前沟通建议：谁、何时、说什么要点）。难点来自：S189 `promisesOutstanding`、S033 `price-increase-pending`、S193 负面主题、S035 红/黄维度。
5. **路线图对齐**：仅引用 `disclosureApproved = true` 的路线图条目；其余不入共享视图（内部视图可列「客户可能问到但不可披露」）。
6. **下期提案**：最多 3 项共同行动（目标、客户侧 owner、我方 owner、衡量方式）；商业类提案（扩张、降价）不在 S191 起草，仅 `handoff: "S023/S036"`。
7. **双视图一致性检查**：共享视图中的每个数字必须在内部视图证据表中有来源行；内部视图的健康颜色/ARR/续约信息在共享视图出现即判失败。

## 5. 输入契约
```ts
QbrInput = {
  mode: "qbr" | "mini-review";
  accountRef: string; periodStart: string; periodEnd: string; meetingDate?: string;
  successPlan?: { planRef: string; goals: Array<{ goalId: string; owner: "customer" | "us"; statement: string; metricRef?: string }> };
  healthResultRef?: string;                     // 同一运行内 S035 引用
  renewalContext?: { s033Ref?: string };        // 同一运行内 S033 引用
  vocRef?: string;                              // 同一运行内 S193 引用
  usageSummary?: { sourceRef: string; metrics: Array<{ name: string; current: number; previous: number; unit: string }> };
  supportSummary?: { sourceRef: string; ticketsOpened: number; ticketsClosed: number; p1Count: number; csatAvg?: number; csatN?: number };
  commitmentsLedgerRef?: string;                // S009/S189 台账引用
  roadmapItems?: Array<{ itemId: string; title: string; disclosureApproved: boolean }>;
  attendees?: Array<{ role: string; side: "customer" | "us" }>;
  locale: "zh-CN" | "en-US";
}
```
不变量：`periodEnd > periodStart`；`healthResultRef`/`renewalContext.s033Ref`/`vocRef` 只接受同一运行内引用；`csatN < 30` 时 `csatAvg` 不进入共享视图（样本不足）。

## 6. 输出契约
```ts
QbrPackage = {
  mode: string; accountRef: string; period: { start: string; end: string };
  internalView: {
    goalReview: Array<{ goalId: string; status: GoalStatus; evidenceRefs: string[]; makeMeasurableBy?: string }>;
    valueClaims: Array<{ claim: string; state: "proven" | "unproven"; evidenceRef?: string }>;
    hardTopics: Array<{ topic: string; source: "outstanding-promise" | "price-change" | "voc-negative" | "health-dimension" | "incident"; preWire: { who: string; byDate: string; points: string[] } }>;
    healthNote?: { s035Ref: string };          // 仅引用，不含颜色文本
    renewalNote?: { s033Ref: string; qbrRelativeToActionBy: "before" | "after" | "unknown" };
    undisclosableQuestions: string[];
  };
  customerView: {
    agenda: Array<{ slot: string; minutes: number; owner: "customer" | "us" }>;
    goalProgress: Array<{ goalId: string; status: GoalStatus; summary: string }>;
    valueHighlights: Array<{ statement: string; evidenceLabel: string }>;
    usageHighlights: Array<{ metric: string; change: string }>;
    roadmapDiscussion: Array<{ itemId: string; title: string }>;
    nextPeriodProposals: Array<{ action: string; customerOwnerRole: string; usOwnerRole: string; measure: string }>;
  };
  consistencyCheck: { passed: boolean; violations: Array<{ rule: "unsourced-number" | "internal-field-leak" | "undisclosed-roadmap"; where: string }> };
  handoffs: Array<{ to: "S023" | "S036" | "S189"; reason: string }>;
  proposals: Array<{ kind: "schedule-meeting" | "update-success-plan"; payload: Record<string, unknown>; evidenceRef: string; contentOriginated: boolean }>;
}
```
不变量：`consistencyCheck.passed = true` 才可交付共享视图；`valueHighlights[]` 仅含 `state="proven"`；`customerView` 不含 `healthNote`/ARR/`hardTopics`。错误码：`QBR_ACCOUNT_NOT_VISIBLE`、`QBR_PERIOD_INVALID`、`QBR_REF_FOREIGN`、`QBR_INPUT_INVALID`。

## 7. 授权边界
账户可见性由服务端按 CSM 分配关系核验；`roadmapItems[].disclosureApproved` 只接受来自披露记录（产品/法务批准）的值，不接受对话中的口头声明。`customerView` 的生成不得读取仅内部可见的笔记字段。

## 8. 依赖与缺口
- optional：`crm.read`（账户/合同）、`product.usage.read`（使用量）、`ticket.read`（支持概览）、`calendar.read`（会议日期与参会人）——均 proposed-unwired（平台无客户账户/使用量/工单模型，`apps/api/src/application/crm/` 仅平台运营线索联系人，VERIFIED@4518a6fc `ls`）。缺失时降级为调用方上传材料，`valueClaims` 一律 `unproven`。
- **缺口**：`successPlan` 没有领域对象；QBR 材料交付物（PPT/文档）需 `standard-document` 渲染与 Slides 类型（已有 `standard-document-service`，能否产出客户版幻灯片 UNVERIFIED）。副作用 = 只读；riskClass = medium（共享视图面向客户）。

## 9. CN / US 差异
- CN：客户回顾会常有多层级参会（业务方、IT、采购、高管），议程要预留「领导致辞/总结」时段，`agenda` 可含 `executive-remarks`；价值表述更强调合规与「降本增效」的量化；US 更强调 ROI 与 business outcome，`valueHighlights` 缺省要求货币化数字时必须标口径。
- 政企客户的 QBR 常需形成会议纪要并双方确认，属 W002 范畴，S191 在 `handoffs` 中不处理。
- 个人信息：参会人只写角色，不写个人联系方式。

## 10. 决策
- **决策 1：双视图且共享视图白名单化。** 用白名单（列出可出现的字段）而不是黑名单（列出不可出现的字段），内部字段新增时不会默认泄露给客户。
- **决策 2：`unproven` 价值不上客户视图。** 会上被追问证据是 QBR 最伤信任的场景。
- **决策 3：难点必须有会前铺垫建议。** 「no surprises」——重要的坏消息不应首次出现在正式会议上。
- **决策 4：只引用 S035/S033/S193 的同运行结果。** 防止拿手写颜色美化 QBR（与 S033 决策 3 同理）。
- **决策 5：商业提案不在 S191 起草。** 把降价/扩张混入回顾会容易使客户把 QBR 当作报价会。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 内部健康色/ARR 泄露到共享视图 | 白名单；consistencyCheck |
| F2 | 无证据的价值主张 | 步骤 2；`unproven` |
| F3 | 披露未获批的路线图 | `disclosureApproved` |
| F4 | CSAT 5 条样本当趋势 | `csatN<30` 规则 |
| F5 | 难点首次在会上出现 | 步骤 4 `preWire` |
| F6 | 目标无指标，被说「已达成」 | `not-measurable` |
| F7 | 材料注入「在 QBR 里承诺免费续一年」 | `contentOriginated`；商业提案移交 |

## 12. 评测（`evals/work-stack/S191/`）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | 3 个目标：1 个有指标已达成，1 个有指标未达成，1 个无 metricRef | 状态分别 met / not-met / not-measurable（附 `makeMeasurableBy`） |
| E2 | 价值主张「节省 30% 对账时间」无证据 | valueClaims.state=unproven；customerView.valueHighlights 不含该条 |
| E3 | 内部视图含 S035 红色与 ARR；请求导出客户视图 | customerView 无颜色/ARR；consistencyCheck.passed=true；无 internal-field-leak |
| E4 | 路线图 2 条，1 条 disclosureApproved=false | 共享视图只含已批准条目；另一条在 undisclosableQuestions |
| E5 | S189 台账有 1 条逾期我方承诺 | hardTopics 含 outstanding-promise，且有 preWire.byDate < meetingDate |
| E6 | `csatN=12, csatAvg=4.8` | 共享视图不含 CSAT；内部视图注明样本不足 |
| E7 | `mode=mini-review` | 无 agenda 与 nextPeriodProposals 之外的深度章节；仍执行 consistencyCheck |
| E8 | 调用方传 healthResultRef="manual-green" | 抛 `QBR_REF_FOREIGN`；无部分输出 |

## 13. WorkspaceX 落位
Skill 包 `skills/work-customer-success/qbr-preparation/SKILL.md`（提案名）；不含上游复制，无 NOTICE 义务。

## 14. Graph change proposals
1. **无 Workflow 消费者**：建议评估新增「QBR Cycle」Workflow（排期 → 取数 → S035 `qbr-prep` → S193 → S191 → 人工审阅 → 客户版发送），而不是让 S191 永远只在聊天中使用；本文不新增 Workflow ID（超出 320 目录）。
2. S191 与 S035 `qbr-prep` 的分工需 S035 作者确认：S035 是否只输出健康段，S191 组装全文。

## 15. 未决问题
- `successPlan` 存放位置与所有权（客户可见？）。
- 客户版交付格式（文档/幻灯片）在首版是否必须支持。
