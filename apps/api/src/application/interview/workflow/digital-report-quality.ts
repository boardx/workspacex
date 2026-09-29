export const INTERVIEW_REPORT_ANALYSIS_REQUIREMENTS = `每项核心发现必须形成分析链，而不是逐条复述访谈记录：
- 证据：指出来自哪位受访者、哪类回答或原话。
- 分析：跨回答归纳共同模式、差异或因果解释。
- 决策影响：说明该发现会改变什么选择、优先级或行动。
- 边界与反例：写明反对证据、置信度、适用边界或仍待验证的问题。
报告还必须包含跨回答综合、分歧/反例和可验证的行动建议；禁止按受访者顺序写成访谈纪要。`;

export type InterviewReportAnalysisGap =
  | "cross_answer_synthesis"
  | "decision_implication"
  | "boundary_or_counterevidence";

export type InterviewReportAnalysisAssessment = {
  readonly ok: boolean;
  readonly missing: readonly InterviewReportAnalysisGap[];
};

const SYNTHESIS_SIGNALS = [
  /跨(?:回答|受访者|角色|专家|样本)(?:综合|归纳|分析|比较)/u,
  /共同(?:模式|主题|约束|需求|指向)/u,
  /(?:多位|两位|不同)(?:受访者|专家|角色).{0,24}(?:共同|一致|差异|分歧|互补)/u,
];

const DECISION_SIGNALS = [
  /决策影响[：:]/u,
  /(?:优先级|优先验证|应优先|暂缓|停止|继续|选择).{0,36}(?:因为|基于|依据|验证|行动|方案|投入)/u,
  /P[012][：:]/u,
  /成功信号[：:]/u,
];

const BOUNDARY_SIGNALS = [
  /边界(?:与反例)?[：:]/u,
  /(?:反例|反对证据|相反证据|负面案例)[：:]/u,
  /(?:置信度|适用范围|样本边界|仍待验证|尚待验证|不能判断)/u,
];

function hasAny(markdown: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(markdown));
}

/** Rejects report-shaped interview notes that do not contain decision-grade synthesis. */
export function assessInterviewReportAnalysis(markdown: string): InterviewReportAnalysisAssessment {
  const missing: InterviewReportAnalysisGap[] = [];
  if (!hasAny(markdown, SYNTHESIS_SIGNALS)) missing.push("cross_answer_synthesis");
  if (!hasAny(markdown, DECISION_SIGNALS)) missing.push("decision_implication");
  if (!hasAny(markdown, BOUNDARY_SIGNALS)) missing.push("boundary_or_counterevidence");
  return { ok: missing.length === 0, missing };
}
