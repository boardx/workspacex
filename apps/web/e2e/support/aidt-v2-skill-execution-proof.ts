import { createHash } from "node:crypto";
export type SkillExecutionExpectation = { runId: string; threadId: string; inputMessageId: string; selectedSkillVersionId: string; skillStableName: string; skillContentSha256: string; assistantText: string };
type FullHash = { present: boolean; chars: number; sha256: string };
type ObservedSkill = { status: string; toolCallId: string; content: FullHash; hasFeedbackArtifact: boolean; taskHashMatches: boolean; resultHashMatches: boolean; outputEqualsFullFocusedResult: boolean; artifactSkillContentSha256: string; artifactSkillStableName: string; actualToolMessageName: string };
type PublicProof = { audit: { readOnly: boolean; modelRequestsSent: number }; run: { id: string; status: string }; persistedState: { stateRunMatchesRequestedRun: boolean; canonicalCurrentStudentTurnFound: boolean; callSkillCount: number; skillCalls: ObservedSkill[]; latestBatch: { singleFeedbackSuccess: boolean }; modelOutput: FullHash; finalAnswer: FullHash; modelOutputEqualsLastAnswer: boolean; pendingNextNodes: number } };
/** Compare full hashes from independently read matching Python state, never bounded tool summaries. */
export function validateAidtSkillExecutionProof(raw: unknown, expected: SkillExecutionExpectation) {
  const proof = raw as PublicProof, state = proof?.persistedState;
  if (proof?.audit?.readOnly !== true || proof.audit.modelRequestsSent !== 0 || proof?.run?.id !== expected.runId || proof.run.status !== "succeeded"
    || state?.stateRunMatchesRequestedRun !== true || state.canonicalCurrentStudentTurnFound !== true) throw new Error("AIDT_PROBE_ACTUAL_CURRENT_RUN_SCOPE_REQUIRED");
  const success = state.skillCalls?.filter(row => row.status === "success");
  if (state.callSkillCount !== 1 || success?.length !== 1 || !state.latestBatch?.singleFeedbackSuccess || state.pendingNextNodes !== 0) throw new Error("AIDT_PROBE_ONE_ACTUAL_SUCCESSFUL_CALL_SKILL_REQUIRED");
  const call = success[0]!;
  if (!call.toolCallId || call.actualToolMessageName !== "call_skill" || !call.hasFeedbackArtifact || !call.taskHashMatches || !call.resultHashMatches
    || call.artifactSkillStableName !== expected.skillStableName || call.artifactSkillContentSha256 !== expected.skillContentSha256) throw new Error("AIDT_PROBE_EXACT_EXECUTED_SKILL_BYTES_REQUIRED");
  const sha256 = createHash("sha256").update(expected.assistantText).digest("hex");
  if (!state.modelOutputEqualsLastAnswer || !call.outputEqualsFullFocusedResult || [call.content, state.modelOutput, state.finalAnswer].some(content => content?.present !== true || content.sha256 !== sha256 || content.chars !== expected.assistantText.length)) throw new Error("AIDT_PROBE_FULL_TOOLMESSAGE_MUST_EQUAL_DELIVERED_OUTPUT");
  return proof;
}
