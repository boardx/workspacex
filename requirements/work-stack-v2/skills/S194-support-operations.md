# S194 — Support Operations（支持运营）

> Type: Work Skill · Domain: Customer Success · Strategy: A0（WorkspaceX 原创；理由见 §3）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S194）；状态：待独立评审。

## 1. 解决什么问题
「支持团队这个周期运转得怎样：积压有多老、SLA 达成多少（按规则口径）、首响与解决时长分布、重开率、自助解决率、CSAT（样本够不够）、哪个类别/产品区域在拖慢、人手与来量是否匹配——哪些是信号，哪些是噪声，该做什么调整」。产出 `SupportOpsReview`。

边界：
- 指标**口径**由 S162/S166 体系定义；S194 只按传入的 `metricDefinitions` 计算，并在输出里回显口径版本；不自创口径。
- 不做单张工单分诊（S187）、不做升级（S189）、不写 KB（S190）；但可指出「KB 缺口」「宏缺口」并交由 S190 起草（`handoffs`）。
- 不做通用容量规划（S144，那是项目/运营的人力模型）；S194 只做支持队列的来量-处理量-人手三项对账。
- 不评价个人绩效：默认聚合到队列/团队层（决策 3）。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| D006 Customer Success Specialist | 第 12 行 Skill 列 | 聊天直调：`mode: "weekly-review"`（面向自己分配的账户相关工单） |
| D046 Customer Support Operations Specialist | 第 52 行 Skill 列 | 主场景：`weekly-review` / `backlog-health` / `sla-audit`（D046 尚未作者化） |

S194 **无 Workflow 消费者**；消费者门由两条 DigitalHuman 边满足。D046 的 `W058/W059`（数据看板与指标监控）未列 S194，说明周期性看板与监控走数据线 Workflow，S194 是对话式复盘入口（§14）。

## 3. 上游来源与许可
A0 的理由：kwp `customer-support` 五个 Skill 均是单张工单/单客户层面，没有队列运营层 Skill；支持运营的公开指标体系（首次响应时间、FRT、TTR、backlog aging、reopen rate、CSAT、CES、deflection）是行业通用概念，无可采用的 artifact；不采用任何上游文字。

| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `customer-support/skills/ticket-triage/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0 | reference-only：只借用「P1–P4 各档 SLA 期望」作为 `slaPolicy` 形状的参照，实际数值以组织策略为准 |
| 公开服务管理惯例（ITIL 4 / HDI 度量） | n/a | n/a | 方法不受版权保护 | 构成步骤 2–4 的指标类别与 SLA 暂停规则 |

## 4. 专业方法
1. **口径锁定**：读取 `metricDefinitions`（FRT 是「首次人工回复」还是「首次任何回复」；解决时长是否排除「等待客户」状态；重开窗口天数）。任何指标在无口径时输出 `definition-missing`，不回退默认。
2. **积压账龄**：按 `ageBuckets`（如 0–1d/2–3d/4–7d/8–14d/>14d，随组织可配）给分布与 `oldestOpen`；区分「等我方」「等客户」「等第三方」三种状态，只有「等我方」计入我方责任账龄。
3. **SLA 达成**：达成率 = 按策略计时（扣除暂停窗口）未违约的工单数 ÷ 已到期或已关闭的工单数；未到期工单不计入分母（避免上升的假达成率）；按优先级与套餐分层，`n < minN` 的层只给计数，不给百分比。
4. **时长分布**：用分位数（P50/P90/P95）而非均值；超长尾工单单列。
5. **CSAT/CES**：样本量 `n < 30` 时不输出均值，仅输出计数与原话摘要；应答率一并输出（低应答率意味着偏差）。
6. **来量-处理量-人手**：按周的 `inflow`、`closed`、`backlogDelta` 与排班 FTE 对账；`inflow` 高于历史 P90 的周标 `surge` 并关联可能的事件（来自 S177 事件记录引用，仅当提供）。
7. **异常与噪声判别**：对每个指标的周环比变动，用历史 `historyWeeks`（缺省 12）的分布判断是否超出正常波动；不足 8 周历史则 `volatility = "insufficient-history"`，变动不标「显著」。
8. **结构性缺口**：把高频主题与「无 KB / 无宏」的类别交叉，给 `kbGaps[]`、`macroGaps[]`；提议交 S190/S188 起草。
9. **调整建议**：`recommendations[]` 封闭枚举 `{adjust-routing, add-macro, add-kb, rebalance-queue, revisit-sla-policy, escalate-staffing-gap, investigate-defect-cluster}`，每条带证据与预期指标，均为提议。

## 5. 输入契约
```ts
SupportOpsInput = {
  mode: "weekly-review" | "backlog-health" | "sla-audit";
  period: { start: string; end: string };
  scope: { teamIds?: string[]; queueIds?: string[]; selfOnly?: boolean };
  tickets: Array<{ ticketId: string; queueId: string; priority: "P1" | "P2" | "P3" | "P4"; openedAt: string; firstHumanResponseAt?: string; closedAt?: string; reopenedAt?: string[]; status: string; statusHistory: Array<{ status: string; at: string }>; category?: string; accountTier?: string; csat?: { score: number; at: string } }>;
  slaPolicyRef: string; metricDefinitionsRef: string;
  staffing?: Array<{ week: string; fte: number; queueId: string }>;
  incidentRefs?: string[];
  historyWeeks?: number; ageBuckets?: number[]; minN?: number;
  timeZone: string; workCalendarRef?: string;
}
```
不变量：`tickets[].statusHistory` 按时间升序；无 `metricDefinitionsRef` → `SUPPORT_OPS_DEFINITION_MISSING`；`tickets` ≤ 50,000。

## 6. 输出契约
```ts
SupportOpsReview = {
  mode: string; period: { start: string; end: string }; definitionsVersion: string; slaPolicyVersion: string;
  backlog: { total: number; byOwnerState: { waitingOnUs: number; waitingOnCustomer: number; waitingOnThirdParty: number }; ageDistribution: Array<{ bucket: string; count: number }>; oldestOpenTicketId?: string };
  sla: Array<{ layer: string; due: number; met: number; rate: number | "n-too-small" }>;
  durations: { frt: Percentiles; resolution: Percentiles; longTail: string[] };
  reopenRate: number | "definition-missing";
  csat: { n: number; responseRate: number; mean?: number; note?: "n-below-min" };
  flow: Array<{ week: string; inflow: number; closed: number; backlogDelta: number; fte?: number; surge: boolean }>;
  findings: Array<{ metric: string; change: string; significance: "notable" | "within-normal" | "insufficient-history"; evidenceRef: string }>;
  kbGaps: Array<{ theme: string; ticketCount: number }>; macroGaps: Array<{ theme: string; ticketCount: number }>;
  recommendations: Array<{ action: RecAction; evidenceRef: string; expectedMetric: string }>;
  dataQuality: { missingFirstResponse: number; overlappingStatus: number; timezoneAmbiguous: number };
  limitations: string[];
}
```
不变量：`sla[].rate` 分母只含已到期或已关闭工单；`csat.mean` 仅 `n ≥ minN`；`findings.significance="notable"` ⇒ 历史 ≥ 8 周；不含个人级指标（除非 `scope.selfOnly` 且调用者为本人）。错误码：`SUPPORT_OPS_DEFINITION_MISSING`、`SUPPORT_OPS_SCOPE_FORBIDDEN`、`SUPPORT_OPS_TOO_MANY_TICKETS`、`SUPPORT_OPS_INPUT_INVALID`。

## 7. 授权边界
队列/团队范围由服务端核验（D046 语境：所管队列；D006 语境：仅自己分配账户相关工单）。个人级工作量数据属员工信息，受决策 3 约束。

## 8. 依赖与缺口
- required：`ticket.read`（proposed-unwired）。optional：`workforce.schedule.read`（排班，未登记）、`analytics.read`。
- **外部系统缺口**：帮助台/工单系统及其报表 API（CN 常见自建或 SaaS 工单，US 常见商业帮助台）无平台集成；`tickets[]` 只能由上传导出文件提供。输入上限 50,000 条为首版假设，待评审。副作用 = 只读；riskClass = low。

## 9. CN / US 差异
- CN 支持渠道含企业 IM/电话，工单的「首次响应」常发生在聊天群而非工单系统，`firstHumanResponseAt` 缺失比例高，`dataQuality.missingFirstResponse` 需如实显示；US 以邮件/帮助台为主，记录较完整。
- CN 法定节假日与调休使「周环比」在节前节后失真，`flow` 需标注节假日周；US 以联邦节假日与区域差异。
- 员工绩效：CN《个人信息保护法》与劳动用工规章对员工监控有限制，US 不同州差异；决策 3 统一默认聚合。

## 10. 决策
- **决策 1：S194 不拥有指标口径。** 口径归 S162/S166 体系；这样支持部门与财务/数据团队的「首响」「解决」不会出现两套数字。
- **决策 2：分母排除未到期工单。** 否则周初的达成率总是虚高，周末才「掉下来」。
- **决策 3：默认聚合到队列/团队，个人级需显式授权。** 避免 Skill 变成员工监控工具。
- **决策 4：小样本不出百分比。** `n-too-small` 是合法输出。
- **决策 5：波动判别靠历史，不靠直觉。** 少于 8 周历史时不使用「显著」。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 无口径硬算 | `DEFINITION_MISSING` |
| F2 | 达成率分母含未到期 | 决策 2 |
| F3 | 暂停窗口未扣，SLA 偏低 | 步骤 3；statusHistory |
| F4 | 5 条 CSAT 写成均值 | 决策 4 |
| F5 | 节假日周被当异常 | `flow` 标注节假日周；volatility 判别 |
| F6 | 个人排行榜 | 决策 3 |
| F7 | 工单内容注入写指令 | 输入为数值字段，文本不进输出；无写 |

## 12. 评测（`evals/work-stack/S194/`）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | 100 张工单，其中 30 张未到期，到期 70 张中 56 张达成 | sla.rate = 0.8（分母 70），不是 0.56/0.86 之类 |
| E2 | 工单有「等客户」状态 3 天 | 解决时长扣除暂停窗口（按策略）；backlog 归入 waitingOnCustomer |
| E3 | CSAT n=12 | csat.mean 缺省，note=`n-below-min`；responseRate 输出 |
| E4 | 仅有 5 周历史，某周 FRT P90 上升 40% | significance=`insufficient-history`，不是 notable |
| E5 | 无 `metricDefinitionsRef` | 抛 `SUPPORT_OPS_DEFINITION_MISSING` |
| E6 | 春节周来量下降 60%、节后周回升 | flow 标注节假日周；不产生「需求崩塌」类 finding |
| E7 | 请求「列出本周处理量最低的 3 个人」 | 拒绝个人排行，给队列级分布；说明需显式授权 |
| E8 | 「价格」类工单 120 张、无对应 KB 与宏 | kbGaps 与 macroGaps 含该主题；recommendations 含 add-kb/add-macro；handoff 至 S190 |

## 13. WorkspaceX 落位
Skill 包 `skills/work-customer-success/support-operations/SKILL.md`（提案名）；无上游复制。工单数据源 proposed-unwired（同 S187）。

## 14. Graph change proposals
1. D046 已含 W058/W059；周期性监控更适合由 W059（指标监控）承载，S194 保留为对话式复盘。是否还需要独立 Workflow，留给 D046 作者。
2. S194 与 S155 Business Review 的区别：S155 面向经营目标对账，S194 面向队列运营；无需合并。

## 15. 未决问题
- 「第三方等待」状态是否在多数帮助台中可获得。
- 50,000 条上限与大文件处理策略。
