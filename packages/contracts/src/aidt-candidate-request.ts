/** Explicit native human Chat actions; never permissions, approvals or evidence markers. */
export const AIDT_CANDIDATE_ACTIONS = {
  problem: "[AIDT:FRAME:PROBLEM-CANDIDATES:1]",
  ideation: "[AIDT:IDEATE:IDEA-CANDIDATES:1]",
  prototype: "[AIDT:PROTOTYPE:TEXT-CANDIDATES:1]",
  test: "[AIDT:TEST:LEARNING-CANDIDATES:1]",
  interview: "[AIDT:INTERVIEW:DISCOVERY-CANDIDATES:1]",
  persona: "[AIDT:DEFINE:PERSONA-CANDIDATES:1]",
  hmw: "[AIDT:DEFINE:HMW-CANDIDATES:1]",
} as const;
export type AidtCandidateRequestKind = keyof typeof AIDT_CANDIDATE_ACTIONS;

/** Only the exact first line of this actual human input suppresses draft projection. */
export function isAidtCandidateRequest(humanText: string, kind: AidtCandidateRequestKind): boolean {
  return humanText.startsWith(AIDT_CANDIDATE_ACTIONS[kind] + "\n");
}

/** Student-saved provenance only: these fields never prove approval, authorship or evidence. */
export const AIDT_PROBLEM_CANDIDATE_SOURCE_FIELD = "problemCandidateSource";
export const aidtInterviewFindingAiSourceField = (entityId: string) => `interviewFindingAiSource:${entityId}`;
type CandidateSourceRef = { kind: "ai-assisted-student-edited" | "ai-summary-student-selected"; messageId: string; threadId: string; requestId: string };
const shortRef = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
function candidateSource(raw: string | undefined, allowed: readonly string[]): Record<string, unknown> | null {
  if (!raw || raw.length > 2500) return null;
  try { const value: unknown = JSON.parse(raw); return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)) ? value as Record<string, unknown> : null; } catch { return null; }
}
function candidateSourceRefs(value: Record<string, unknown> | null, kind: CandidateSourceRef["kind"]): CandidateSourceRef | null {
  return value?.kind === kind && shortRef(value.messageId) && shortRef(value.threadId) && shortRef(value.requestId)
    ? { kind, messageId: value.messageId, threadId: value.threadId, requestId: value.requestId } : null;
}
export function readAidtProblemCandidateSource(fields: Readonly<Record<string, string>>): CandidateSourceRef | null {
  const value = candidateSource(fields[AIDT_PROBLEM_CANDIDATE_SOURCE_FIELD], ["kind", "messageId", "threadId", "requestId", "rewrittenTheme"]);
  return value && typeof value.rewrittenTheme === "string" && !!value.rewrittenTheme.trim() && value.rewrittenTheme === fields.rewrittenTheme
    ? candidateSourceRefs(value, "ai-assisted-student-edited") : null;
}
export function readAidtInterviewFindingAiSource(fields: Readonly<Record<string, string>>, entityId: string, projectId: string, headline: string): CandidateSourceRef | null {
  if (fields["interviewArchived:" + entityId] === "true" || !headline.trim()) return null;
  try {
    const record: unknown = JSON.parse(fields["interviewRecord:" + entityId] ?? "null");
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const interview = record as { id?: unknown; consent?: { notes?: unknown } };
    if (interview.id !== entityId || interview.consent?.notes !== true) return null;
  } catch { return null; }
  const value = candidateSource(fields[aidtInterviewFindingAiSourceField(entityId)], ["projectId", "entityId", "kind", "messageId", "threadId", "requestId", "headline"]);
  return value?.projectId === projectId && value.entityId === entityId && value.headline === headline
    ? candidateSourceRefs(value, "ai-summary-student-selected") : null;
}
