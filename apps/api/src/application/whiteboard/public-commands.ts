import * as C from '@repo/contracts/whiteboard-public';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import type { WhiteboardCollaborationStore, WhiteboardUpdateValidator } from './collaboration-ports';
export interface PublicWhiteboardDeps { boards: WhiteboardCollaborationStore; projection: Pick<WhiteboardUpdateValidator, 'objects'>; }
/** Normal board read permission includes viewers; export authorization is a separate policy. */
export async function readWhiteboardDocument(deps: PublicWhiteboardDeps, p: Principal, boardId: string): Promise<C.PublicWhiteboardDocument> {
  assertPrincipal(p);
  const state = await deps.boards.load(p, boardId);
  const objects = await deps.projection.objects(state.update);
  return C.PublicWhiteboardDocument.parse({ boardId, epoch: state.epoch, seq: state.seq, role: state.role, archived: state.archived, objects });
}
/** Must run outside an enclosing transaction: the store's returned result confirms COMMIT. */
export async function applyWhiteboardCommands(deps: Pick<PublicWhiteboardDeps, 'boards'>, p: Principal, boardId: string, input: C.PublicWhiteboardCommands): Promise<C.PublicWhiteboardCommandResult> {
  assertPrincipal(p);
  const accepted = await deps.boards.writeCommands(p, boardId, C.PublicWhiteboardCommands.parse(input));
  return C.PublicWhiteboardCommandResult.parse({ boardId, epoch: accepted.epoch, seq: accepted.seq, requestId: accepted.updateId, replayed: accepted.replayed, durable: true });
}
