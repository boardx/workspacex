import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpException, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { whiteboard as C, whiteboardImport as I } from '@repo/contracts';
import { WHITEBOARD_REPOSITORY, type WhiteboardRepository, type CreateBoard, type UpdateBoard, type Member } from '../../application/whiteboard/ports';
import { WHITEBOARD_COLLABORATION_STORE, WhiteboardCollaborationError, type WhiteboardCollaborationStore } from '../../application/whiteboard/collaboration-ports';
import { importChatDiagram, ImportChatDiagramError } from '../../application/whiteboard/import-chat-diagram';
import { CHAT_REPOSITORY, type ChatRepository } from '../../application/chat/ports';
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from '../../application/identity/ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

/** PrincipalGuard applies globally. Inaccessible boards have the same response as missing boards. */
@Controller('whiteboards')
export class WhiteboardController {
  constructor(
    @Inject(WHITEBOARD_REPOSITORY) private readonly repo: WhiteboardRepository,
    @Inject(WHITEBOARD_COLLABORATION_STORE) private readonly collaboration: WhiteboardCollaborationStore,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisionIds: DecisionIdFactory,
  ) {}
  @Get()
  async list(@CurrentPrincipal() p: Principal) { assertPrincipal(p); return { items: await this.repo.list(p) }; }
  @Post()
  async create(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(C.CreateBoard)) input: CreateBoard) {
    assertPrincipal(p); return this.repo.create(p,input);
  }
  @Get(':boardId')
  async get(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); const result=await this.repo.get(p,id); if (!result) throw new NotFoundException(); return result;
  }
  @Patch(':boardId')
  async update(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.UpdateBoard)) input: UpdateBoard) {
    assertPrincipal(p); const result=await this.repo.update(p,id,input); if (!result) throw new NotFoundException(); return result;
  }
  @Post(':boardId/import-diagram')
  async importDiagram(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(I.ImportDiagramInput)) input: I.ImportDiagramInput) {
    assertPrincipal(p);
    try {
      return await importChatDiagram({ boards: this.repo, collaboration: this.collaboration, chat: this.chat, repo: this.identity, ids: this.decisionIds }, p, id, input);
    } catch (error) {
      if (error instanceof ImportChatDiagramError) {
        if (error.code === 'NOT_FOUND') throw new NotFoundException();
        if (error.code === 'FORBIDDEN') throw new ForbiddenException();
        if (error.code === 'ARCHIVED' || error.code === 'SOURCE_CHANGED' || error.code === 'LOSS_CONSENT_REQUIRED') {
          throw new ConflictException({ reasonCode: error.code, losses: error.losses });
        }
        throw new HttpException({ reasonCode: error.code, losses: error.losses }, error.code === 'CAPACITY' ? 413 : 400);
      }
      if (error instanceof WhiteboardCollaborationError) {
        const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 :
          ['ARCHIVED','STALE_EPOCH','IDEMPOTENCY_CONFLICT'].includes(error.code) ? 409 :
          error.code === 'RATE_LIMITED' ? 429 : error.code === 'VALIDATOR_UNAVAILABLE' ? 503 : 400;
        throw new HttpException({ reasonCode: error.code }, status);
      }
      throw error;
    }
  }
  @Get(':boardId/members')
  async members(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); const items=await this.repo.members(p,id); if (!items) throw new NotFoundException(); return {items};
  }
  @Put(':boardId/members')
  async putMember(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.Member)) member: Member) {
    assertPrincipal(p); if (!await this.repo.putMember(p,id,member)) throw new NotFoundException(); return {ok:true};
  }
  @Delete(':boardId/members/:userId')
  async removeMember(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string, @Param('userId') userId: string) {
    assertPrincipal(p); if (!await this.repo.removeMember(p,id,userId)) throw new NotFoundException(); return {ok:true};
  }
}
