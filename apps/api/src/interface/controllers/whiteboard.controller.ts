import { Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { whiteboard as C } from '@repo/contracts';
import { whiteboardDiscussion as D } from '@repo/contracts';
import { WHITEBOARD_REPOSITORY, type WhiteboardRepository, type CreateBoard, type UpdateBoard, type Member } from '../../application/whiteboard/ports';
import { WHITEBOARD_DISCUSSION, type WhiteboardDiscussion } from '../../application/whiteboard/discussion-ports';
import { WhiteboardCollaborationError } from '../../application/whiteboard/collaboration-ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

/** PrincipalGuard applies globally. Inaccessible boards have the same response as missing boards. */
@Controller('whiteboards')
export class WhiteboardController {
  constructor(@Inject(WHITEBOARD_REPOSITORY) private readonly repo: WhiteboardRepository, @Inject(WHITEBOARD_DISCUSSION) private readonly discussion: WhiteboardDiscussion) {}
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
}
