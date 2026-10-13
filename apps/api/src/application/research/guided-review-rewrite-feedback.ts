import { ResearchRuntimeError } from "./guided-runtime-ports";
import type { QuestionEvidence } from "./guided-report-evidence";

interface FeedbackQuestion { questionId: string; status: "answered" | "gap" | "missing"; rationale: string; rationaleTruncated: boolean }
export interface ReviewRewriteFeedback {
  feedbackKind: "unvalidated_review_output";
  issues: string[];
  unvalidatedReviewFeedback: { questions: FeedbackQuestion[]; supported?: boolean; analysisDepth?: "adequate" | "shallow" };
}
/** Corrective observations only. This type cannot represent an accepted review. */
export function extractReviewRewriteFeedback(raw: unknown, scope: readonly QuestionEvidence[]): ReviewRewriteFeedback | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>; const allowed = new Set(scope.map(q => q.id));
  const rows = Array.isArray(value.questions) ? value.questions.slice(0, 64) : [];
  const counts = new Map<string, number>();
  for (const row of rows) if (row && typeof row === "object" && typeof row.questionId === "string") counts.set(row.questionId, (counts.get(row.questionId) ?? 0) + 1);
  let remaining = 20000;
  const bounded = (text: string, maximum: number) => { const result = text.slice(0, Math.min(maximum, remaining)); remaining -= result.length; return result; };
  const questions: FeedbackQuestion[] = rows.flatMap(row => {
    if (!row || typeof row !== "object" || typeof row.questionId !== "string" || !allowed.has(row.questionId) || counts.get(row.questionId) !== 1
      || !["answered", "gap", "missing"].includes(row.status) || typeof row.rationale !== "string" || !row.rationale.trim() || remaining <= 0) return [];
    const rationale = bounded(row.rationale, 1000);
    return [{ questionId: row.questionId, status: row.status, rationale, rationaleTruncated: rationale.length !== row.rationale.length }];
  });
  const issues = Array.isArray(value.issues) ? value.issues.slice(0, 30).flatMap(issue => typeof issue === "string" && issue.trim() && remaining > 0 ? [bounded(issue, 2000)] : []) : [];
  for (const q of questions) if (q.status === "missing") issues.push(`${q.questionId}: ${q.rationale}`);
  if (value.supported === false) issues.push("Remove unsupported affirmative claims throughout the chapter; a final disclaimer cannot repair contradictory assertions. Verify alleged defects against the original quotes.");
  if (value.analysisDepth === "shallow") issues.push("Develop substantive analysis and concrete verification without inventing missing evidence.");
  if (!issues.length) return undefined;
  return { feedbackKind: "unvalidated_review_output", issues,
    unvalidatedReviewFeedback: { questions, ...(typeof value.supported === "boolean" ? { supported: value.supported } : {}),
      ...(value.analysisDepth === "adequate" || value.analysisDepth === "shallow" ? { analysisDepth: value.analysisDepth } : {}) } };
}
class RejectedReviewOutput extends ResearchRuntimeError {
  constructor(readonly rewriteFeedback: ReviewRewriteFeedback, cause: unknown) { super("RESEARCH_REPORT_QUALITY_INSUFFICIENT", { cause }); }
}
export function rejectReviewOutput(raw: unknown, scope: readonly QuestionEvidence[], error: unknown): never {
  const feedback = extractReviewRewriteFeedback(raw, scope);
  if (feedback) throw new RejectedReviewOutput(feedback, error);
  throw error;
}
export function reviewRewriteFeedback(error: unknown): ReviewRewriteFeedback | undefined {
  return error instanceof RejectedReviewOutput ? error.rewriteFeedback : undefined;
}
export function isReviewRewriteFeedback(value: unknown): value is ReviewRewriteFeedback {
  return Boolean(value && typeof value === "object" && "feedbackKind" in value && value.feedbackKind === "unvalidated_review_output");
}
