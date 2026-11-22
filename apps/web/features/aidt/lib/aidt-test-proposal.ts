import { z } from "zod";
import { isAidtGreetingText } from "@repo/contracts/aidt-stages";
import { isAidtCandidateRequest } from "@repo/contracts/aidt-candidate-request";
import { isAidtReflectionConfirmed, readAidtQuestionSnapshot } from "./aidt-verification-loop";
import { isAidtTestGroupConfirmed, readAidtTestGroups, updateAidtTestGroup, type AidtTestGroup } from "./aidt-test-groups";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";

const RoundProposal = z.object({
  understandingChangeStatus: z.enum(["changed", "unchanged", "insufficient"]),
  afterTestBelief: z.string().trim().max(1200).optional(),
  understandingEvidence: z.string().trim().max(1200).optional(),
  unresolvedQuestions: z.string().trim().max(1000).optional(),
  returnStep: z.enum(["1", "2", "3", "4", "5", "undecided"]),
  returnReason: z.string().trim().min(1).max(1000),
  nextAction: z.string().trim().max(1000).optional(),
}).strict();
const Proposal = z.object({
  entityId: z.string().uuid(),
  task: z.string().trim().min(1).max(300),
  reflection: z.string().trim().min(1).max(400),
  participant: z.string().trim().max(80).optional(),
  situation: z.string().trim().max(300).optional(),
  sourceLocation: z.string().trim().max(180).optional(),
  said: z.string().trim().max(500).optional(),
  did: z.string().trim().max(500).optional(),
  interpretation: z.string().trim().max(500).optional(),
  evidenceGap: z.string().trim().max(400).optional(),
  decision: z.enum(["pending", "adopted", "declined"]).optional(),
  decisionReason: z.string().trim().max(350).optional(),
  round: RoundProposal.optional(),
}).strict();

export type AidtTestTurn = { id: string; role: string; content?: unknown };
export type AidtTestProposal = { messageId: string; result: z.infer<typeof Proposal> };

const Plan = Proposal.pick({ entityId: true, task: true, situation: true });
export type AidtTestPlanCandidate = z.infer<typeof Plan>;
export type AidtTestResultCandidate = z.infer<typeof Proposal>;

function parseCandidate<T>(content: string, entityId: string, fence: "aidt-test-plan" | "aidt-test-result", schema: z.ZodType<T & { entityId: string }>): T | null {
  const pattern = new RegExp("(?:^|\\r?\\n)```" + fence + "[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```(?=\\r?\\n|$)", "g");
  const blocks = [...content.matchAll(pattern)];
  if (blocks.length !== 1 || !blocks[0]?.[1] || blocks[0][1].length > 10000) return null;
  try { const parsed = schema.safeParse(JSON.parse(blocks[0][1])); return parsed.success && parsed.data.entityId === entityId ? parsed.data : null; } catch { return null; }
}
export const parseAidtTestPlanCandidate = (text: string, entityId: string) => parseCandidate<AidtTestPlanCandidate>(text, entityId, "aidt-test-plan", Plan);
export const parseAidtTestResultCandidate = (text: string, entityId: string) => parseCandidate<AidtTestResultCandidate>(text, entityId, "aidt-test-result", Proposal);

function readAidtTestBlock<T>(messages: readonly AidtTestTurn[], entityId: string, fence: "aidt-test-plan" | "aidt-test-result", schema: z.ZodType<T & { entityId: string }>) {
  const block = new RegExp("(?:^|\\r?\\n)```" + fence + "[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```(?=\\r?\\n|$)", "g");
  for (let index = messages.length - 1; index >= 0; index--) {
    const turn = messages[index]!;
    if (turn.role === "user") return null;
    if (turn.role !== "assistant" || typeof turn.content !== "string" || !turn.id || turn.id.length > 200) continue;
    const blocks = [...turn.content.matchAll(block)];
    if (blocks.length !== 1 || !blocks[0]?.[1] || blocks[0][1].length > 10000) return null;
    try {
      const parsed = schema.safeParse(JSON.parse(blocks[0][1]));
      return parsed.success && parsed.data.entityId === entityId ? { messageId: turn.id, result: parsed.data } : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function readAidtTestProposal(messages: readonly AidtTestTurn[], entityId: string): AidtTestProposal | null {
  const student = messages.findLast(turn => turn.role === "user");
  if (typeof student?.content === "string" && isAidtCandidateRequest(student.content, "test")) return null;
  return readAidtTestBlock(messages, entityId, "aidt-test-result", Proposal);
}

export function readAidtTestPlan(messages: readonly AidtTestTurn[], entityId: string) {
  const latestStudent = messages.findLast(turn => turn.role === "user");
  if (typeof latestStudent?.content === "string" && isAidtCandidateRequest(latestStudent.content, "test")) return null;
  if (typeof latestStudent?.content !== "string" || !latestStudent.content.trim() || isAidtGreetingText(latestStudent.content)) return null;
  return readAidtTestBlock(messages, entityId, "aidt-test-plan", Plan);
}

export function applyAidtTestPlan(draft: AidtUiStageDraft, plan: NonNullable<ReturnType<typeof readAidtTestPlan>>) {
  const group = readAidtTestGroups(draft.fields).find(item => item.id === plan.result.entityId);
  if (!group || group.archived || group.confirmedFromMessageId || group.planFromMessageId === plan.messageId) return draft;
  return updateAidtTestGroup(draft, { ...group, task: plan.result.task,
    situation: plan.result.situation ?? group.situation, planFromMessageId: plan.messageId });
}

export function aidtTestGroupFromProposal(group: AidtTestGroup, proposal: AidtTestProposal, sourceAccessible: boolean, observationAccessible = false): AidtTestGroup | null {
  const { entityId, round, ...fields } = proposal.result;
  if (group.id !== entityId || group.archived) return null;
  const next = { ...group, ...fields, afterTestBelief: round?.afterTestBelief,
    understandingChange: round?.understandingChangeStatus, confirmedFromMessageId: proposal.messageId };
  if (group.surveyResponseId) next.sourceLocation = group.sourceLocation;
  if (!sourceAccessible && (next.said.trim() || next.did.trim())) return null;
  // Surveys and reported interview statements cannot certify a witnessed action.
  if (next.did.trim() && !observationAccessible) return null;
  if (round && round.understandingChangeStatus !== "insufficient"
    && !(sourceAccessible && next.sourceLocation.trim() && (next.said.trim() || next.did.trim()))) return null;
  return isAidtTestGroupConfirmed(next) ? next : null;
}

export function confirmAidtTestProposal(draft: AidtUiStageDraft, proposal: AidtTestProposal, sourceAccessible: boolean, observationAccessible = false): AidtUiStageDraft {
  const current = readAidtTestGroups(draft.fields).find(group => group.id === proposal.result.entityId);
  const group = current && aidtTestGroupFromProposal(current, proposal, sourceAccessible, observationAccessible);
  if (!group) return draft;
  const next = updateAidtTestGroup(draft, group);
  if (next === draft) return draft;
  const round = proposal.result.round;
  const bound = readAidtQuestionSnapshot(next);
  if (!round || !bound || bound.sourceStageRevision !== group.stage5Revision || bound.prototypeDesignId !== group.designId
    || bound.prototypeVersionId !== group.versionId) return next;
  const { afterTestBelief = "", understandingEvidence = "", unresolvedQuestions = "", nextAction = "", ...required } = round;
  const withRound = { ...next, fields: { ...next.fields, ...required, afterTestBelief, understandingEvidence, unresolvedQuestions, nextAction, reflectionConfirmed: "true" } };
  return Object.keys(withRound.fields).length <= 100 && isAidtReflectionConfirmed(withRound) ? withRound : next;
}
