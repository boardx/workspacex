import type { whiteboardRoom as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
import type {
  CreateRoomPairing,
  JoinRoom,
  PublishViewport,
  RoomCredential,
  WhiteboardRoomRepository,
} from './room-ports';

/** Application boundary for the meeting-room lifecycle. Keeping the controller
 * on this port makes the public credential flow explicit while the repository
 * retains the atomic transaction and tenant predicates. */
export class WhiteboardRoomAccess {
  constructor(private readonly rooms: WhiteboardRoomRepository) {}

  createPairing(principal: Principal, boardId: string, input: CreateRoomPairing) {
    return this.rooms.createPairing(principal, boardId, input);
  }
  pairingStatus(principal: Principal, boardId: string, pairingId: string) {
    return this.rooms.pairingStatus(principal, boardId, pairingId);
  }
  join(input: JoinRoom, source: string): Promise<C.RoomGrant> {
    return this.rooms.join(input, source);
  }
  read(sessionId: string, credential: RoomCredential): Promise<C.RoomState> {
    return this.rooms.read(sessionId, credential);
  }
  publishViewport(principal: Principal, boardId: string, sessionId: string, input: PublishViewport) {
    return this.rooms.publishViewport(principal, boardId, sessionId, input);
  }
  revoke(principal: Principal, boardId: string, sessionId: string) {
    return this.rooms.revoke(principal, boardId, sessionId);
  }
}
