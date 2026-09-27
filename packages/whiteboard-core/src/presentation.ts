import { WhiteboardPresentationCommand, WhiteboardPresentationState, type WhiteboardOperationActor, type WhiteboardPresentationState as PresentationStateValue } from '@repo/contracts/whiteboard-operation';

export type PresentationState = PresentationStateValue;
export class WhiteboardPresentationSession {
  private state: PresentationState;
  constructor(initial: unknown, private readonly canPresent: (actor: WhiteboardOperationActor) => boolean, private readonly now: () => string = () => new Date().toISOString()) {
    this.state = WhiteboardPresentationState.parse(initial);
  }
  read(): PresentationState { return structuredClone(this.state); }
  dispatch(untrusted: unknown, actor: WhiteboardOperationActor): PresentationState {
    const command = WhiteboardPresentationCommand.parse(untrusted);
    if (command.actorId !== actor.actorId || command.expectedRevision !== this.state.revision) throw new Error('BOARD_PRESENTATION_CONFLICT');
    const followers = new Set(this.state.followers);
    if (command.type === 'claim-presenter') {
      if (!actor.scopes.includes('board:present') || !this.canPresent(actor)) throw new Error('BOARD_PRESENTATION_FORBIDDEN');
      if (this.state.presenterId && this.state.presenterId !== actor.actorId) throw new Error('BOARD_PRESENTER_BUSY');
      this.state.presenterId = actor.actorId;
    } else if (command.type === 'release-presenter') {
      if (this.state.presenterId !== actor.actorId) throw new Error('BOARD_PRESENTATION_FORBIDDEN'); this.state.presenterId = null; followers.clear();
    } else if (command.type === 'follow') {
      if (!this.state.presenterId) throw new Error('BOARD_PRESENTER_MISSING'); followers.add(actor.actorId);
    } else if (command.type === 'leave-follow') followers.delete(actor.actorId);
    else if (command.type === 'viewport') {
      if (this.state.presenterId !== actor.actorId) throw new Error('BOARD_PRESENTATION_FORBIDDEN'); this.state.viewport = command.viewport;
    } else if (command.type === 'handoff') {
      if (this.state.presenterId !== actor.actorId || !actor.scopes.includes('board:present')) throw new Error('BOARD_PRESENTATION_FORBIDDEN');
      this.state.presenterId = command.toActorId; followers.delete(command.toActorId);
    }
    this.state.followers = [...followers]; this.state.revision += 1; this.state.updatedAt = this.now();
    return this.read();
  }
}
