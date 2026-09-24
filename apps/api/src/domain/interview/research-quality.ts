import type { interview } from "@repo/contracts";
import type { z } from "zod";

type ResearchBrief = z.infer<typeof interview.DigitalInterviewResearchBrief>;
type ModeratorPolicy = z.infer<typeof interview.DigitalInterviewModeratorPolicy>;
type Question = z.infer<typeof interview.DigitalInterviewQuestion>;
type QuestionFinding = z.infer<typeof interview.DigitalInterviewQuestionQualityFinding>;
type CoverageCell = z.infer<typeof interview.DigitalInterviewCoverageCell>;

export interface QualityIssue {
  readonly code: string;
  readonly severity: "warning" | "blocking";
  readonly message: string;
  readonly objectId: string | null;
}

interface ExpertSummary {
  readonly expertId: string;
  readonly role: string;
  readonly domains: readonly string[];
  readonly goals: readonly string[];
  readonly materialBoundary: string;
}

const issue = (
  code: string,
  severity: QualityIssue["severity"],
  message: string,
  objectId: string | null = null,
): QualityIssue => ({ code, severity, message, objectId });

export function assessBrief(brief: ResearchBrief): readonly QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (brief.outOfScope.length === 0) {
    issues.push(issue("BRIEF_SCOPE_MISSING", "warning", "请明确本次研究不回答的问题。"));
  }
  if (brief.targetRoles.length === 0) {
    issues.push(issue("BRIEF_TARGET_ROLE_MISSING", "blocking", "至少需要一个目标角色。"));
  }
  if (brief.successCriteria.length === 0) {
    issues.push(issue("BRIEF_SUCCESS_CRITERIA_MISSING", "blocking", "至少需要一条成功标准。"));
  }
  return issues;
}

function meaningfulTokens(text: string): readonly string[] {
  const normalized = text.replace(/[，。？！、\s]/gu, "");
  const tokens = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2));
  }
  return [...tokens].filter((token) => !["识别", "理解", "验证", "主要", "不同"].includes(token));
}

export function assessExpertCoverage(input: {
  readonly brief: ResearchBrief;
  readonly experts: readonly ExpertSummary[];
}): readonly QualityIssue[] {
  return input.brief.learningGoals.flatMap((goal) => {
    const tokens = meaningfulTokens(goal.statement);
    const matched = input.experts.filter((expert) => {
      const haystack = [expert.role, ...expert.domains, ...expert.goals].join(" ");
      return tokens.some((token) => haystack.includes(token));
    });
    if (matched.length === 0) {
      return [issue("EXPERT_GOAL_UNCOVERED", "blocking", `学习目标“${goal.statement}”没有专家覆盖。`, goal.goalId)];
    }
    if (matched.length === 1) {
      return [issue("EXPERT_GOAL_SINGLE_PERSPECTIVE", "warning", `学习目标“${goal.statement}”只有一种专家视角。`, goal.goalId)];
    }
    return [];
  });
}

function questionFinding(
  code: QuestionFinding["code"],
  severity: QuestionFinding["severity"],
  question: Question | null,
  goalIds: readonly string[],
  message: string,
  suggestedRewrite: string | null,
): QuestionFinding {
  return { code, severity, questionId: question?.questionId ?? null, goalIds: [...goalIds], message, suggestedRewrite };
}

function normalizedIntent(text: string): string {
  return text.toLowerCase().replace(/[，。？！、,.?!\s]/gu, "");
}

export function assessQuestionQuality(input: {
  readonly brief: ResearchBrief;
  readonly questions: readonly Question[];
  readonly selectedExpertIds: readonly string[];
}): readonly QuestionFinding[] {
  const findings: QuestionFinding[] = [];
  const intents = new Map<string, Question>();

  input.questions.forEach((question) => {
    if (/(是不是|难道|显然|也认为)/u.test(question.text)) {
      findings.push(questionFinding("LEADING_WORDING", "blocking", question, question.goalIds, "问题包含诱导性措辞。", "请用中立方式询问受访者的实际判断。"));
    }
    if (/(并且|以及)/u.test(question.text) || /如何.+(并|和).*(解决|处理|判断)/u.test(question.text)) {
      findings.push(questionFinding("DOUBLE_BARRELLED", "warning", question, question.goalIds, "一个问题同时询问了多个动作。", "请拆成两个单一问题。"));
    }
    if (/(吗|是否|有没有)[？?]?$/u.test(question.text)) {
      findings.push(questionFinding("YES_NO_ONLY", "warning", question, question.goalIds, "问题可能只得到是或否。", "请改为开放式问题并要求说明原因。"));
    }
    if (question.section === "core" && !/(最近一次|上一次|曾经|回忆|具体|当时)/u.test(question.text)) {
      findings.push(questionFinding("MISSING_EXPERIENCE_ANCHOR", "warning", question, question.goalIds, "核心问题缺少真实经历锚点。", `请回忆最近一次相关经历：${question.text}`));
    }
    if (!input.selectedExpertIds.includes(question.expertId)) {
      findings.push(questionFinding("EXPERT_MISMATCH", "blocking", question, question.goalIds, "问题指向未确认的专家。", null));
    }
    const intent = normalizedIntent(question.text);
    const previous = intents.get(intent);
    if (previous) {
      findings.push(questionFinding("DUPLICATE_INTENT", "warning", question, question.goalIds, "问题与已有问题意图重复。", null));
    } else {
      intents.set(intent, question);
    }
  });

  if (!input.questions.some((question) => question.section === "counterexample")) {
    findings.push(questionFinding("MISSING_COUNTEREXAMPLE", "blocking", null, [], "至少需要一道反例问题。", "有没有一次情况与刚才描述的不同？"));
  }
  input.brief.learningGoals.forEach((goal) => {
    if (!input.questions.some((question) => question.section === "core" && question.goalIds.includes(goal.goalId))) {
      findings.push(questionFinding("GOAL_NOT_COVERED", "blocking", null, [goal.goalId], `学习目标“${goal.statement}”没有核心问题覆盖。`, null));
    }
  });
  return findings;
}

export function estimateInterviewDuration(input: {
  readonly questions: readonly Question[];
  readonly policy: ModeratorPolicy;
}): { readonly min: number; readonly max: number; readonly issues: readonly QualityIssue[] } {
  const depth = { light: 0.75, balanced: 1, deep: 1.5 }[input.policy.probingDepth];
  const base = input.questions.reduce((minutes, question) => {
    const sectionWeight = question.section === "warmup" || question.section === "closing" ? 1 : 1.5;
    const complexity = Math.min(1, question.text.length / 80);
    return minutes + sectionWeight + complexity;
  }, 0);
  const followUpFactor = 1 + Math.min(input.policy.maxFollowUpsPerQuestion, 4) * 0.12;
  const min = Math.round(base * depth * 10) / 10;
  const max = Math.round(base * depth * followUpFactor * 10) / 10;
  const issues: QualityIssue[] = [];
  if (max < 8) issues.push(issue("INTERVIEW_TOO_SHORT", "warning", "预计单专家访谈少于 8 分钟，可能缺少深度。"));
  if (max > 35) issues.push(issue("INTERVIEW_TOO_LONG", "blocking", "预计单专家访谈超过 35 分钟。"));

  const goalCounts = new Map<string, number>();
  input.questions.forEach((question) => question.goalIds.forEach((goalId) => goalCounts.set(goalId, (goalCounts.get(goalId) ?? 0) + 1)));
  if (input.questions.length > 2 && [...goalCounts.values()].some((count) => count / input.questions.length > 0.4)) {
    issues.push(issue("QUESTION_GOAL_IMBALANCE", "warning", "超过 40% 的问题集中在同一学习目标。"));
  }
  return { min, max, issues };
}

export function assessReadiness(input: {
  readonly briefIssues: readonly QualityIssue[];
  readonly expertIssues: readonly QualityIssue[];
  readonly questionIssues: readonly { readonly code: string; readonly severity: "warning" | "blocking"; readonly message: string; readonly questionId?: string | null; readonly objectId?: string | null }[];
  readonly durationIssues: readonly QualityIssue[];
}): { readonly status: "ready" | "warning" | "blocking"; readonly issues: readonly QualityIssue[] } {
  const issues = [
    ...input.briefIssues,
    ...input.expertIssues,
    ...input.questionIssues.map((item) => issue(item.code, item.severity, item.message, item.questionId ?? item.objectId ?? null)),
    ...input.durationIssues,
  ];
  return {
    status: issues.some((item) => item.severity === "blocking")
      ? "blocking"
      : issues.some((item) => item.severity === "warning") ? "warning" : "ready",
    issues,
  };
}

interface EvidenceRun {
  readonly expertId: string;
  readonly status: "running" | "completed" | "failed";
  readonly answers: readonly { readonly questionId: string; readonly answer: string }[];
}

export function buildEvidenceCoverage(input: {
  readonly brief: ResearchBrief;
  readonly expertIds: readonly string[];
  readonly questions: readonly Question[];
  readonly runs: readonly EvidenceRun[];
  readonly findings: readonly { readonly expertId: string; readonly questionId: string; readonly goalIds: readonly string[]; readonly summary: string }[];
}): readonly CoverageCell[] {
  const answeredExpertsByGoal = new Map<string, Set<string>>();
  input.questions.forEach((question) => {
    const run = input.runs.find((candidate) => candidate.expertId === question.expertId);
    if (!run?.answers.some((answer) => answer.questionId === question.questionId)) return;
    question.goalIds.forEach((goalId) => {
      const experts = answeredExpertsByGoal.get(goalId) ?? new Set<string>();
      experts.add(question.expertId);
      answeredExpertsByGoal.set(goalId, experts);
    });
  });

  return input.brief.learningGoals.flatMap((goal) => input.expertIds.map((expertId) => {
    const run = input.runs.find((candidate) => candidate.expertId === expertId);
    const questionIds = input.questions
      .filter((candidate) => candidate.expertId === expertId && candidate.goalIds.includes(goal.goalId))
      .map((candidate) => candidate.questionId);
    const answers = run?.answers.filter((answer) => questionIds.includes(answer.questionId)) ?? [];
    const findings = input.findings.filter((finding) => finding.expertId === expertId && finding.goalIds.includes(goal.goalId));
    const counterexampleCount = answers.filter((answer) => /(但|例外|不同|没有|相反)/u.test(answer.answer)).length;
    const runStatus = run?.status ?? "not_started";
    const status: CoverageCell["status"] = answers.length === 0
      ? "missing"
      : counterexampleCount > 0 ? "contradicted"
        : (answeredExpertsByGoal.get(goal.goalId)?.size ?? 0) >= 2 ? "supported" : "single_perspective";
    return {
      goalId: goal.goalId,
      expertId,
      answerCount: answers.length,
      findingCount: findings.length,
      counterexampleCount,
      runStatus,
      status,
    };
  }));
}

export function canApproveReport(input: {
  readonly legacy: boolean;
  readonly evidenceCoverage: readonly CoverageCell[];
  readonly sourceReferencesValid: boolean;
}): { readonly allowed: boolean; readonly blockingCodes: readonly string[] } {
  const blockingCodes: string[] = [];
  if (input.legacy) blockingCodes.push("LEGACY_REPORT_UNREVIEWED");
  if (input.evidenceCoverage.some((cell) => cell.status === "missing")) blockingCodes.push("REPORT_EVIDENCE_MISSING");
  if (!input.sourceReferencesValid) blockingCodes.push("REPORT_EVIDENCE_INVALID");
  return { allowed: blockingCodes.length === 0, blockingCodes };
}
