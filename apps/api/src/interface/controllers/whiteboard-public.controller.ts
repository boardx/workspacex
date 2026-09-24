import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpException, Inject, NotFoundException, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import * as C from '@repo/contracts/whiteboard-public';
import { WHITEBOARD_COLLABORATION_STORE, WHITEBOARD_UPDATE_VALIDATOR, WhiteboardCollaborationError, type WhiteboardCollaborationStore, type WhiteboardUpdateValidator } from '../../application/whiteboard/collaboration-ports';
import { applyWhiteboardCommands, readWhiteboardDocument } from '../../application/whiteboard/public-commands';
import type { Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';
/** Session PrincipalGuard remains mandatory; "public API" does not mean anonymous access. */
@Controller('whiteboards')
export class WhiteboardPublicController {
  constructor(@Inject(WHITEBOARD_COLLABORATION_STORE) private readonly boards: WhiteboardCollaborationStore,
    @Inject(WHITEBOARD_UPDATE_VALIDATOR) private readonly projection: WhiteboardUpdateValidator) {}
  @Get(':boardId/document')
  async document(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string) {
    return this.run(() => readWhiteboardDocument({ boards: this.boards, projection: this.projection }, p, boardId));
  }
  @Post(':boardId/commands')
  @HttpCode(200)
  async commands(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Body(new ZodBodyPipe(C.PublicWhiteboardCommands)) input: C.PublicWhiteboardCommands) {
    return this.run(() => applyWhiteboardCommands({ boards: this.boards }, p, boardId, input));
  }
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (!(error instanceof WhiteboardCollaborationError)) throw error;
      if (error.code === 'NOT_FOUND') throw new NotFoundException();
      if (error.code === 'FORBIDDEN') throw new ForbiddenException();
      if (error.code === 'VALIDATION_FAILED') throw new UnprocessableEntityException(error.code);
      if (error.code === 'VALIDATOR_UNAVAILABLE') throw new ServiceUnavailableException();
      if (error.code === 'RATE_LIMITED') throw new HttpException(error.code, 429);
      throw new ConflictException(error.code);
    }
  }
}
