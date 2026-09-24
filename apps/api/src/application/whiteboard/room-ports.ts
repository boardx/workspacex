import type { z } from 'zod';
import type { whiteboardRoom as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';

export const WHITEBOARD_ROOM_REPOSITORY = Symbol('WhiteboardRoomRepository');
export type CreateRoomPairing = z.infer<typeof C.CreatePairing>;
export type JoinRoom = z.infer<typeof C.JoinRoom>;
export type RoomCredential = z.infer<typeof C.RoomCredential>;
export type PublishViewport = z.infer<typeof C.PublishViewport>;
export class WhiteboardRoomError extends Error {
  constructor(readonly code: 'not_found'|'rate_limited') { super(code); }
}
export interface WhiteboardRoomRepository {
  createPairing(principal: Principal, boardId: string, input: CreateRoomPairing): Promise<C.Pairing>;
  pairingStatus(principal: Principal, boardId: string, pairingId: string): Promise<z.infer<typeof C.PairingStatus>>;
  join(input: JoinRoom, source: string): Promise<C.RoomGrant>;
  read(sessionId: string, credential: RoomCredential): Promise<C.RoomState>;
  publishViewport(principal: Principal, boardId: string, sessionId: string, input: PublishViewport): Promise<C.RoomViewport>;
  revoke(principal: Principal, boardId: string, sessionId: string): Promise<boolean>;
}
