import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpException, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { whiteboard as C, whiteboardImport as I, whiteboardTransfer as T } from '@repo/contracts';
import { whiteboardDiscussion as D } from '@repo/contracts';
import { WHITEBOARD_REPOSITORY, type WhiteboardRepository, type CreateBoard, type UpdateBoard, type Member } from '../../application/whiteboard/ports';
import { WHITEBOARD_DISCUSSION, type WhiteboardDiscussion } from '../../application/whiteboard/discussion-ports';
import { WHITEBOARD_COLLABORATION_STORE, WhiteboardCollaborationError, type WhiteboardCollaborationStore } from '../../application/whiteboard/collaboration-ports';
import { importChatDiagram, ImportChatDiagramError } from '../../application/whiteboard/import-chat-diagram';
import { CHAT_REPOSITORY, type ChatRepository } from '../../application/chat/ports';
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from '../../application/identity/ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';
import { WHITEBOARD_TRANSFER_STORE, WhiteboardTransferError, type WhiteboardTransferStore } from '../../application/whiteboard/transfer-ports';

function transferFailure(error: unknown): never {
  if (!(error instanceof WhiteboardTransferError)) throw error;
  if (error.code === 'NOT_FOUND') throw new NotFoundException();
  if (error.code === 'FORBIDDEN' || error.code === 'ARCHIVED') throw new ForbiddenException('Whiteboard operation is not allowed');
  if (error.code === 'IDEMPOTENCY_CONFLICT') throw new ConflictException('Request identifier was already used');
  throw new BadRequestException('Portable board package is invalid');
}

/** PrincipalGuard applies globally. Inaccessible boards have the same response as missing boards. */
@Controller('whiteboards')
export class WhiteboardController {
  constructor(
    @Inject(WHITEBOARD_REPOSITORY) private readonly repo: WhiteboardRepository,
    @Inject(WHITEBOARD_DISCUSSION) private readonly discussion: WhiteboardDiscussion,
    @Inject(WHITEBOARD_COLLABORATION_STORE) private readonly collaboration: WhiteboardCollaborationStore,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisionIds: DecisionIdFactory,
    @Inject(WHITEBOARD_TRANSFER_STORE) private readonly transfer: WhiteboardTransferStore,
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
  private found<T>(value:T|null):T { if(!value)throw new NotFoundException(); return value; }
  private async discussionWrite<T>(value:Promise<T|null>):Promise<T>{try{return this.found(await value);}catch(error){if(error instanceof WhiteboardCollaborationError&&error.code==='IDEMPOTENCY_CONFLICT')throw new ConflictException('IDEMPOTENCY_CONFLICT');throw error;}}
  @Get(':boardId/threads') async threads(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Query('cursor') cursor?:string){assertPrincipal(p);return this.found(await this.discussion.list(p,boardId,D.ListThreads.parse(cursor?{cursor}:{}).cursor));}
  @Post(':boardId/threads') async createThread(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Body(new ZodBodyPipe(D.CreateThread)) input:unknown){assertPrincipal(p);return this.discussionWrite(this.discussion.create(p,boardId,D.CreateThread.parse(input)));}
  @Post(':boardId/threads/:threadId/comments') async reply(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('threadId',new ParseUUIDPipe()) threadId:string,@Body(new ZodBodyPipe(D.Reply)) input:unknown){assertPrincipal(p);return this.discussionWrite(this.discussion.reply(p,boardId,threadId,D.Reply.parse(input)));}
  @Patch(':boardId/comments/:commentId') async editComment(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('commentId',new ParseUUIDPipe()) commentId:string,@Body(new ZodBodyPipe(D.EditComment)) input:unknown){assertPrincipal(p);return this.found(await this.discussion.edit(p,boardId,commentId,D.EditComment.parse(input)));}
  @Delete(':boardId/comments/:commentId') async deleteComment(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('commentId',new ParseUUIDPipe()) commentId:string){assertPrincipal(p);return this.found(await this.discussion.delete(p,boardId,commentId));}
  @Patch(':boardId/threads/:threadId') async resolveThread(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('threadId',new ParseUUIDPipe()) threadId:string,@Body(new ZodBodyPipe(D.ResolveThread)) input:unknown){assertPrincipal(p);return this.found(await this.discussion.resolve(p,boardId,threadId,D.ResolveThread.parse(input)));}
  @Post(':boardId/threads/:threadId/task') async createTask(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('threadId',new ParseUUIDPipe()) threadId:string,@Body(new ZodBodyPipe(D.UpsertTask)) input:unknown){assertPrincipal(p);return this.discussionWrite(this.discussion.createTask(p,boardId,threadId,D.UpsertTask.parse(input)));}
  @Patch(':boardId/tasks/:taskId') async updateTask(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('taskId',new ParseUUIDPipe()) taskId:string,@Body(new ZodBodyPipe(D.UpdateTask)) input:unknown){assertPrincipal(p);return this.found(await this.discussion.updateTask(p,boardId,taskId,D.UpdateTask.parse(input)));}
  @Get(':boardId/export')
  async exportBoard(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); try {
      const bundle=await this.transfer.exportBoard(p,id);
      return new StreamableFile(Buffer.from(JSON.stringify(bundle)), { type:'application/json; charset=utf-8', disposition:'attachment; filename="board.workspacex-board.json"' });
    } catch (error) { transferFailure(error); }
  }
  @Post('imports/preview')
  async previewImport(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(T.ImportBoardInput)) input: T.ImportBoardInput) {
    assertPrincipal(p); try { return await this.transfer.previewImport(p,input); } catch (error) { transferFailure(error); }
  }
  @Post('imports')
  async importBoard(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(T.ImportBoardInput)) input: T.ImportBoardInput) {
    assertPrincipal(p); try { return await this.transfer.importBoard(p,input); } catch (error) { transferFailure(error); }
  }
}
