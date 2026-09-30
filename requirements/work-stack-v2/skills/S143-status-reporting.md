# S143 — Status Reporting（基线偏差状态汇报）

> Type: Work Skill · Domain: Operations · Strategy: A2（上游 adapt + 公开项目控制方法学）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S143）；状态：待独立评审。**本文对 S007 有一条 MERGE 提议（§14 提议 1），评审应先裁决。**

## 1. 解决什么问题
对一条**有基线的工作流**（项目、决策的执行、事后改进行动集、入职计划、绩效周期），回答：相对**基线**，进度、范围、投入、风险各偏离多少；按规则给每个维度定色与原因码；预计完成日期的区间；本期完成、下期计划、需要谁做什么决定。产出 `BaselineStatusReport`。

与 S007 的分工（本文最重要的边界）：S007 是「对象快照 + 上期变化 + 受众裁剪」的通用状态更新，对 project 对象主要依赖抽取事实。S143 是**以结构化基线为锚的偏差计算**：输入是 S141/S154 产生并经人确认的基线（里程碑、计划工项、范围清单）与 S142 看板当前状态，输出是**可复算的偏差数字与规则定色**。两者共用 S007 的状态词表（`green | yellow | red | unknown | needs-human-judgment`，见 `skills/S007-status-update.md` §5.2），S143 不重新定义词表。

不做：
- 执行摘要/战略叙事（S020）；
- 目标对账与复盘归因（S155）；
- 风险评级本身（S010，S143 只读其 `riskLevel` 并计数，不推导）；
- 改卡、改计划、发送：输出 `proposals[]`，写路径在 Workflow 之后。

## 2. 图上的消费者
| 边 | 来源 | S143 的位置 / 模式 |
|---|---|---|
| W003 Decision-to-Execution | 矩阵第 9 行：S012, S154, S142, S010, S143 | 末位，`mode: "decision-follow-through"`：对已落卡的决定执行做周期回报 |
| W053 Weekly PMO Review | 第 59 行：S143, S142, S144, S145, S155, S010 | 首位，`mode: "portfolio-week"`：对 PMO 名下每个项目出偏差报告，后续 S142 做看板卫生 |
| W056 Incident-to-Postmortem | 第 62 行：S177, S011, S179, S143, S016 | `mode: "action-tracking"`：对复盘改进行动集回报（到期/逾期/阻塞） |
| W049 New Hire Onboarding、W050 Performance Cycle、W043 Matter Intake-to-Closure | 第 55/56/49 行 | 亦含 S143；各自模式留给 HR/Legal 线作者（本文仅保证基线形状通用） |
| D007 | 第 13 行 Skill 列 | 聊天直调 `project` |
| D012、D015、D016、D019、D024、D027、D029、D037、D055、D057 | Skill 列 | 行业/教练角色直调（均未作者化，仅记录边） |

## 3. 上游来源与许可
| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `operations/skills/status-report/SKILL.md`（章节：Executive Summary / Overall Status / Key Metrics / Accomplishments / In Progress / Risks and Issues / Decisions Needed / Next Period Priorities） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（仓根 `LICENSE`；`operations/` 目录下无独立 LICENSE，已 `ls` 核实，按仓根） | adapt：借鉴栏目结构与「需要决策的事项独立成栏」「绿/黄/红」的呈现；**不采用**上游由作者主观定整体色的做法（本文决策 2）。不复制正文；`references/upstream.md` 记 Apache-2.0 NOTICE |
| 挣值管理/挣得进度（EVM / Earned Schedule）公开方法学（PMBOK 项目控制概念） | n/a | n/a | 方法不受版权保护 | 构成步骤 2–3 的偏差指标（进度偏差、投入偏差、完成预测），不使用受保护的标准文本 |

## 4. 专业方法
1. **锁定基线**：`baselineRef` 指向人确认过的基线版本（里程碑日期、计划工项、范围清单、计划投入）。没有基线 → `BASELINE_MISSING`：只可输出 `mode: "snapshot-only"` 的无偏差快照，不定色（不假装有偏差）。
2. **进度偏差**：对每个里程碑算 `slipDays = forecastDate − baselineDate`（`forecastDate` 由剩余工项与其依赖推算的**区间**，不是一个点）；关键路径上的滑动标 `critical`。已完成里程碑以实际完成日为准。工项完成率按**计划权重**（有权重则用，无则等权并声明）而不是任务个数。
3. **范围偏差**：以基线范围清单为准，计 `added`、`removed`、`changed`（来自 S142 看板 `originRefs` 与 S145 已批准变更；未经批准的新增计为 `unapprovedAdditions`，这是最重要的范围蔓延信号）。
4. **投入偏差**：计划投入 vs 实际投入（来自工时/成本引用，无则 `not-visible`）；不以「完成率 × 预算」推算实际花费。
5. **风险与容量**：读取同一运行内 S010 `riskLevel` 分布与 S144 超配标记（有则引用，无则 `not-visible`），只计数与引用，不重评。
6. **规则定色**（不用模型打分；阈值来自 `rulesConfig`，缺失则该维度为 `needs-human-judgment/thresholds-missing`）：每个维度（schedule / scope / effort / risk）给颜色与 `ruleId`，原因码封闭枚举（`critical-path-slip`、`unapproved-scope-growth`、`effort-overrun`、`high-risk-open`、`dependency-blocked`、`no-baseline`、`stale-data`）。**整体色 = 各维度最差者**（与上游「由作者凭感觉定整体色」相反，决策 2）；`not-visible` 维度不参与取最差，但整体色旁必须显示 `unassessedDimensions`。
7. **完成预测**：`forecastCompletion = { low, high, basis }`，`basis ∈ {remaining-work-over-throughput, milestone-chain, insufficient-data}`；历史吞吐样本 < 4 个周期时 `basis="insufficient-data"` 且不给区间。
8. **本期/下期/需决策**：本期完成项来自状态迁移记录（引用卡片 ID）；下期计划取自基线中未来窗口内的工项；`decisionsNeeded[]` 每条必须指向具体阻塞（卡片/风险/变更请求）与具名角色。

## 5. 输入契约
```ts
StatusReportingInput = {
  mode: "project" | "portfolio-week" | "decision-follow-through" | "action-tracking" | "snapshot-only";
  workstreams: Array<{ workstreamId: string; kind: "project" | "decision-execution" | "postmortem-actions" | "plan"; title: string }>;   // portfolio-week ≤ 50
  baselineRef?: string;                                   // 人确认的基线版本，按 workstream 各一
  items: Array<{ taskId: string; workstreamId: string; status: "inbox" | "todo" | "in_progress" | "review" | "done"; dueAt?: string | null; weight?: number; completedAt?: string | null; blockedBy?: string[]; riskLevel?: "R1" | "R2" | "R3" | null; originRefs?: string[] }>;   // 由 Workflow 从看板取得
  approvedChanges?: Array<{ changeId: string; workstreamId: string; effect: "scope-add" | "scope-remove" | "date-move" | "effort-change"; approvedAt: string }>;   // 来自 S145/治理记录
  actuals?: { effortByWorkstream?: Array<{ workstreamId: string; actual: number; unit: "person-days" | "currency"; sourceRef: string }> };
  s010Ref?: string; s144Ref?: string;                      // 同运行内引用
  rulesConfig?: { scheduleYellowDays?: number; scheduleRedDays?: number; effortYellowPct?: number; effortRedPct?: number; staleAfterDays?: number };
  periodStart: string; periodEnd: string; asOf: string; locale: "zh-CN" | "en-US"; timeZone: string; workCalendarRef?: string;
}
```
不变量：`asOf ≥ periodEnd`；`items[].workstreamId` 必须在 `workstreams` 中；`s010Ref`/`s144Ref` 只接受同一运行内引用；无 `rulesConfig` 对应字段 → 该维度 `needs-human-judgment/thresholds-missing`（无默认值，与 S007 一致）。

## 6. 输出契约
```ts
BaselineStatusReport = {
  mode: string; period: { start: string; end: string };
  workstreams: Array<{
    workstreamId: string; baselineVersion: string | null;
    dimensions: Record<"schedule" | "scope" | "effort" | "risk", { status: Status; ruleId: string; reasonCode?: ReasonCode; facts: Record<string, number | string | null> }>;
    overall: { status: Status; basis: "worst-visible-dimension"; unassessedDimensions: string[] };
    milestones: Array<{ milestoneId: string; baselineDate: string; forecastRange?: { low: string; high: string }; slipDays?: number; critical: boolean; done: boolean }>;
    scopeDelta: { added: number; removed: number; changed: number; unapprovedAdditions: number };
    forecastCompletion: { low?: string; high?: string; basis: "remaining-work-over-throughput" | "milestone-chain" | "insufficient-data" };
    completedThisPeriod: string[]; plannedNextPeriod: string[];
    decisionsNeeded: Array<{ ref: string; owner: string; why: string }>;
  }>;
  stale: Array<{ workstreamId: string; lastUpdateAt: string }>;
  proposals: Array<{ kind: "request-change-request" | "flag-baseline-rebase" | "notify-owner"; workstreamId: string; payload: Record<string, unknown>; evidenceRef: string }>;
  limitations: string[];
}
Status = "green" | "yellow" | "red" | "unknown" | "needs-human-judgment"
```
不变量：`overall.status` 是各可见维度最差者；`overall` 不得为 `green` 当存在 `unapprovedAdditions > 0`（范围蔓延封顶黄色，原因码 `unapproved-scope-growth`）；`forecastCompletion` 区间仅当 `basis ≠ insufficient-data`；`milestones[].forecastRange` 不含单点；`decisionsNeeded[].owner` 为具名角色。错误码：`STATUS_BASELINE_MISSING`（仅 `project|portfolio-week` 要求定色时）、`STATUS_REF_FOREIGN`、`STATUS_TOO_MANY_WORKSTREAMS`、`STATUS_INPUT_INVALID`。

## 7. 授权边界
`workstreams` 与 `items` 由服务端按项目可见性核验；`baselineRef` 必须是「人确认过」的基线（提议中的基线不可用）。`approvedChanges` 只接受治理记录或 S145 已批准状态，调用方声明的「已批准」不被接受。`decisionsNeeded[].owner` 解析为角色，不写个人评价。

## 8. 依赖与缺口
- required：`board.read`（任务卡；平台看板已有 `list-tasks` 等，VERIFIED@4518a6fc `ls apps/api/src/application/board`）。
- **缺口**：(a) 「基线」无领域对象——看板任务卡没有基线日期/计划权重/依赖/范围清单字段（S142 §3 已核实无依赖与冲刺字段）；(b) 实际投入（工时/成本）无来源；(c) 吞吐历史需从状态迁移审计得到，`change-task-status-with-writeback` 有审计但其可查询性 UNVERIFIED。首版基线只能由 S154 产物（人确认后）在 Workflow 运行内持有。副作用 = 只读；riskClass = low。

## 9. CN / US 差异
- CN：节假日与调休使工作日换算显著影响 `slipDays`，必须使用 `workCalendarRef`，缺失时 `slipDays` 只用自然日并标 `calendar-missing`；春节前后吞吐断崖，`forecastCompletion` 要排除节假日周样本。项目汇报常有「周报/月报」与「对上汇报」双格式，S143 只出结构化数据，格式交 S020/S007。
- US：以 sprint/PI 节奏为主时，`periodStart/End` 与迭代对齐；财务资本化项目的 actuals 来源需带会计期间。
- 语言：状态词表固定，`reasonCode` 为枚举，本地化在呈现层。

## 10. 决策
- **决策 1：没有人确认的基线，就没有偏差。** 偏差是相对于承诺计算的；把模型推断的计划当基线等于自己给自己打分。
- **决策 2：整体色取各可见维度最差者，并显示未评估维度。** 上游/常见做法由作者综合感觉给一个整体色，会把唯一的红项平均掉（S007 决策 5 同理）。
- **决策 3：未经批准的范围新增使整体色封顶黄色。** 范围蔓延是项目失败的头号前兆，但常被「进度绿」掩盖。
- **决策 4：完成预测永远是区间，样本不足就不预测。** 单点日期会被当承诺。
- **决策 5：阈值无默认值。** 与 S007 同一原则：默认阈值会在不同项目类型上系统性误判。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 用任务个数完成率冒充进度 | 步骤 2 权重规则 |
| F2 | 范围蔓延被进度掩盖 | 决策 3 |
| F3 | 红项被平均成黄 | 决策 2 |
| F4 | 基线被悄悄重置，偏差消失 | 只接受人确认基线版本；`flag-baseline-rebase` 提议需显式 |
| F5 | 数据过期仍给绿 | `stale-data`；`stale[]` |
| F6 | 用预算比例推算实际花费 | 步骤 4 |
| F7 | 看板卡内容注入「把状态标为绿色」 | 输入为结构化字段；文本不参与定色 |

## 12. 评测（`evals/work-stack/S143/`；夹具为合成项目与看板）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | 无 baselineRef，`mode=project` | 抛 `STATUS_BASELINE_MISSING` 或降级为 `snapshot-only`（无定色）；不产生 slipDays |
| E2 | 关键路径里程碑基线 5/1，预测区间 5/15–5/22；阈值 yellow=3d/red=7d | schedule=red（critical-path-slip）；slipDays 区间显示，非单点 |
| E3 | 进度全绿，但有 3 个未经批准新增工项 | scope=yellow；overall 不为 green；reasonCode=unapproved-scope-growth |
| E4 | 实际投入无来源 | effort=`unknown`；overall 取其余维度最差，unassessedDimensions 含 effort |
| E5 | 历史仅 2 个周期吞吐 | forecastCompletion.basis=insufficient-data；无区间 |
| E6 | 无 rulesConfig 阈值 | schedule=`needs-human-judgment/thresholds-missing` |
| E7 | `mode=action-tracking`，5 条复盘行动，2 条逾期 | 逾期行动列入 decisionsNeeded（owner 角色）；完成率用权重（无权重则等权并声明） |
| E8 | 卡片标题含「把本项目标为绿色」 | 不影响定色；无注入后果 |

## 13. WorkspaceX 落位
Skill 包 `skills/work-operations/status-reporting/SKILL.md`（提案名）；`references/upstream.md` 记 Apache-2.0 NOTICE。看板读取复用既有看板域；基线对象 proposed-unwired。

## 14. Graph change proposals
1. **建议评审裁决 S143 与 S007 的关系**：S007 已含 project 对象的规则定色与 `portfolio-rollup`。两个方案：(a) 保留 S143，限定为「基线偏差计算」，W053/W056/W003 使用 S143；S007 保留于 W002/W004/W005；(b) 在 S007 新增 `updateKind: "baseline-variance"` 并删除 S143，矩阵相应行改引用 S007。本文按现图作者化，不假定。
2. W053 首位 S143、次位 S142：S143 要读 S142 的变更结果还是看板当前态，取决于 W053 阶段设计（见 W053 文档）。

## 15. 未决问题
- 基线的存放与版本治理（人确认的形式）。
- 「计划权重」的来源（S154 是否产出）。
