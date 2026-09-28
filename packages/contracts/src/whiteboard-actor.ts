import { z } from 'zod';
import { BoardId } from './whiteboard';
import {
  WhiteboardEventCursor,
  WhiteboardEventPage,
  WhiteboardOperationRequest,
  WhiteboardOperationReceipt,
  WhiteboardOperationUndoRequest,
  WhiteboardObjectsSnapshot,
} from './whiteboard-operation';

export const WhiteboardActorId = z.string().uuid();
export const WhiteboardActorScope = z.enum(['board:read', 'board:write', 'board:present', 'artifact:read']);
export const WhiteboardServiceActor = z.object({
  actorId: WhiteboardActorId,
  boardId: BoardId,
  label: z.string().min(1).max(120),
  delegatedBy: z.string().min(1).max(200),
  scopes: z.array(WhiteboardActorScope).min(1).max(4),
  credentialPrefix: z.string().regex(/^wsxb_[a-zA-Z0-9_-]{8}$/),
  status: z.enum(['active', 'revoked', 'expired']),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
}).strict();
export type WhiteboardServiceActor = z.infer<typeof WhiteboardServiceActor>;

export const WhiteboardActorLifecycleEvent = z.object({
  eventId: z.string().uuid(),
  boardId: BoardId,
  actorId: WhiteboardActorId,
  type: z.enum(['ServiceActorCreated', 'ServiceActorRevoked']),
  delegatedBy: z.string().min(1).max(200),
  scopes: z.array(WhiteboardActorScope).min(1).max(4),
  occurredAt: z.string().datetime(),
}).strict();
export type WhiteboardActorLifecycleEvent = z.infer<typeof WhiteboardActorLifecycleEvent>;

export const WhiteboardServiceActorCreate = z.object({
  label: z.string().trim().min(1).max(120),
  scopes: z.array(WhiteboardActorScope).min(1).max(4),
  expiresInDays: z.number().int().min(1).max(365).default(90),
}).strict().superRefine((value, context) => {
  if (!value.scopes.includes('board:read')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Service actor requires board:read' });
  }
  if (new Set(value.scopes).size !== value.scopes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Service actor scopes must be unique' });
  }
});
export const WhiteboardServiceActorCreated = z.object({
  actor: WhiteboardServiceActor,
  /** Returned exactly once. Only its SHA-256 digest is persisted. */
  credential: z.string().regex(/^wsxb_[a-zA-Z0-9_-]{43}$/),
  auditEvent: WhiteboardActorLifecycleEvent,
}).strict();
export const WhiteboardServiceActorList = z.object({
  actors: z.array(WhiteboardServiceActor).max(100),
}).strict();
export const WhiteboardServiceActorRevoked = z.object({
  actor: WhiteboardServiceActor,
  auditEvent: WhiteboardActorLifecycleEvent,
}).strict();

/** Service credentials bind actor, organization and Board server-side; callers cannot spoof them. */
export const WhiteboardServiceOperationRequest = WhiteboardOperationRequest.omit({ boardId: true, actor: true }).superRefine((value, context) => {
  if (value.provenance.source !== 'public-api' || value.provenance.model !== null || value.provenance.skill !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Service operation provenance is server-bound public-api' });
  }
});
export const WhiteboardServiceEventCursor = WhiteboardEventCursor.omit({ actorId: true });

export const whiteboardActorOperations = {
  createServiceActor: { method: 'POST', path: '/v1/whiteboards/:boardId/actors/service', input: WhiteboardServiceActorCreate, output: WhiteboardServiceActorCreated },
  listServiceActors: { method: 'GET', path: '/v1/whiteboards/:boardId/actors/service', input: z.object({}).strict(), output: WhiteboardServiceActorList },
  revokeServiceActor: { method: 'DELETE', path: '/v1/whiteboards/:boardId/actors/service/:actorId', input: z.object({}).strict(), output: WhiteboardServiceActorRevoked },
  serviceReadObjects: { method: 'GET', path: '/v1/whiteboards/:boardId/service/objects', input: z.object({}).strict(), output: WhiteboardObjectsSnapshot },
  serviceExecute: { method: 'POST', path: '/v1/whiteboards/:boardId/service/operations', input: WhiteboardServiceOperationRequest, output: WhiteboardOperationReceipt },
  serviceUndo: { method: 'POST', path: '/v1/whiteboards/:boardId/service/operations/:operationId/undo', input: WhiteboardOperationUndoRequest, output: WhiteboardOperationReceipt },
  serviceEvents: { method: 'GET', path: '/v1/whiteboards/:boardId/service/events', input: WhiteboardServiceEventCursor, output: WhiteboardEventPage },
} as const;
