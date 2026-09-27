import { z } from 'zod';
import { BoardId, BoardRole } from './whiteboard';
import { WhiteboardCommand, WhiteboardObject, WhiteboardObjectId, WHITEBOARD_LIMITS } from './whiteboard-document';

export const WHITEBOARD_OPERATION_LIMITS = {
  commands: 200,
  events: 500,
  proposalObjects: 500,
  renderedObjects: 500,
  renderedBytes: 8 * 1024 * 1024,
  provenanceBytes: 16_384,
  eventPage: 500,
} as const;

const ActorId = z.string().min(1).max(200);
const Revision = z.object({ epoch: z.number().int().positive(), seq: z.number().int().nonnegative() }).strict();
/** Full canonical snapshot: bounded by the existing board object/document limits. */
export const WhiteboardObjectsQuery = z.object({ actorId: ActorId }).strict();
export const WhiteboardObjectsSnapshot = z.object({
  boardId: BoardId, revision: Revision, role: BoardRole, archived: z.boolean(),
  objects: z.array(WhiteboardObject).max(WHITEBOARD_LIMITS.objects),
}).strict();
export type WhiteboardObjectsSnapshot = z.infer<typeof WhiteboardObjectsSnapshot>;

export const WhiteboardOperationActor = z.object({
  kind: z.enum(['human', 'service', 'ai']),
  actorId: ActorId,
  orgId: z.string().min(1).max(200),
  role: BoardRole,
  scopes: z.array(z.enum(['board:read', 'board:write', 'board:present', 'artifact:read'])).max(8),
  delegatedBy: ActorId.nullable().default(null),
}).strict().superRefine((value,ctx)=>{
  if(value.kind==='human'&&value.delegatedBy!==null)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Human actor cannot be delegated'});
  if(value.kind!=='human'&&!value.delegatedBy)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Service and AI actors require a delegator'});
});
export type WhiteboardOperationActor = z.infer<typeof WhiteboardOperationActor>;

export const WhiteboardOperationProvenance = z.object({
  source: z.enum(['human', 'public-api', 'ai-proposal', 'chat-artifact', 'import']),
  model: z.string().max(200).nullable().default(null),
  skill: z.string().max(200).nullable().default(null),
  sourceArtifactId: z.string().max(200).nullable().default(null),
  sourceRevision: z.string().max(200).nullable().default(null),
  layoutHash: z.string().max(160).nullable().default(null),
  inputObjectIds: z.array(WhiteboardObjectId).max(WHITEBOARD_OPERATION_LIMITS.proposalObjects).default([]),
}).strict().superRefine((value, ctx) => {
  if(value.source==='ai-proposal'&&(!value.model||!value.skill))ctx.addIssue({code:z.ZodIssueCode.custom,message:'AI provenance requires model and skill'});
  if(value.source==='chat-artifact'&&(!value.sourceArtifactId||!value.sourceRevision||!value.layoutHash))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Artifact provenance is incomplete'});
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > WHITEBOARD_OPERATION_LIMITS.provenanceBytes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provenance exceeds byte limit' });
  }
});

export const WhiteboardOperationRequest = z.object({
  apiVersion: z.literal('2026-09-01'),
  requestId: z.string().uuid(),
  boardId: BoardId,
  expectedRevision: Revision,
  actor: WhiteboardOperationActor,
  commands: z.array(WhiteboardCommand).min(1).max(WHITEBOARD_OPERATION_LIMITS.commands),
  provenance: WhiteboardOperationProvenance,
}).strict();
export type WhiteboardOperationRequest = z.infer<typeof WhiteboardOperationRequest>;

export const WhiteboardEventType = z.enum([
  'ObjectCreated', 'ObjectMoved', 'ObjectResized', 'ObjectUpdated', 'ObjectDeleted',
  'ObjectsGrouped', 'ObjectsArranged', 'ConnectorCreated', 'PanelCreated', 'AIOrganized',
]);
export const WhiteboardOperationEvent = z.object({
  eventId: z.string().uuid(), operationId: z.string().uuid(), requestId: z.string().uuid(),
  boardId: BoardId, type: WhiteboardEventType, actor: WhiteboardOperationActor,
  objectIds: z.array(WhiteboardObjectId).max(WHITEBOARD_OPERATION_LIMITS.proposalObjects),
  revision: Revision, occurredAt: z.string().datetime(), provenance: WhiteboardOperationProvenance,
}).strict();
export type WhiteboardOperationEvent = z.infer<typeof WhiteboardOperationEvent>;
export const WhiteboardOperationReceipt = z.object({
  operationId: z.string().uuid(), requestId: z.string().uuid(), boardId: BoardId,
  revision: Revision, replayed: z.boolean(), events: z.array(WhiteboardOperationEvent).max(WHITEBOARD_OPERATION_LIMITS.events),
}).strict();
export type WhiteboardOperationReceipt = z.infer<typeof WhiteboardOperationReceipt>;
export const WhiteboardUndoReceipt = z.object({
  undoId:z.string().uuid(),operationId:z.string().uuid(),boardId:BoardId,expectedRevision:Revision,
  commands:z.array(WhiteboardCommand).min(1).max(WHITEBOARD_OPERATION_LIMITS.commands),createdAt:z.string().datetime(),
}).strict();
export type WhiteboardUndoReceipt=z.infer<typeof WhiteboardUndoReceipt>;
export const WhiteboardAIConfirmReceipt=WhiteboardOperationReceipt.extend({undoReceipt:WhiteboardUndoReceipt});

export const WhiteboardEventCursor = z.object({
  afterSeq: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(WHITEBOARD_OPERATION_LIMITS.eventPage).default(100),
}).strict();
export const WhiteboardEventPage = z.object({
  boardId: BoardId, events: z.array(WhiteboardOperationEvent).max(WHITEBOARD_OPERATION_LIMITS.eventPage),
  nextSeq: z.number().int().nonnegative(),
}).strict();

const LayoutGeometry = z.object({
  x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(),
  height: z.number().finite().positive(), rotation: z.number().finite(),
}).strict();
const RenderedStyle=z.record(z.union([z.string().max(2048),z.number().finite(),z.boolean(),z.null()])).refine(value=>Object.keys(value).length<=100,'Too many style fields');
export const RenderedDiagramObject = z.object({
  sourceId: z.string().min(1).max(200),
  kind: z.enum(['node', 'edge', 'group', 'image', 'unknown']),
  geometry: LayoutGeometry,
  text: z.string().max(20_000),
  style: RenderedStyle,
  fromSourceId: z.string().max(200).nullable().default(null),
  toSourceId: z.string().max(200).nullable().default(null),
}).strict().superRefine((value,ctx)=>{
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>WHITEBOARD_OPERATION_LIMITS.renderedBytes)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Rendered layout exceeds byte limit'});
});
export const RenderedDiagramLayout = z.object({
  schemaVersion: z.literal(1), artifactId: z.string().min(1).max(200),
  orgId: z.string().min(1).max(200), sourceRevision: z.string().min(1).max(200),
  diagramKind: z.enum(['flowchart', 'sequence', 'persona', 'fabric', 'artifact']),
  objects: z.array(RenderedDiagramObject).min(1).max(WHITEBOARD_OPERATION_LIMITS.renderedObjects),
  selectedSourceIds: z.array(z.string().min(1).max(200)).max(WHITEBOARD_OPERATION_LIMITS.renderedObjects).default([]),
  layoutHash: z.string().regex(/^layout-v1:[a-f0-9]{64}$/),
}).strict();
export type RenderedDiagramLayout = z.infer<typeof RenderedDiagramLayout>;
export const WhiteboardArtifactHandoff = z.object({
  requestId:z.string().uuid(),expectedRevision:Revision,layout:RenderedDiagramLayout,
  offset:z.object({x:z.number().finite(),y:z.number().finite()}).strict(),
}).strict();

export const WhiteboardAIProposalAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('generate'), commands: z.array(WhiteboardCommand).min(1).max(WHITEBOARD_OPERATION_LIMITS.commands) }).strict(),
  z.object({ type: z.literal('cluster'), objectIds: z.array(WhiteboardObjectId).min(1).max(WHITEBOARD_OPERATION_LIMITS.proposalObjects), labels: z.array(z.string().min(1).max(200)).min(1).max(100), commands: z.array(WhiteboardCommand).min(1).max(WHITEBOARD_OPERATION_LIMITS.commands) }).strict(),
  z.object({ type: z.literal('label'), objectIds: z.array(WhiteboardObjectId).min(1).max(WHITEBOARD_OPERATION_LIMITS.proposalObjects), label: z.string().min(1).max(200), commands: z.array(WhiteboardCommand).min(1).max(WHITEBOARD_OPERATION_LIMITS.commands) }).strict(),
  z.object({ type: z.literal('arrange'), objectIds: z.array(WhiteboardObjectId).min(1).max(WHITEBOARD_OPERATION_LIMITS.proposalObjects), layout: z.enum(['grid', 'row', 'column', 'cluster', 'flow']), commands: z.array(WhiteboardCommand).min(1).max(WHITEBOARD_OPERATION_LIMITS.commands) }).strict(),
  z.object({ type: z.literal('connect'), objectIds: z.array(WhiteboardObjectId).min(2).max(WHITEBOARD_OPERATION_LIMITS.proposalObjects), commands: z.array(WhiteboardCommand).min(1).max(WHITEBOARD_OPERATION_LIMITS.commands) }).strict(),
]);
export const WhiteboardAIProposal = z.object({
  proposalId: z.string().uuid(), boardId: BoardId, createdBy: WhiteboardOperationActor,
  baseRevision: Revision, baseObjectDigests: z.record(z.string().regex(/^object-v1:[a-f0-9]{64}$/)),
  action: WhiteboardAIProposalAction, provenance: WhiteboardOperationProvenance,
  status: z.enum(['preview', 'cancelled', 'confirmed']), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  undoReceipt:WhiteboardUndoReceipt.nullable().optional(),
}).strict();
export type WhiteboardAIProposal = z.infer<typeof WhiteboardAIProposal>;
export const WhiteboardAIProposalCreate = z.object({
  proposalId: z.string().uuid(), actorId: ActorId, baseRevision: Revision,
  action: WhiteboardAIProposalAction,
  provenance: WhiteboardOperationProvenance,
}).strict();
export const WhiteboardAIProposalDecision = z.object({
  requestId: z.string().uuid(), expectedRevision: Revision,
}).strict();

export const WhiteboardViewport = z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().min(.05).max(8) }).strict();
export const WhiteboardPresentationState = z.object({
  boardId: BoardId, roomId: z.string().min(1).max(200), revision: z.number().int().nonnegative(),
  presenterId: ActorId.nullable(), viewport: WhiteboardViewport, followers: z.array(ActorId).max(500),
  updatedAt: z.string().datetime(),
}).strict();
export type WhiteboardPresentationState = z.infer<typeof WhiteboardPresentationState>;
export const WhiteboardPresentationCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claim-presenter'), actorId: ActorId, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('release-presenter'), actorId: ActorId, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('follow'), actorId: ActorId, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('leave-follow'), actorId: ActorId, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('viewport'), actorId: ActorId, viewport: WhiteboardViewport, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('handoff'), actorId: ActorId, toActorId: ActorId, expectedRevision: z.number().int().nonnegative() }).strict(),
]);
export type WhiteboardPresentationCommand = z.infer<typeof WhiteboardPresentationCommand>;
export const WhiteboardPresentationRequest = z.object({
  roomId: z.string().min(1).max(200), reconnectToken: z.string().min(32).max(512).nullable().default(null), command: WhiteboardPresentationCommand,
}).strict();
export const WhiteboardRoomJoin = z.object({
  roomId: z.string().min(1).max(200), deviceId: z.string().min(1).max(200),
  deviceKind: z.enum(['personal','meeting-display']), reconnectToken: z.string().min(32).max(512).nullable().default(null),
}).strict();
export const WhiteboardRoomIdentity = z.object({
  roomId: z.string().min(1).max(200), actorId: ActorId, deviceId: z.string().min(1).max(200),
  deviceKind: z.enum(['personal','meeting-display']), reconnectToken: z.string().min(32).max(512),
  connectionRevision: z.number().int().positive(),
}).strict();
export const WhiteboardPointerCapability = z.object({
  pointerType: z.enum(['mouse', 'touch', 'pen']), pressure: z.number().min(0).max(1),
  tiltX: z.number().min(-90).max(90).default(0), tiltY: z.number().min(-90).max(90).default(0),
  roomIdentity: z.string().min(1).max(200).nullable().default(null), reconnectToken: z.string().min(16).max(512).nullable().default(null),
}).strict();
export type WhiteboardPointerCapability = z.infer<typeof WhiteboardPointerCapability>;

/** Transport metadata derives from the same schemas; adapters only substitute path parameters. */
export const whiteboardOperationOperations = {
  readObjects: { method: 'GET', path: '/v1/whiteboards/:boardId/objects', input: WhiteboardObjectsQuery, output: WhiteboardObjectsSnapshot },
  execute: { method: 'POST', path: '/v1/whiteboards/:boardId/operations', input: WhiteboardOperationRequest, output: WhiteboardOperationReceipt },
  events: { method: 'GET', path: '/v1/whiteboards/:boardId/events', input: WhiteboardEventCursor, output: WhiteboardEventPage },
  createProposal: { method: 'POST', path: '/v1/whiteboards/:boardId/ai-proposals', input: WhiteboardAIProposalCreate, output: WhiteboardAIProposal },
  cancelProposal: { method: 'POST', path: '/v1/whiteboards/:boardId/ai-proposals/:proposalId/cancel', input: WhiteboardAIProposalDecision, output: WhiteboardAIProposal },
  confirmProposal: { method: 'POST', path: '/v1/whiteboards/:boardId/ai-proposals/:proposalId/confirm', input: WhiteboardAIProposalDecision, output: WhiteboardAIConfirmReceipt },
  presentation: { method: 'POST', path: '/v1/whiteboards/:boardId/presentation', input: WhiteboardPresentationRequest, output: WhiteboardPresentationState },
  joinRoom: { method: 'POST', path: '/v1/whiteboards/:boardId/rooms/join', input: WhiteboardRoomJoin, output: WhiteboardRoomIdentity },
  artifactHandoff: { method: 'POST', path: '/v1/whiteboards/:boardId/artifact-handoffs', input: WhiteboardArtifactHandoff, output: WhiteboardOperationReceipt },
} as const;
