import {
  BadRequestException, ForbiddenException, ServiceUnavailableException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { whiteboard as C } from '@repo/contracts';
import {
  DUPLICATE_BOARD_SERVICE,
  WHITEBOARD_REPOSITORY,
  WHITEBOARD_TAG_REPOSITORY,
  WhiteboardResourceError,
  type CreateBoard,
  type CreateBoardTag,
  type DeleteBoard,
  type DeleteBoardTag,
  type DuplicateBoard,
  type DuplicateBoardService,
  type ListBoards,
  type Member,
  type RenameBoardTag,
  type UpdateBoard,
  type WhiteboardRepository,
  type WhiteboardTagRepository,
} from '../../application/whiteboard/ports';
import { WhiteboardCommentCommand, whiteboardCollaborationOperations as Collaboration } from '@repo/contracts/whiteboard-collaboration';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import { WHITEBOARD_COLLABORATION_STORE, WHITEBOARD_COMMENT_STORE, WHITEBOARD_RECOVERY_SERVICE, WhiteboardCollaborationError, type WhiteboardCollaborationStore, type WhiteboardCommentStore } from '../../application/whiteboard/collaboration-ports';
import { WhiteboardRecoveryError, WhiteboardRecoveryService } from '../../application/whiteboard/recovery-service';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

function resourceError(error: unknown): never {
  if (error instanceof WhiteboardResourceError) {
    if (error.code === 'NOT_FOUND' || error.code === 'TAG_NOT_FOUND') throw new NotFoundException({reasonCode:error.code});
    throw new ConflictException({reasonCode:error.code});
  }
  throw error;
}
function parseListQuery(raw: Record<string,string|string[]|undefined>): ListBoards {
  const tagIds = raw.tagIds === undefined ? undefined : Array.isArray(raw.tagIds) ? raw.tagIds : [raw.tagIds];
  return new ZodBodyPipe(C.ListBoards).transform({...raw,tagIds}) as ListBoards;
}

/** PrincipalGuard applies globally. Inaccessible boards share missing-resource responses. */
@Controller('whiteboards')
export class WhiteboardController {
  constructor(@Inject(DUPLICATE_BOARD_SERVICE) private readonly duplicates: DuplicateBoardService,
    @Inject(WHITEBOARD_REPOSITORY) private readonly repo: WhiteboardRepository,
    @Inject(WHITEBOARD_COLLABORATION_STORE) private readonly collaboration: WhiteboardCollaborationStore,
    @Inject(WHITEBOARD_COMMENT_STORE) private readonly comments: WhiteboardCommentStore,
    @Inject(WHITEBOARD_RECOVERY_SERVICE) private readonly recovery: WhiteboardRecoveryService) {}
  private collaborationError(error:unknown):never { if(error instanceof WhiteboardCollaborationError||error instanceof WhiteboardRecoveryError){if(error.code==='NOT_FOUND')throw new NotFoundException();if(error.code==='FORBIDDEN'||error.code==='ARCHIVED')throw new ForbiddenException();if(error.code==='IDEMPOTENCY_CONFLICT'||error.code==='COMMENT_CONFLICT'||error.code==='STALE_HEAD'||error.code==='STALE_EPOCH')throw new ConflictException(error.code);if(error.code==='INVALID_MENTION'||error.code==='VALIDATION_FAILED')throw new BadRequestException(error.code);}throw new ServiceUnavailableException(); }
  @Get()
  async list(@CurrentPrincipal() p: Principal, @Query() raw: Record<string,string|string[]|undefined>) {
    assertPrincipal(p); try { return await this.repo.list(p,parseListQuery(raw)); } catch (error) { resourceError(error); }
  }
  @Post()
  async create(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(C.CreateBoard)) input: CreateBoard) {
    assertPrincipal(p); return this.repo.create(p,input);
  }
  @Get(':boardId')
  async get(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); const result=await this.repo.get(p,id); if (!result) throw new NotFoundException(); return result;
  }
  @Patch(':boardId')
  async update(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.UpdateBoard)) input: UpdateBoard) {
    assertPrincipal(p); try { const result=await this.repo.update(p,id,input); if (!result) throw new NotFoundException(); return result; }
    catch (error) { resourceError(error); }
  }
  @Post(':boardId/duplicates')
  async duplicate(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.DuplicateBoard)) input: DuplicateBoard) {
    assertPrincipal(p); try { return await this.duplicates.duplicate(p,id,input); } catch (error) { resourceError(error); }
  }
  @Delete(':boardId')
  async delete(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.DeleteBoard)) input: DeleteBoard) {
    assertPrincipal(p); try { const result=await this.repo.permanentlyDelete(p,id,input); if (!result) throw new NotFoundException(); return result; }
    catch (error) { resourceError(error); }
  }
  @Get(':boardId/members')
  async members(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); const items=await this.repo.members(p,id); if (!items) throw new NotFoundException(); return {items};
  }
  @Put(':boardId/members')
  async putMember(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.Member)) member: Member) {
    assertPrincipal(p); if (!await this.repo.putMember(p,id,member)) throw new NotFoundException(); return {ok:true};
  }
  @Delete(':boardId/members/:userId')
  async removeMember(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string, @Param('userId') userId: string) {
    assertPrincipal(p); if (!await this.repo.removeMember(p,id,userId)) throw new NotFoundException(); return {ok:true};
  }
  @Get(':boardId/comments')
  async listComments(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) id:string){assertPrincipal(p);try{return{items:await this.comments.list(p,id)};}catch(error){this.collaborationError(error);}}
  @Post(':boardId/comments/commands')
  async dispatchComment(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) id:string,@Body(new ZodBodyPipe(WhiteboardCommentCommand)) command:unknown){assertPrincipal(p);try{return await this.comments.dispatch(p,id,WhiteboardCommentCommand.parse(command));}catch(error){this.collaborationError(error);}}
  @Post(':boardId/commands')
  async dispatchCommands(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) id:string,@Body(new ZodBodyPipe(Collaboration.dispatchCommands.in)) body:{requestId:string;epoch:number;commands:unknown[]}){assertPrincipal(p);try{const ack=await this.collaboration.writeCommands(p,id,{requestId:body.requestId,epoch:body.epoch,commands:WhiteboardCommandBatch.parse(body.commands)});return{epoch:ack.epoch,seq:ack.seq,updateId:ack.updateId,replayed:ack.replayed};}catch(error){this.collaborationError(error);}}
  @Post(':boardId/checkpoints')
  async createCheckpoint(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) id:string,@Body(new ZodBodyPipe(Collaboration.createCheckpoint.in)) body:{requestId:string}){assertPrincipal(p);try{return await this.recovery.createCheckpoint(p,id,body.requestId);}catch(error){this.collaborationError(error);}}
  @Post(':boardId/checkpoints/:checkpointId/restore')
  async restoreCheckpoint(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) id:string,@Param('checkpointId',new ParseUUIDPipe()) checkpointId:string,@Body(new ZodBodyPipe(Collaboration.restoreCheckpoint.in)) body:{requestId:string;expectedEpoch:number;expectedSeq:number}){assertPrincipal(p);try{return await this.recovery.restore(p,id,checkpointId,body.requestId,{epoch:body.expectedEpoch,seq:body.expectedSeq});}catch(error){this.collaborationError(error);}}
}

@Controller('whiteboard-tags')
export class WhiteboardTagController {
  constructor(@Inject(WHITEBOARD_TAG_REPOSITORY) private readonly tags: WhiteboardTagRepository) {}
  @Get()
  async list(@CurrentPrincipal() p: Principal) { assertPrincipal(p); return {items:await this.tags.listTags(p)}; }
  @Post()
  async create(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(C.CreateBoardTag)) input: CreateBoardTag) {
    assertPrincipal(p); try { return await this.tags.createTag(p,input); } catch (error) { resourceError(error); }
  }
  @Patch(':tagId')
  async rename(@CurrentPrincipal() p: Principal, @Param('tagId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.RenameBoardTag)) input: RenameBoardTag) {
    assertPrincipal(p); try { const result=await this.tags.renameTag(p,id,input); if (!result) throw new NotFoundException(); return result; }
    catch (error) { resourceError(error); }
  }
  @Delete(':tagId')
  async delete(@CurrentPrincipal() p: Principal, @Param('tagId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.DeleteBoardTag)) input: DeleteBoardTag) {
    assertPrincipal(p); try { const result=await this.tags.deleteTag(p,id,input); if (!result) throw new NotFoundException(); return result; }
    catch (error) { resourceError(error); }
  }
}
