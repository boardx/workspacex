import { z } from 'zod';
import { BoardId } from './whiteboard';

export const RoomId = z.string().uuid();
const OrgId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const RoomViewport = z.object({ x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000), zoom: z.number().finite().min(0.05).max(8), revision: z.number().int().nonnegative() }).strict();
export const CreatePairing = z.object({ requestId: z.string().uuid() }).strict();
export const Pairing = z.object({
  id: RoomId, boardId: BoardId, code: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/),
  payload: z.string().min(1).max(2_000), expiresAt: z.string().datetime(),
}).strict();
export type Pairing = z.infer<typeof Pairing>;
export const PairingStatus = z.object({ sessionId: RoomId.nullable(), joined: z.boolean(), expiresAt: z.string().datetime() }).strict();
export const JoinRoom = z.object({ orgId: OrgId, pairingId: RoomId, code: z.string().trim().min(1).max(32) }).strict();
export const RoomGrant = z.object({
  orgId: OrgId, sessionId: RoomId, token: z.string().min(40).max(200),
  boardId: BoardId, boardName: z.string().min(1).max(200), expiresAt: z.string().datetime(), role: z.literal('room-viewer'),
}).strict();
export type RoomGrant = z.infer<typeof RoomGrant>;
export const RoomCredential = z.object({ orgId: OrgId, token: z.string().min(40).max(200) }).strict();
export const RoomState = z.object({
  boardId: BoardId, boardName: z.string().min(1).max(200), snapshot: z.string().max(45_000_000),
  epoch: z.number().int().nonnegative(), seq: z.number().int().nonnegative(), viewport: RoomViewport.nullable(),
  expiresAt: z.string().datetime(),
}).strict();
export type RoomState = z.infer<typeof RoomState>;
export type RoomViewport = z.infer<typeof RoomViewport>;
export const PublishViewport = RoomViewport.omit({ revision: true });

export const operations = {
  createPairing: { method: 'POST', path: '/whiteboards/:boardId/room-pairings', in: CreatePairing, out: Pairing },
  pairingStatus: { method: 'POST', path: '/whiteboards/:boardId/room-pairings/:pairingId/status', in: z.object({}).strict(), out: PairingStatus },
  joinRoom: { method: 'POST', path: '/whiteboard-room/join', in: JoinRoom, out: RoomGrant },
  readRoom: { method: 'POST', path: '/whiteboard-room/:sessionId/state', in: RoomCredential, out: RoomState },
  publishViewport: { method: 'PUT', path: '/whiteboards/:boardId/room-sessions/:sessionId/viewport', in: PublishViewport, out: RoomViewport },
  revokeRoom: { method: 'DELETE', path: '/whiteboards/:boardId/room-sessions/:sessionId', in: z.object({}).strict(), out: z.object({ ok: z.literal(true) }).strict() },
} as const;
