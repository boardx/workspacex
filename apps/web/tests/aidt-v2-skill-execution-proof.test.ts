import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validateAidtSkillExecutionProof, type SkillExecutionExpectation } from "../e2e/support/aidt-v2-skill-execution-proof";
const expected: SkillExecutionExpectation = { runId: "new-run", threadId: "thread", inputMessageId: "new-human", selectedSkillVersionId: "exact-1.3.2", skillStableName: "aidt-understand", skillContentSha256: "a".repeat(64), assistantText: "保留完整Skill回复，不截断。你们的问题来自什么？" };
const full = { present: true, chars: expected.assistantText.length, sha256: createHash("sha256").update(expected.assistantText).digest("hex") };
const call = { status: "success", toolCallId: "actual-call", actualToolMessageName: "call_skill", hasFeedbackArtifact: true, taskHashMatches: true, resultHashMatches: true, outputEqualsFullFocusedResult: true, artifactSkillContentSha256: expected.skillContentSha256, artifactSkillStableName: "aidt-understand", content: full };
const state = { stateRunMatchesRequestedRun: true, canonicalCurrentStudentTurnFound: true, callSkillCount: 1, skillCalls: [call], latestBatch: { singleFeedbackSuccess: true }, modelOutput: full, finalAnswer: full, modelOutputEqualsLastAnswer: true, pendingNextNodes: 0 };
const proof = { audit: { readOnly: true, modelRequestsSent: 0 }, run: { id: expected.runId, status: "succeeded" }, persistedState: state };
it("requires actual current-run execution and exact Skill bytes rather than a mount alone", () => {
  expect(() => validateAidtSkillExecutionProof(proof, expected)).not.toThrow();
  for (const wrong of [{ callSkillCount: 0 }, { callSkillCount: 2 }, { stateRunMatchesRequestedRun: false }, { skillCalls: [{ ...call, status: "error" }] }, { skillCalls: [{ ...call, artifactSkillContentSha256: "b".repeat(64) }] }]) expect(() => validateAidtSkillExecutionProof({ ...proof, persistedState: { ...state, ...wrong } }, expected)).toThrow();
  expect(() => validateAidtSkillExecutionProof({ ...proof, run: { id: "old-run", status: "succeeded" } }, expected)).toThrow("CURRENT_RUN_SCOPE");
});
it("rejects bounded summary hashes, different final output, missing artifacts or unresolved nodes", () => {
  for (const wrong of [{ modelOutput: { ...full, chars: 10 } }, { finalAnswer: { ...full, sha256: "0".repeat(64) } }, { modelOutputEqualsLastAnswer: false }, { pendingNextNodes: 1 }, { skillCalls: [{ ...call, resultHashMatches: false }] }]) expect(() => validateAidtSkillExecutionProof({ ...proof, persistedState: { ...state, ...wrong } }, expected)).toThrow();
});
