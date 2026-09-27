import { z } from 'zod';
import { WhiteboardObjectId } from './whiteboard-document';
import { BoardRole } from './whiteboard';
import { operations as streamingOperations } from './streaming-transport';
import { WHITEBOARD_COLLABORATION_LIMITS, WhiteboardRecoveryCode, WhiteboardResumeDisposition } from './whiteboard-collaboration';
import { WhiteboardPointerCapability } from './whiteboard-operation';
const inboundUpdateBytes = 64 * 1024;
const persistedUpdateBytes = 1024 * 1024;
const stateVectorBytes = 8 * 1024;
// Existing storage admits 32 MiB snapshots. A real 5,000-minimal-object Yjs
// v1 snapshot is ~1 MiB, leaving ample measured headroom without fragmentation.
const documentBytes = 32 * 1024 * 1024;
const inboundUpdateBase64Characters = 4 * Math.ceil(inboundUpdateBytes / 3);
const stateVectorBase64Characters = 4 * Math.ceil(stateVectorBytes / 3);
const documentBase64Characters = 4 * Math.ceil(documentBytes / 3);
const inboundFrameBytes = 96 * 1024;
const outboundDocumentFrameBytes = 48 * 1024 * 1024;
export const WHITEBOARD_SYNC = {
  path: '/whiteboards/:boardId/sync', protocol: 'whiteboard.v1',
  bearerSubprotocolPrefix: streamingOperations.subscribeRunEvents.bearerSubprotocolPrefix,
  pendingUpdates: 200, pendingBytes: 8 * 1024 * 1024,
  inboundUpdateBytes, inboundUpdateBase64Characters, persistedUpdateBytes,
  stateVectorBytes, stateVectorBase64Characters,
  documentBytes, documentBase64Characters, inboundFrameBytes, outboundDocumentFrameBytes,
} as const;
const boundedBase64 = (maximum: number) => z.string().superRefine((value, ctx) => {
  if (value.length > maximum) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Base64 payload exceeds budget' }); return; }
  if (value.length % 4 !== 0) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid base64 length' }); return; }
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 61) end--;
  if (value.length - end > 2) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid base64 padding' }); return; }
  for (let index = 0; index < end; index++) {
    const code = value.charCodeAt(index);
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 43 || code === 47)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid base64 character' }); return;
    }
  }
});
const stateVectorBase64 = boundedBase64(WHITEBOARD_SYNC.stateVectorBase64Characters);
const updateBase64 = boundedBase64(WHITEBOARD_SYNC.inboundUpdateBase64Characters);
const documentBase64 = boundedBase64(WHITEBOARD_SYNC.documentBase64Characters);
const epoch = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cursor = z.object({ x: z.number().finite().min(-1000000).max(1000000), y: z.number().finite().min(-1000000).max(1000000) }).strict().nullable();
const selected = z.array(WhiteboardObjectId).max(WHITEBOARD_COLLABORATION_LIMITS.selectionIds).superRefine((value,ctx)=>{if(new Set(value).size!==value.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate selection id'});});
const editingObjectId = WhiteboardObjectId.nullable();
const contributorColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const WhiteboardClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), stateVector: stateVectorBase64, resume: z.object({ epoch, seq }).strict().optional() }).strict(),
  z.object({ type: z.literal('update'), epoch, updateId: z.string().uuid(), update: updateBase64 }).strict(),
  z.object({ type: z.literal('awareness'), cursor, selected, editingObjectId: editingObjectId.optional(), pointer: WhiteboardPointerCapability.nullable().optional() }).strict(),
]);
export type WhiteboardClientMessage = z.infer<typeof WhiteboardClientMessage>;
export const WhiteboardPresence = z.object({
  actorId: z.string().min(1).max(200), displayName: z.string().min(1).max(WHITEBOARD_COLLABORATION_LIMITS.displayNameChars),
  contributorColor, cursor, selected, editingObjectId, pointer: WhiteboardPointerCapability.nullable().optional(), expiresAt: z.string().datetime(),
}).strict();
export const WhiteboardServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sync'), epoch, seq, update: documentBase64, role: BoardRole, archived: z.boolean() }).strict(),
  z.object({ type: z.literal('ack'), updateId: z.string().uuid(), seq }).strict(),
  z.object({ type: z.literal('update'), epoch, seq, update: documentBase64 }).strict(),
  z.object({ type: z.literal('presence'), peers: z.array(WhiteboardPresence).max(500) }).strict(),
  z.object({ type: z.literal('recovery'), code: WhiteboardRecoveryCode, disposition: WhiteboardResumeDisposition, epoch: epoch.optional(), seq: seq.optional() }).strict(),
  z.object({ type: z.literal('error'), code: WhiteboardRecoveryCode.exclude(['RESUME_OK']).or(z.enum(['PROTOCOL_ERROR', 'HELLO_REQUIRED', 'FORBIDDEN', 'VALIDATION_FAILED', 'VALIDATOR_UNAVAILABLE', 'IDEMPOTENCY_CONFLICT', 'RATE_LIMITED'])), recoverable: z.boolean() }).strict(),
]);
export type WhiteboardServerMessage = z.infer<typeof WhiteboardServerMessage>;
