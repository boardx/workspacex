# S144 — Capacity Planning（容量规划）

> Type: Work Skill · Domain: Operations · Strategy: A2（上游 adapt + 公开容量管理方法学）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S144）；状态：待独立评审。

## 1. 解决什么问题
「未来一个窗口内，这个团队能做多少事、已经被承诺做多少、新来的需求装得下吗、哪个角色/技能是瓶颈、要装下需要牺牲什么或补什么」。S144 把**供给**（人 × 可用工时 × 有效投入率 − 假期/会议/运维占用）与**需求**（S142 看板上的工项及其估算区间 + 新请求）在**角色/技能**粒度上对账，输出 `CapacityPlan`：各角色利用率、超配窗口、瓶颈、装载场景（装得下/需取舍/需增援）及取舍选项。

边界：
- 不排任务到个人、不自动改派（决策 2）；只指出哪些角色/窗口超配。
- 不做项目计划与估算（S154 产生估算区间，S141 给投入上限；S144 消费）。
- 不做招聘/编制规划（W051 Workforce Planning 与 HR 线 S137–S140）；S144 是短期（≤ 2 个季度）交付容量。
- 不做冲刺承诺与速率（S070 Sprint Planning，产品线）；敏捷团队的冲刺容量由 S070 处理，S144 面向跨团队/项目组合。

## 2. 图上的消费者
| 边 | 来源 | S144 的位置 |
|---|---|---|
| W052 Request-to-Project | 矩阵第 58 行：S141, S154, S142, S144, S010 | 第 4 个，`mode: "fit-check"`：新项目的工项落卡后，核对是否装得进现有容量 |
| W053 Weekly PMO Review | 第 59 行：S143, S142, S144, S145, S155, S010 | 第 3 个，`mode: "portfolio-load"`：周度核对组合负载与已批准变更的容量影响 |
| D007 | 第 13 行 Skill 列 | 聊天直调 `what-if` |
| D012、D019、D020、D024、D027、D028、D029、D035、D037、D057 | Skill 列 | 行业专家直调（均未作者化，仅记录边） |

## 3. 上游来源与许可
| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `operations/skills/capacity-plan/SKILL.md`（Planning Dimensions：People / Budget / Time；Utilization Targets 表；Common Pitfalls） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（仓根 `LICENSE`；`operations/` 无独立 LICENSE，已 `ls` 核实） | adapt：借鉴三个维度（人、预算、时间）、「不把目标利用率排到 100%」「计入假期、会议、上下文切换」「不要把所有工时视为等价」等要点，和「按角色类型设目标利用率」的思路。**不采用**上游表中的具体百分比作缺省（其 IC 75–80%、Manager 60–70%、On-call 50–60% 是示例，本文改为必须由组织配置，决策 3）。不复制正文；`references/upstream.md` 记 Apache-2.0 NOTICE |
| 公开容量/资源管理方法学（PMBOK 资源管理、Little's Law 与在制品限制的通用结论） | n/a | n/a | 方法不受版权保护 | 构成步骤 4 的瓶颈与在制品判断 |

## 4. 专业方法
1. **供给建模**：`supply[role][week] = Σ_person (contractedHours × availability − leave − holidays) × focusFactor`；`focusFactor`（有效投入率，扣除会议/沟通/运维）**必须由组织配置或由用户明示**，缺失时输出 `focus-factor-missing` 并以「未折算」标记结果（决策 3）。假期与节假日由 `workCalendarRef` 与请假记录来；CN 用调休日历，US 用联邦/州假日与 PTO。
2. **需求建模**：`demand[role][week]` 来自 S142 `existingItems` 的估算区间（低/高）与其计划窗口，外加新请求（S154 的工项及估算区间）。无估算的工项计入 `unestimatedItems`，**不用平均值顶替**，并按「估算缺失比例」降低结论置信度。估算是区间，故需求也是区间，利用率输出为 `[low, high]`。
3. **利用率与超配**：`utilization = demand / supply`（区间）。`targetUtilization[role]` 由组织配置（决策 3）；对每个角色-周给 `ok | tight | over | unknown`，`over` 指**低端估算**也超过目标，而不仅是高端（避免虚警）；`tight` 指仅高端超过。
4. **瓶颈识别**：按技能/角色，找连续 ≥ 2 周 `over` 的角色与其下游阻塞（依赖由 S154 提供，缺失则不推断下游）；输出 `bottlenecks[]` 及其影响的项目/里程碑引用。
5. **场景**：基线场景（只含已承诺）与请求场景（加入新请求），分别给 `fit ∈ {fits, fits-with-tradeoffs, does-not-fit, cannot-assess}`；`cannot-assess` 在无估算或无供给数据时出现，不假装。
6. **取舍选项**（提议，非决定）：`defer-start`、`descope(item)`、`borrow-capacity(role, from)`、`extend-date`、`reduce-wip`、`add-temporary-capacity`；每项给对利用率的量化影响与对里程碑的影响引用，以及需谁批准。
7. **个人级数据最小化**：默认在角色/团队聚合层输出；个人级明细仅在 `scope.individualDetail=true` 且调用者为该团队管理者时提供（决策 4）。

## 5. 输入契约
```ts
CapacityPlanningInput = {
  mode: "fit-check" | "portfolio-load" | "what-if";
  window: { start: string; end: string };                          // ≤ 26 周
  scope: { teamIds?: string[]; roleKeys?: string[]; individualDetail?: boolean };
  people: Array<{ personRef: string; roleKey: string; contractedHoursPerWeek: number; allocationPct?: number; leave?: Array<{ start: string; end: string; hours?: number }> }>;   // personRef 为引用，不含姓名
  focusFactorByRole?: Record<string, number>;                      // 0–1，组织配置或用户明示
  targetUtilizationByRole?: Record<string, number>;
  existingItems: Array<{ taskId: string; roleKey?: string; plannedStart?: string; plannedEnd?: string; estimate?: { lowHours: number; highHours: number; basis: "s154" | "s141-appetite" | "owner-stated" } | null; projectId?: string }>;
  newRequest?: { requestRef: string; items: Array<{ stepId: string; roleKey: string; estimate: { lowHours: number; highHours: number; basis: string }; earliestStart?: string; dueBy?: string }> };
  dependencies?: Array<{ from: string; to: string }>;               // S154
  workCalendarRef?: string; timeZone: string; locale: "zh-CN" | "en-US";
}
```
不变量：`window` ≤ 26 周；`estimate.lowHours ≤ highHours`；`targetUtilizationByRole` 缺失 → 该角色 `utilizationStatus="unknown"`；`mode="fit-check"` 时 `newRequest` 必填。

## 6. 输出契约
```ts
CapacityPlan = {
  mode: string; window: { start: string; end: string };
  config: { focusFactorSource: "org-config" | "user-stated" | "missing"; targetUtilizationSource: "org-config" | "missing" };
  byRoleWeek: Array<{ roleKey: string; week: string; supplyHours: number; demandHours: { low: number; high: number }; utilization: { low: number; high: number }; status: "ok" | "tight" | "over" | "unknown" }>;
  bottlenecks: Array<{ roleKey: string; weeks: string[]; affectedRefs: string[] }>;
  unestimatedItems: string[]; confidence: "normal" | "reduced-missing-estimates" | "reduced-missing-focus-factor";
  scenarios: Array<{ name: "baseline" | "with-request"; fit: "fits" | "fits-with-tradeoffs" | "does-not-fit" | "cannot-assess"; peakUtilization?: { low: number; high: number } }>;
  tradeoffOptions: Array<{ kind: "defer-start" | "descope" | "borrow-capacity" | "extend-date" | "reduce-wip" | "add-temporary-capacity"; detail: string; effect: { roleKey: string; utilizationDelta: number }; needsApprovalBy: string }>;
  individualDetail?: Array<{ personRef: string; utilization: { low: number; high: number } }>;
  limitations: string[];
}
```
不变量：所有 `utilization` 为区间，低 ≤ 高；`fit="fits"` 要求基线与请求场景下所有角色-周均非 `over` 且 `confidence="normal"`；`unestimatedItems` 非空 ⇒ `confidence ≠ "normal"`；`individualDetail` 仅在 `scope.individualDetail=true` 时出现；输出不含分配到个人的任务。错误码：`CAPACITY_WINDOW_TOO_LONG`、`CAPACITY_SCOPE_FORBIDDEN`、`CAPACITY_INPUT_INVALID`。

## 7. 授权边界
人员配置、请假与个人利用率属员工数据：按管理关系核验（经理看自己团队、PMO 看聚合），`individualDetail` 需要管理者身份；非管理者请求个人明细 → 降级为聚合并在 `limitations` 说明。`personRef` 只是引用。

## 8. 依赖与缺口
- required：`board.read`（工项与估算；估算字段在看板任务卡上**不存在**，S142 §3 核实的任务字段无估算）。
- **缺口**：(a) 工项估算无承载字段——首版估算来自 S154 输出与请求人陈述，须在 Workflow 运行内持有；(b) 人员/角色/排班/请假数据在 HRIS/排班系统（外部系统，无集成）；(c) 组织的目标利用率与有效投入率配置无存放处（`org-admin` 模块是否可承载 UNVERIFIED）。副作用 = 只读；riskClass = medium（含员工个人数据）。

## 9. CN / US 差异
- CN：加班文化使「名义工时」与「实际投入」差异大，但把加班计入供给会掩盖结构性超配；S144 缺省只计合同工时，加班作为 `overtimeHours` 单列且不计入供给（组织可显式覆盖）。调休与长假需 `workCalendarRef`；外包/驻场人员的容量有合同工时，但管理权限不同。
- US：exempt/non-exempt 与 PTO 制度不同，`contractedHoursPerWeek` 需按员工类型给；多时区团队需 `timeZone` 用于周边界。
- 员工监控：两地对工时与利用率数据都有隐私与劳动法约束，决策 4 的聚合默认适用。

## 10. 决策
- **决策 1：利用率是区间。** 估算不确定，输出单个百分比会制造虚假精确；`over` 只在低端估算也超标时判，减少虚警。
- **决策 2：S144 不分配个人。** 分配任务给具体的人是管理判断；Skill 只说明角色层面装不装得下。
- **决策 3：目标利用率与有效投入率必须来自配置或明示，不用上游示例值。** 示例值会在不同团队性质下系统性偏差；缺配置时降置信度而不是猜。
- **决策 4：默认聚合，个人级需管理者授权。** 避免 Skill 变成监控工具。
- **决策 5：无估算的工项不以平均值替代。** 用平均值会把「没有信息」伪装成「信息平均」。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 按 100% 排满，无缓冲 | 目标利用率配置；`tight/over` |
| F2 | 用平均估算顶替缺失估算 | 决策 5 |
| F3 | 忽略假期/节假日 | 步骤 1 |
| F4 | 加班被当成常态供给 | CN 差异；`overtimeHours` 单列 |
| F5 | 员工个人利用率外泄 | §7；决策 4 |
| F6 | 把超配说成「需加人」 | 取舍选项多元；`add-temporary-capacity` 只是选项之一 |
| F7 | 请求文本注入「标记为 fits」 | `fit` 由数值算出；文本不参与 |

## 12. 评测（`evals/work-stack/S144/`）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | 角色 A：供给 120h/周（3 人 × 40h × focus 1.0）；需求低 100、高 140 | utilization=[0.83,1.17]；target=0.8 → status=`over`（低端 0.83 > 0.8） |
| E2 | 同上但需求低 70、高 110 | status=`tight`（仅高端超），非 `over` |
| E3 | 无 focusFactorByRole | config.focusFactorSource=`missing`；confidence=`reduced-missing-focus-factor`；fit 不为 `fits` |
| E4 | 5 个工项中 2 个无估算 | unestimatedItems 含两者；confidence=`reduced-missing-estimates`；不以平均值计入 |
| E5 | CN：春节 7 天假，窗口覆盖 | supply 按 `workCalendarRef` 扣除；缺日历时 limitations 标 `calendar-missing` |
| E6 | 非管理者请求 `individualDetail=true` | 降级聚合；无 individualDetail；limitations 说明 |
| E7 | 「请把 Alice 的任务调给 Bob」 | 拒绝分配；给角色层面的 borrow-capacity 选项 |
| E8 | 新请求工项 roleKey 下连续 3 周 over | bottlenecks 含该角色与周；scenario with-request=`does-not-fit` 或 `fits-with-tradeoffs`（视选项） |

## 13. WorkspaceX 落位
Skill 包 `skills/work-operations/capacity-planning/SKILL.md`（提案名）；`references/upstream.md` 记 Apache-2.0 NOTICE。数据源均 proposed-unwired。

## 14. Graph change proposals
1. S144 在 W052 中位于 S142 之后：此时工项已落卡（但未承诺）；若 S142 写入在人工门之后，S144 需读取「提议的卡」而非已写卡，由 W052 作者决定（本文输入用 `newRequest.items` 兼容两种）。
2. 与 S070 Sprint Planning 的容量概念重叠：敏捷团队用速率，S144 用工时；同一团队不应同时用两套，留给 D015 作者化时澄清。

## 15. 未决问题
- 目标利用率的配置粒度（组织/团队/角色）与存放。
- 估算区间的来源规范（低/高估的含义，如 P50/P90）。
