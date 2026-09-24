import { z } from 'zod';
import { WhiteboardCommandBatch } from './whiteboard-document';
export const CreateProposal = z.object({
  requestId:z.string().uuid(), title:z.string().trim().min(1).max(200),
  baseEpoch:z.number().int().positive().max(2147483647), baseSeq:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  commands:WhiteboardCommandBatch,
  /** Display-only caller assertion; never an authenticated agent identity. */
  generatorLabel:z.string().trim().min(1).max(200).optional(),
}).strict();
export type CreateProposal=z.infer<typeof CreateProposal>;
export const DecideProposal=z.object({requestId:z.string().uuid()}).strict();
export type DecideProposal=z.infer<typeof DecideProposal>;
export const Proposal=z.object({
  id:z.string().uuid(),title:z.string(),status:z.enum(['pending','applied','rejected','conflicted']),
  baseEpoch:z.number().int().positive().max(2147483647),baseSeq:z.number().int().nonnegative(),commands:WhiteboardCommandBatch,
  provenance:z.object({submittedBy:z.string(),generator:z.object({label:z.string(),verified:z.literal(false)}).strict().nullable()}).strict(),
  decidedBy:z.string().nullable(),createdAt:z.string().datetime(),decidedAt:z.string().datetime().nullable(),
  committedEpoch:z.number().int().positive().nullable(),committedSeq:z.number().int().positive().nullable(),
}).strict();
export type Proposal=z.infer<typeof Proposal>;
export const ProposalList=z.object({items:z.array(Proposal)}).strict();
const base='/whiteboards/:boardId/proposals';
export const operations={
  list:{method:'GET',path:base,out:ProposalList},create:{method:'POST',path:base,in:CreateProposal,out:Proposal},
  accept:{method:'POST',path:`${base}/:proposalId/accept`,in:DecideProposal,out:Proposal},
  reject:{method:'POST',path:`${base}/:proposalId/reject`,in:DecideProposal,out:Proposal},
} as const;
