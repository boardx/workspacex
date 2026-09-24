import { z } from 'zod';
import { WhiteboardObjectId } from './whiteboard-document';
import { BoardRole } from './whiteboard';
import { operations as streamingOperations } from './streaming-transport';
export const WHITEBOARD_SYNC = { path: '/whiteboards/:boardId/sync', protocol: 'whiteboard.v1', bearerSubprotocolPrefix: streamingOperations.subscribeRunEvents.bearerSubprotocolPrefix, pendingUpdates: 200, pendingBytes: 8 * 1024 * 1024 } as const;
const base64 = z.string().max(16 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const epoch = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cursor = z.object({ x: z.number().finite(), y: z.number().finite() }).strict().nullable();
const selected = z.array(WhiteboardObjectId).max(200);
export const WhiteboardClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), stateVector: base64, clientNonce: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('update'), epoch, updateId: z.string().uuid(), update: base64 }).strict(),
  z.object({ type: z.literal('awareness'), cursor, selected }).strict(),
]);
export type WhiteboardClientMessage = z.infer<typeof WhiteboardClientMessage>;
export const WhiteboardPresence = z.object({ actorId: z.string().min(1).max(200), cursor, selected }).strict();
export const WhiteboardServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sync'), epoch, seq, update: base64, role: BoardRole, archived: z.boolean(), accessReceiptId: z.string().uuid(), clientNonce: z.string().uuid().optional(), connectionId: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('ack'), updateId: z.string().uuid(), seq }).strict(),
  z.object({ type: z.literal('update'), epoch, seq, update: base64 }).strict(),
  z.object({ type: z.literal('presence'), peers: z.array(WhiteboardPresence).max(500) }).strict(),
  z.object({ type: z.literal('error'), code: z.string().min(1).max(100) }).strict(),
]);
export type WhiteboardServerMessage = z.infer<typeof WhiteboardServerMessage>;
