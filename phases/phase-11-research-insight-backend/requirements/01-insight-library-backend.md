# 洞察库真实后端（U-8 缺口）— Phase 11

估点 **15**（F01 持久化+写路径 5 · F02 读路径+观察者脱敏 3 · F03 虚拟隔离门 2 · F04 主题整理三动作+回滚 3 · F05 普遍性断言 2；与 `feature_list.json` 逐条 points 对账，改一处需同步改另一处）

> ⚠ 本阶段 `has_ui: false`（见 `.harness/state/roadmap.yaml` 里 phase-11 的注释）——
> **不引入新的设计面**。本文档描述的 UI/用例/API 契约已经在 `phase-01` 的
> `contracts/interview/` 与 `contracts/research/` 两个契约束里签核
> （`status: confirmed`，`confirmed_by: yanbin shen`，`2026-07-30`）。本阶段只补
> **实现**：controller / application handler / 持久化表，不重写 `ui.md`/`usecases.md`，
> 不产生第二份 design-signoff 待签。
>
> 出处链（agent 开工前务必读一遍，不要重新猜设计）：
> - 契约类型与算子签名：`packages/contracts/src/interview.ts`（`Insight` / `EvidenceMatrix` /
>   `extractQuotes` / `generateCandidateInsights` / `confirmInsight` / `getEvidenceMatrix` /
>   `mergeThemes` / `splitThemes` / `adjustEvidenceWeight` / `markStrongInsight` /
>   `referenceForDecision` / `checkGeneralizationClaim`）。
> - 验收条清单：`phases/phase-01-run-a-project/contracts/interview/coverage.md`
>   「六、uc-6-5 R12（16 条 · 访谈回流成洞察）」一节，V1–V15（V7b 跨束不在本阶段范围）。
> - 已存在但**未接线**的领域逻辑：`apps/api/src/domain/interview/candidate-insight.ts`
>   （94 行）——复用它，不要重写候选生成/排除名单逻辑，本阶段缺的是 controller +
>   application handler + 持久化 + 权限接线。
> - 前端消费点（已签核截图，位于 phase-01）：`/studio/interview` 的 `itv-insights` /
>   `itv-tc-*` 等 `data-testid`，见 coverage.md 表格「前端消费点」列；具体线框在
>   `phases/phase-01-run-a-project/contracts/interview/ui.md` 的 U-8 各块
>   （候选区/统计区/证据矩阵/头部/专有空态/操作条）。

## R1 概览
- **Use Case 名称**：访谈回流成洞察（洞察库真实持久化 + 证据矩阵）
- **Actor**：研究员 / 引导师 / 组长（读写）；受访者、观察者、未授权者（受限只读或不可见，见 R5）
- **目标**：把已转写的访谈片段，经人工抽引述 + AI 归纳候选 + 人工确认，固化为可追溯到原始证据（时间码 + 说话人 + 场次）的洞察库条目；证据矩阵按主题 × 受访者呈现强度，供后续综合研究/决策引用。
- **系统边界**：`apps/api` 新增 `interview` 域的 insight 子域（controller + application handler + 持久化表），复用已有转写/受访者授权数据；不涉及 survey / canvas 域。

## R2 前置条件 / 触发条件
- 前置：访谈已完成转写（`getStageState` 有可用逐字稿片段）；调用者对该 `InterviewScope` 有读权限。
- 触发：研究员在 `/studio/interview` 洞察库屏点「抽引述」「生成候选洞察」「确认入库」等动作；或综合研究/项目工作台侧调用 `getEvidenceMatrix` 做只读投影。

## R3 主流程
1. 研究员对若干 `segmentIds` 调 `extractQuotes` → 系统返回原文引述（对 `ai_analysis=false` 的受访者片段同样返回原文，限制的是模型处理不是人工判断）。
2. 研究员调 `generateCandidateInsights`（携带 `contextPackId`，经 Context API 而非直连查询）→ 系统用 `candidate-insight.ts` 的归纳逻辑产出候选洞察数组 + `excludedSubjectIds`（排除名单写留痕，不静默跳过）+ `degradedToQuotesOnly` 标志。
3. 研究员对候选调 `confirmInsight`（可编辑文本）→ 系统校验**至少 1 条证据**，入库时**固化来源快照**（不可变引用，日后原逐字稿改动不影响已入库洞察的证据文本），持久化落表，返回完整 `Insight`。
4. 任意角色调 `getEvidenceMatrix(scope)` → 系统返回矩阵：格子按主题 × 受访者，值域含 `附和`（不计入强度合计）等完整枚举；头部同时给 `sessionCount` 与 `subjectCount` 两个独立数。
5. 研究员对已入库洞察调 `markStrongInsight` / `referenceForDecision` → 系统在接口层校验来源是否为真人（`sourceKind`），虚拟来源一律拒绝。
6. 研究员对多个主题调 `mergeThemes`（先 `preview:true` 看 `vanishingCells` 会不会抹掉唯一 `反例`，确认后 `preview:false` 真正合并，返回 `revertToken` 可回滚）；`splitThemes` / `adjustEvidenceWeight` 同构。
7. 报告撰写者对草稿文本调 `checkGeneralizationClaim` → 系统校验独立受访者数是否达到全仓统一门槛（≥5 才允许「用户普遍认为」类表述），不足则给出实际人数与改写建议。

## R4 备选流程与异常流程
- A1：无引述时矩阵显示真实空态（不是编造的示例数据）。
- A2：全员拒绝 AI 分析（`ai_analysis=false`）时 `generateCandidateInsights` 退化为 `candidates: [], degradedToQuotesOnly: true`，前端需**显式说明**「只出引述、不出候选洞察」，这不是错误态。
- E1：归纳服务失败 → `AI_GENERATION_UNAVAILABLE`，已抽引述保留，可重试，不产出半截洞察（事务性）。
- E2：候选没有证据 → `INSIGHT_NO_EVIDENCE`（生成阶段与确认阶段都可能触发）。
- E3：并发修改（两名研究员同时合并主题 / 确认洞察）→ `CONCURRENT_MODIFICATION`，不静默覆盖，可识别最终版本、可回滚。
- E4：合并/拆分/调权会让唯一 `反例` 消失 → `COUNTEREXAMPLE_WOULD_VANISH`，阻断，需先看 `preview` 结果。
- E5：虚拟来源被标强或引为决策依据 → `VIRTUAL_SOURCE_FORBIDDEN`（接口层拒绝，不是前端按钮置灰）。
- E6：无访谈访问权 → `NO_INTERVIEW_ACCESS`。
- E7：Context Pack / 依赖服务不可用 → `DEPENDENCY_UNAVAILABLE`。
- E8：撤回联动 —— 受访者撤回同意后 ≤5 分钟内，其引述退出检索且矩阵格子强度被重算（复用 phase-00/01 已有的 `WithdrawalOrchestrator`，本阶段只接线重算钩子，不重新设计撤回流程）。
- E9：普遍性断言不达标 → `GENERALIZATION_UNSUPPORTED`，4 位独立受访者时阻断，补到 5 位放行；同一人多条引述只算 1 人。

## R5 权限与可见性
- 研究员 / 引导师 / 组长：可执行 R3 全部动作（各自角色矩阵细节沿用 `interview` 契约束已定义的角色枚举，本阶段不新增角色）。
- 受访者：不可见洞察库/证据矩阵内部视图。
- 观察者：只读投影（脱敏版，具体脱敏规则沿用项目工作台「研究洞察」Tab 已有的观察者态注释：原始洞察库与未验证假设整块不可见，只保留聚合后的来源分布）。
- 未授权者：`NO_INTERVIEW_ACCESS`，入口不出现。

## R6 后置条件 / 不包含
- 后置：确认入库的洞察持久化，可被跨屏（项目工作台研究洞察 Tab、综合研究 Studio）以只读方式聚合引用。
- **不包含**：
  - survey 域的问卷聚合接线（`packages/contracts/src/survey.ts` 目前连 `operations` 导出都没有——是独立的更大缺口，不在本阶段范围，如需处理另开 phase）。
  - `report-template`/`insight-report`「洞察报告」——`interview.ts` 里已注明 `C_ITV_1`：主线最后两段没有用例，本阶段不臆造。
  - V7b（跨组织聚合样本量 <8 阻断）、V13/V14 审计与 Pack 回放面、V9 权限矩阵遍历测试——均标注为跨束（X-5/X-6/X-4/G-2），沿用已有实现或另计，本阶段不重复建模。
  - 项目工作台「研究洞察」Tab 前端接线（洞察来源分布聚合展示）——留给本阶段完成后的下一个 feature，或回补到 phase-01（因为 UI 已在 phase-01 签核），本阶段交付的是它依赖的后端。

## R7 业务规则
- 每条洞察入库时必须固化来源快照，日后原始转写被编辑不影响已入库证据文本。
- 虚拟来源（数字人/画像访谈）永远不能被标「强」或引为决策依据——这是接口层门，不是前端展示门。
- `附和` 类证据不计入矩阵强度合计。
- 唯一 `反例` 不允许被合并/拆分/调权操作静默抹掉，必须走预览确认。
- 普遍性断言（"用户普遍认为"类表述）门槛是全仓单一常量（5 位独立受访者），本契约只引用判定结果，不在本域重新声明这个数字。

## R8 界面线索
（本阶段 has_ui: false，UI 已在 phase-01 `contracts/interview/ui.md` U-8 各块签核，不在本文件重复。）

## R9 非功能约束
- 性能/规模预期：无特殊要求，量级与现有访谈域一致。
- 安全/隐私/合规：虚拟来源隔离、观察者脱敏、撤回联动重算三条必须落实（见 R4/R5/R7），不得因为是新表就退化掉这三条已签核规则。
- 兼容与降级要求：AI 归纳服务不可用时按 E1 处理，不得阻塞人工抽引述路径。

## R10 已知约束 / 依赖
- 依赖 phase-01 已 `passing` 的转写/受访者授权/`WithdrawalOrchestrator`/`buildInterviewContextPack` 能力。
- 依赖 phase-01 已 confirmed 的 `interview` 契约束（本阶段不重签，只实现）。
- 技术约束：沿用 `apps/api` 既有洋葱架构分层（`domain` → `application` → `interface/controllers`），复用 `apps/api/src/domain/interview/candidate-insight.ts` 现有归纳逻辑，不重写。

## R11 切分提示
- 建议按算子分组切 feature（例如：F01 持久化表 + `extractQuotes`/`generateCandidateInsights`/`confirmInsight` 写路径；F02 `getEvidenceMatrix` 读路径 + 观察者脱敏；F03 `markStrongInsight`/`referenceForDecision` 虚拟隔离门；F04 `mergeThemes`/`splitThemes`/`adjustEvidenceWeight` 三个人工整理动作 + 回滚；F05 `checkGeneralizationClaim` 写作约束）。每个 feature 一次会话可完成并验证。
- F01 是其余四个的前置依赖（没有持久化表，其余都无法真实验证）。

## R12 AI Ready 验收线索
- 成功态：R3 七步全部可端到端跑通并在数据库留痕。
- 每个异常态（E1–E9）都有对应可执行的失败断言。
- 每种权限态（研究员/引导师/组长可写，受访者不可见，观察者脱敏只读，未授权 `NO_INTERVIEW_ACCESS`）都有对应断言。
- 证据矩阵头部 `sessionCount`/`subjectCount` 两个数在样本不对齐场景下都正确。
- 虚拟隔离在接口层生效（不是前端置灰）：直接调 API 绕过前端仍被拒绝。
