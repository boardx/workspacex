import { REPORT_SOURCE_PLAN_GUIDANCE } from "./interview-report-source-plan-guidance";
export const INTERVIEW_REPORT_ANALYSIS_REQUIREMENTS = `每项核心发现必须形成分析链，而不是逐条复述访谈记录：
- 证据：指出来源角色和完整原话，保留原文记录的动作、条件与发生状态。
- 分析：跨回答比较已有观察与差异；研究者机制解释标为待验证推论，逐项说明依据、成立条件与未知因素。
- 决策影响：对应已有结果与测量范围说明可更新的选择或假设；尚未测得的影响保持未知并提出相应观测。
- 边界与反例：写明反对证据、置信度、适用边界或仍待验证的问题。
${REPORT_SOURCE_PLAN_GUIDANCE}
报告还必须包含跨回答综合、分歧/反例和可验证的行动建议；禁止按受访者顺序写成访谈纪要。`;

/** Shared theme guidance for both canonical Markdown and streaming report generation. */
export const INTERVIEW_REPORT_THEME_GUIDANCE = `先根据研究主题和决策目标选择最合适的主题化报告结构，再在结构中保留统一的研究骨架。统一骨架至少包含：研究结论摘要、证据与原始回答、不确定性与限制、下一步验证建议。主题化章节按主题选择：采购/决策链重点分析角色、否决点、推进阶段与决策影响；JTBD/使用场景重点分析触发事件、替代方案、行为过程与未满足需求；流失/体验复盘重点分析时间线、摩擦点、情绪转折与留存机会；竞品/切换重点分析离开推力、目标方案拉力、切换焦虑与反例；合规/风险重点分析约束、审批节点、风险等级与缓解动作。不要机械输出不适用于当前主题的章节。`;

export { assessInterviewReportAnalysis } from "@repo/contracts/interview-markdown";
export type { InterviewReportAnalysisGap, InterviewReportAnalysisAssessment } from "@repo/contracts/interview-markdown";
