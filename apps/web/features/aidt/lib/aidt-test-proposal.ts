import { z } from "zod";
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

export function readAidtTestProposal(messages: readonly AidtTestTurn[], entityId: string): AidtTestProposal | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const turn = messages[index]!;
    if (turn.role === "user") return null;
    if (turn.role !== "assistant" || typeof turn.content !== "string" || !turn.id || turn.id.length > 200) continue;
    const blocks = [...turn.content.matchAll(/(?:^|\r?\n)```aidt-test-result[ \t]*\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/g)];
    if (blocks.length !== 1 || !blocks[0]?.[1] || blocks[0][1].length > 10000) return null;
    try {
      const parsed = Proposal.safeParse(JSON.parse(blocks[0][1]));
      return parsed.success && parsed.data.entityId === entityId ? { messageId: turn.id, result: parsed.data } : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function aidtTestGroupFromProposal(group: AidtTestGroup, proposal: AidtTestProposal, sourceAccessible: boolean): AidtTestGroup | null {
  const { entityId, round: _round, ...fields } = proposal.result;
  if (group.id !== entityId || group.archived) return null;
  const next = { ...group, ...fields, confirmedFromMessageId: proposal.messageId };
  if (!sourceAccessible && (next.said.trim() || next.did.trim())) return null;
  return isAidtTestGroupConfirmed(next) ? next : null;
}

export function confirmAidtTestProposal(draft: AidtUiStageDraft, proposal: AidtTestProposal, sourceAccessible: boolean): AidtUiStageDraft {
  const current = readAidtTestGroups(draft.fields).find(group => group.id === proposal.result.entityId);
  const group = current && aidtTestGroupFromProposal(current, proposal, sourceAccessible);
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
