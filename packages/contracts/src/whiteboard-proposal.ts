import { z } from 'zod';
import { WHITEBOARD_LIMITS, WhiteboardCommandBatch } from './whiteboard-document';

export const WHITEBOARD_PROPOSAL_LIMITS = {
  commands: WHITEBOARD_LIMITS.batch,
  proposalsPerDecision: 100,
} as const;

export const CreateProposal = z.object({
  requestId:z.string().uuid(), title:z.string().trim().min(1).max(200),
  baseEpoch:z.number().int().positive().max(2147483647), baseSeq:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  commands:WhiteboardCommandBatch,
}).strict();
export type CreateProposal=z.infer<typeof CreateProposal>;
/** Internal calls carry only routing scope; identity is resolved from the durable run. */
export const CreateAgentProposal = CreateProposal.extend({orgId:z.string().min(1).max(256)}).strict();
export type CreateAgentProposal=z.infer<typeof CreateAgentProposal>;

export const DecideProposal=z.object({requestId:z.string().uuid()}).strict();
export type DecideProposal=z.infer<typeof DecideProposal>;
export const ProposalCommandDecision=z.object({
  status:z.enum(['pending','applied','rejected']),
  decidedBy:z.string().nullable(), decidedAt:z.string().datetime().nullable(), requestId:z.string().uuid().nullable(),
  committedEpoch:z.number().int().positive().nullable(), committedSeq:z.number().int().positive().nullable(),
}).strict();

const ApiParticipant=z.object({kind:z.literal('human-api'),actorId:z.string(),verified:z.literal(true)}).strict();
const AgentParticipant=z.object({
  kind:z.literal('agent'),verified:z.literal(true),agentId:z.string(),agentName:z.string(),agentVersionId:z.string(),
  runId:z.string(),provider:z.string(),model:z.string(),modelVersion:z.string(),
}).strict();
const ProposalSource=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('api')}).strict(),
  z.object({kind:z.literal('agent-run'),ref:z.string().min(1)}).strict(),
]);
export const Proposal=z.object({
  id:z.string().uuid(),title:z.string(),status:z.enum(['pending','applied','rejected','conflicted']),
  baseEpoch:z.number().int().positive().max(2147483647),baseSeq:z.number().int().nonnegative(),commands:WhiteboardCommandBatch,
  commandDecisions:z.array(ProposalCommandDecision).min(1).max(WHITEBOARD_PROPOSAL_LIMITS.commands),
  provenance:z.object({submittedBy:z.string(),actor:z.object({kind:z.literal('human'),id:z.string()}).strict(),source:ProposalSource,
    createdAt:z.string().datetime(),participant:z.discriminatedUnion('kind',[ApiParticipant,AgentParticipant])}).strict(),
  decidedBy:z.string().nullable(),createdAt:z.string().datetime(),decidedAt:z.string().datetime().nullable(),
  committedEpoch:z.number().int().positive().nullable(),committedSeq:z.number().int().positive().nullable(),
}).strict().superRefine((proposal,context)=>{
  if(proposal.commandDecisions.length!==proposal.commands.length)context.addIssue({code:z.ZodIssueCode.custom,path:['commandDecisions'],message:'one decision is required per command'});
  if(proposal.provenance.actor.id!==proposal.provenance.submittedBy||proposal.provenance.createdAt!==proposal.createdAt)context.addIssue({code:z.ZodIssueCode.custom,path:['provenance'],message:'provenance actor/time must match the durable proposal'});
  if(proposal.provenance.participant.kind==='agent'&&(proposal.provenance.source.kind!=='agent-run'||proposal.provenance.source.ref!==proposal.provenance.participant.runId))context.addIssue({code:z.ZodIssueCode.custom,path:['provenance','source'],message:'agent source must match its durable run'});
  if(proposal.provenance.participant.kind==='human-api'&&proposal.provenance.source.kind!=='api')context.addIssue({code:z.ZodIssueCode.custom,path:['provenance','source'],message:'human/API proposals must use the API source'});
  if(proposal.provenance.participant.kind==='human-api'&&proposal.provenance.participant.actorId!==proposal.provenance.actor.id)context.addIssue({code:z.ZodIssueCode.custom,path:['provenance','participant','actorId'],message:'API participant must match the authenticated actor'});
});
export type Proposal=z.infer<typeof Proposal>;
export const ProposalList=z.object({items:z.array(Proposal)}).strict();

export const ProposalSelection=z.object({
  proposalId:z.string().uuid(),
  commandIndexes:z.array(z.number().int().nonnegative().max(WHITEBOARD_PROPOSAL_LIMITS.commands-1)).min(1).max(WHITEBOARD_PROPOSAL_LIMITS.commands),
}).strict().superRefine((selection,context)=>{
  if(new Set(selection.commandIndexes).size!==selection.commandIndexes.length)context.addIssue({code:z.ZodIssueCode.custom,path:['commandIndexes'],message:'command indexes must be unique'});
});
export const BatchDecision=z.object({
  requestId:z.string().uuid(),action:z.enum(['accept','reject']),
  selections:z.array(ProposalSelection).min(1).max(WHITEBOARD_PROPOSAL_LIMITS.proposalsPerDecision),
}).strict().superRefine((decision,context)=>{
  if(new Set(decision.selections.map(item=>item.proposalId)).size!==decision.selections.length)context.addIssue({code:z.ZodIssueCode.custom,path:['selections'],message:'proposal ids must be unique'});
  if(decision.selections.reduce((total,item)=>total+item.commandIndexes.length,0)>WHITEBOARD_PROPOSAL_LIMITS.commands)context.addIssue({code:z.ZodIssueCode.custom,path:['selections'],message:'selected commands exceed the shared batch limit'});
});
export type BatchDecision=z.infer<typeof BatchDecision>;
export const BatchDecisionResult=z.object({proposals:z.array(Proposal).min(1).max(WHITEBOARD_PROPOSAL_LIMITS.proposalsPerDecision)}).strict();
export type BatchDecisionResult=z.infer<typeof BatchDecisionResult>;

const base='/whiteboards/:boardId/proposals';
export const operations={
  list:{method:'GET',path:base,out:ProposalList},create:{method:'POST',path:base,in:CreateProposal,out:Proposal},
  accept:{method:'POST',path:`${base}/:proposalId/accept`,in:DecideProposal,out:Proposal},
  reject:{method:'POST',path:`${base}/:proposalId/reject`,in:DecideProposal,out:Proposal},
  batchDecide:{method:'POST',path:`${base}/decisions`,in:BatchDecision,out:BatchDecisionResult},
  createFromAgentRun:{method:'POST',path:'/internal/agent-runs/:runId/whiteboards/:boardId/proposals',in:CreateAgentProposal,out:Proposal},
} as const;
