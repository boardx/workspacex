# S156 — Continuous Improvement（持续改进）

> Type: Work Skill · Domain: Operations · Strategy: A2（上游 adapt + 公开精益/PDCA 方法学）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S156）；状态：待独立评审。

## 1. 解决什么问题
S018 还原了现状，S011 找到了根因并给出 `correctiveActionCandidates`；S156 把它们变成**可执行的改进方案**：哪些对策值得做（按影响/信心/投入排序，且追溯到根因）、每个对策如何以 PDCA 的方式先小范围验证（假设、试点设计、成功度量、反证条件）、试点后「标准化 / 调整 / 放弃」的判断准则，以及同时进行的改进数量上限。产出 `ImprovementPlan`。

边界：
- 不找根因（S011）、不画流程（S018）、不写 SOP（S019：改进被标准化后才固化）、不设计指标体系（S162：S156 只给每个试点的度量要求并交 S162 定义）。
- 不批准投入、不改流程、不发布：提议 + 人工门。
- 不做精益专家的专项工具（价值流图、FMEA、SPC 等属 D012/D013 的 skillGaps，S156 不承载）。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| W055 Process Improvement | 矩阵第 61 行：S018, S011, S156, S019, S162 | 第 3 个：S011 之后；产出 ImprovementPlan，供 S019 固化与 S162 定度量 |
| D012 Lean / Kaizen Expert | 第 18 行 Skill 列 | 聊天直调 |
| D013 Six Sigma / Quality Expert | 第 19 行 | 同上（DMAIC 的 Improve 阶段；D013 未作者化） |
| D014 Business Process Reengineering Expert | 第 20 行 | 同上（再造 vs 改进的区分由 D014 定） |
| D015、D019、D036、D050 | Skill 列 | 教练/制造/质量/流程分析师直调（均未作者化，仅记录边） |

## 3. 上游来源与许可
| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `operations/skills/process-optimization/SKILL.md`（Analysis Framework：Map Current State / Identify Waste / Design Future State / Measure Impact；浪费清单 Waiting / Rework / Handoffs / Over-processing / Manual work） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（仓根 `LICENSE`；`operations/` 无独立 LICENSE，已 `ls` 核实） | adapt：借鉴「五类浪费」分类作为对策的 `wasteType` 枚举、「减少交接、并行化、用检查点而非审批门」等未来态设计原则、「改进前后度量」。上游只有 39 行且没有因果与验证环节：**本文新增**根因追溯、PDCA 试点、反证条件、WIP 上限、标准化判据（决策 1–4）。不复制正文；`references/upstream.md` 记 Apache-2.0 NOTICE |
| PDCA / Kaizen / A3 问题解决（丰田生产方式公开材料，Deming 循环）与精益八大浪费（DOWNTIME）概念 | n/a | n/a | 方法不受版权保护 | 构成步骤 3–5 |
| 改进卡（Improvement Kata）的「目标状态 — 当前状态 — 下一步实验」思路 | n/a | n/a | 方法不受版权保护 | 构成步骤 4 的小步试验 |

## 4. 专业方法
1. **输入对齐**：读取同运行内 S011 `rootCauses`、`correctiveActionCandidates`（含 `type ∈ {eliminate, prevent, detect, mitigate}`、`cutsEdgeIds`、`verificationSignal`）与 S018 `ProcessMap`（等待/返工/交接标注、`metrics`）。**每个改进项必须 `forRootCause`**（追溯到一个根因节点）；来自其他来源的改进想法进 `ungroundedIdeas[]`，不进入排序（决策 1）。
2. **对策归类**：每个对策标 `wasteType`（waiting/rework/handoff/over-processing/manual/defect/other）与 S011 的对策层级；层级偏好 `eliminate > prevent > detect > mitigate`，同一根因仅有 `mitigate` 时显式提示「只缓解未消除」。
3. **排序**：`priorityScore = impact × confidence ÷ effort`：`impact` 来自 S018 的 `timing`/`frequency` 与 S011 的覆盖边数（有 measured 数据时用数据，否则仅给 `impactBand ∈ {high, medium, low, unknown}`，`unknown` 不参与打分，单列）；`confidence` 取自 S011 假设被检验的状态（`confirmed`=高，`provisional`=中，其余=低）；`effort` 必须来自负责人或 S154 估算（无则 `unknown`，对策仍列出但不排名）。**排序只对三因子均可得的对策进行**，其余分组为 `needs-inputs`。
4. **PDCA 试点设计**：每个入选对策输出 `pilot`：`hypothesis`（「如果做 X，则 Y 指标在 Z 周内从 a 变到 b」，Y 来自 S011 `verificationSignal`）、`scope`（最小可验证范围：一个班组/一个客户群/一条产线）、`duration`、`metric`（交 S162 定义）、`counterMetric`（防止「改 A 坏 B」，如缩短处理时长的同时观察返工率）、`refutedIf`（什么结果说明假设不成立）、`rollbackPlan`。
5. **WIP 上限**：同一流程同时进行的试点数 ≤ `maxConcurrentPilots`（缺省 3，可配置）；超出的对策进 `queued`，不允许并行开十个改进。
6. **标准化判据**（试点结束时的**判据**，非结论）：`standardizeIf`（指标达到阈值且反指标不恶化且持续 ≥ N 个周期）、`adjustIf`、`abandonIf`；结论由人在试点后依数据判定，S156 不预判。
7. **变化管理提示**：对需要改变他人工作方式的对策，列 `adoptionRisks`（受影响角色、培训、沟通），交 S145/变革专家；S156 不做变更请求。
8. **改进账本**：`improvementLedger` 记录每个对策的 `status ∈ {proposed, piloting, standardized, adjusted, abandoned}` 与证据；S156 只产出 `proposed`（其余状态由后续运行更新并需人确认）。

## 5. 输入契约
```ts
ContinuousImprovementInput = {
  mode: "plan-from-rca" | "review-pilot";
  processRef: string;
  s011Ref: string;                                        // 同运行内，必填
  s018Ref?: string;                                       // 同运行内，可选但强烈建议
  effortEstimates?: Array<{ candidateId: string; lowHours: number; highHours: number; basis: "owner-stated" | "s154" }>;
  config?: { maxConcurrentPilots?: number; standardizeAfterCycles?: number };
  pilotResults?: Array<{ pilotId: string; metricSeries: Array<{ at: string; value: number }>; counterMetricSeries?: Array<{ at: string; value: number }>; notes?: string }>;    // review-pilot
  existingLedgerRef?: string;
  locale: "zh-CN" | "en-US"; asOf: string;
}
```
不变量：`plan-from-rca` 需 `s011Ref`；`review-pilot` 需 `pilotResults` 与 `existingLedgerRef`；引用只接受同运行内。

## 6. 输出契约
```ts
ImprovementPlan = {
  processRef: string; mode: string;
  candidates: Array<{
    candidateId: string; forRootCause: string; text: string; level: "eliminate" | "prevent" | "detect" | "mitigate"; wasteType: WasteType;
    impactBand: "high" | "medium" | "low" | "unknown"; confidence: "high" | "medium" | "low"; effort: { lowHours: number; highHours: number } | "unknown";
    priorityScore?: number; rank?: number; group: "ranked" | "needs-inputs" | "queued";
    mitigationOnlyWarning?: boolean;
  }>;
  pilots: Array<{ pilotId: string; candidateId: string; hypothesis: string; scope: string; durationWeeks: number; metric: { name: string; definitionRequest: true }; counterMetric: { name: string; definitionRequest: true }; refutedIf: string; rollbackPlan: string; standardizeIf: string; adjustIf: string; abandonIf: string; adoptionRisks: string[] }>;
  rejectedCandidates: Array<{ candidateId: string; reason: "duplicate" | "cost-exceeds-benefit" | "outside-control" | "owner-declined" | "other"; note: string }>;
  ungroundedIdeas: string[];
  wip: { max: number; active: number; queued: string[] };
  reviews?: Array<{ pilotId: string; observation: "metric-improved" | "metric-flat" | "metric-worse" | "counter-metric-worse" | "insufficient-data"; meetsStandardizeIf: boolean | "cannot-assess" }>;
  limitations: string[];
}
```
不变量：`candidates[].forRootCause` 必填且属于 S011 `rootCauses[].nodeId`；`group="ranked"` 要求 `impactBand ≠ unknown`、`effort ≠ unknown`；每个 S011 `correctiveActionCandidates[].candidateId` 恰好出现在 `candidates` 或 `rejectedCandidates` 之一，且每个 S011 根因至少有一个被接受或被显式拒绝的对策（与 S011 §评测 E14 的集成预期一致）；`pilots.length ≤ wip.max`；每个 pilot 有 `counterMetric` 与 `refutedIf`；`reviews[].meetsStandardizeIf` 不产出「已标准化」状态（仅是否满足判据，决定归人）；`pilots[].metric.definitionRequest = true`（指标定义交 S162）。错误码：`CI_S011_REF_FOREIGN`、`CI_NO_ROOT_CAUSE`（S011 为 inconclusive 时，S156 不出对策，返回需补证据）、`CI_INPUT_INVALID`。

## 7. 授权边界
引用的 S011/S018 产物随同运行内权限；改进试点涉及员工工作方式，`adoptionRisks` 只写角色不写人名。`review-pilot` 的数据来自有读权限的度量，不可读则 `insufficient-data`。

## 8. 依赖与缺口
- 无外部读能力必需（输入是同运行内 S011/S018 产物）。optional：`analytics.read`（`review-pilot` 时读取指标序列）。
- **缺口**：改进账本无领域对象（首版作为 Workflow 产物）；试点执行与度量采集在各业务系统（MES/ERP/工单）中，外部系统无集成；看板可承载试点任务但不含「试点/假设」语义。副作用 = 只读；riskClass = low。

## 9. CN / US 差异
- CN：制造业「精益/提案改善」「QC 小组」传统强，改进提案常有提案奖励机制；S156 对来自一线的 `ungroundedIdeas` 友好：不丢弃，但要求补根因追溯后才排序。国企/集团层面改进常需上报审批，`adoptionRisks` 含审批链说明。
- US：Lean Six Sigma 体系（DMAIC）使「Improve」阶段要求试点与控制计划；S156 的 `standardizeIf` 对应 Control 的入口，控制计划（SPC/FMEA）属 D013 的 gap，不在此实现。
- 劳动关系：涉及岗位变化的改进需提示 HR/工会/劳动法审查（仅标 `adoptionRisks`，不做法律判断）。

## 10. 决策
- **决策 1：没有根因追溯的改进不排序。** 「我觉得应该自动化」是好想法，但在 S011 给出的因果图之外做改进，等于放弃了 W055 的根因分析；这类想法进 `ungroundedIdeas`，仍保留供人裁量。
- **决策 2：排序只对三因子齐全的对策进行。** 缺投入估算时硬排名会产生错觉；`needs-inputs` 明确指出缺什么。
- **决策 3：每个试点必带反指标与反证条件。** 缩短处理时长可能增加返工；不设反指标的改进是在单指标上优化。
- **决策 4：WIP 上限。** 同时进行过多试点会让因果不可辨；队列化保护信号纯度。
- **决策 5：判据与结论分离。** S156 给出标准化判据，不下「标准化」结论；结论由人依数据下，并可因业务情境否决。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 改进与根因无关 | 决策 1 |
| F2 | 只缓解不消除却宣称解决 | `mitigationOnlyWarning` |
| F3 | 单指标优化，副作用未察觉 | 决策 3 |
| F4 | 试点泛滥，无法归因 | 决策 4 |
| F5 | 缺估算仍排名 | 决策 2 |
| F6 | 试点数据不足即宣布成功 | `insufficient-data`；判据 |
| F7 | S011 inconclusive 仍出对策 | `CI_NO_ROOT_CAUSE` |

## 12. 评测（`evals/work-stack/S156/`；夹具为合成流程：报销审批，S011 已给 2 个根因）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | S011 inconclusive | 抛 `CI_NO_ROOT_CAUSE`；不出对策 |
| E2 | 3 个对策（R1 根因 2 个、R2 根因 1 个）均有估算 | 三者 forRootCause 与 S011 节点对应；priorityScore 可复算 |
| E3 | 用户加一条「引入 AI 审核」但不对应任何根因 | 进 ungroundedIdeas，不排名 |
| E4 | 某对策无投入估算 | group=`needs-inputs`；不出 rank |
| E5 | 某根因只有 `mitigate` 类对策 | mitigationOnlyWarning=true |
| E6 | 5 个入选对策，maxConcurrentPilots=3 | pilots=3；其余 queued |
| E7 | pilot 设计 | 每个 pilot 含 counterMetric、refutedIf、rollbackPlan；metric.definitionRequest=true |
| E7b | S011 给出 2 个根因、4 个候选；人拒绝其中 1 个 | 4 个候选全部出现在 `candidates` 或 `rejectedCandidates`（被拒的带 reason）；每个根因至少有一条处置 |
| E8 | review-pilot：主指标改善但反指标恶化 | observation=`counter-metric-worse`；meetsStandardizeIf=false；不写「标准化」 |

## 13. WorkspaceX 落位
Skill 包 `skills/work-operations/continuous-improvement/SKILL.md`（提案名）；`references/upstream.md` 记 Apache-2.0 NOTICE。与 S011 的接口直接引用其 `correctiveActionCandidates` 字段（VERIFIED@本工作树 `skills/S011-root-cause-analysis.md` §7）。

## 14. Graph change proposals
1. D012 的 skillGaps（价值流图、标准作业、5S 等）与 S156 相邻但不重叠；S156 不吸收这些，避免 Skill 过宽。
2. W055 在 S156 之后是 S019（固化 SOP）：标准化判据需在试点之后才成立，而 W055 是线性一次性运行，无「试点期」。建议 W055 作者把 S156 分成「方案」与「试点复核」两次运行（`plan-from-rca` / `review-pilot`）并允许长时间等待，本文不改矩阵。

## 15. 未决问题
- W055 如何表达「等待试点结果」（数周）而不阻塞实例。
- 「影响」的量化基准（时间/成本/缺陷率）如何统一。
