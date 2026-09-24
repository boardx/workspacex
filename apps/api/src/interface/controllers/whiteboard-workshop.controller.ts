import { Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import * as C from '@repo/contracts/whiteboard-workshop';
import { WHITEBOARD_WORKSHOP, WorkshopConflict, type WorkshopConflictCode, type WhiteboardWorkshop } from '../../application/whiteboard/workshop-ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

const WORKSHOP_CONFLICT_MESSAGE = 'Workshop action conflicts with the current state.';

function safeWorkshopConflictCode(error: WorkshopConflict): WorkshopConflictCode {
  switch (error.code) {
    case 'OBJECT_NOT_FOUND': return 'OBJECT_NOT_FOUND';
    case 'REQUEST_ID_REUSED': return 'REQUEST_ID_REUSED';
    case 'COMMENT_LIMIT': return 'COMMENT_LIMIT';
    case 'DRAFT_REVISION_CHANGED': return 'DRAFT_REVISION_CHANGED';
    case 'DRAFT_EMPTY': return 'DRAFT_EMPTY';
    case 'VOTE_SESSION_LIMIT': return 'VOTE_SESSION_LIMIT';
    case 'VOTE_CLOSED': return 'VOTE_CLOSED';
    case 'VOTE_TARGET_INVALID': return 'VOTE_TARGET_INVALID';
    case 'VOTE_QUOTA_EXCEEDED': return 'VOTE_QUOTA_EXCEEDED';
    default: return 'WORKSHOP_CONFLICT';
  }
}

/** Global PrincipalGuard applies. No API accepts a caller-supplied actor/user ID. */
@Controller('whiteboards/:boardId/workshop')
export class WhiteboardWorkshopController {
  constructor(@Inject(WHITEBOARD_WORKSHOP) private readonly workshop:WhiteboardWorkshop) {}
  private async result<T>(p:Principal,action:()=>Promise<T|null|false>):Promise<T>{
    assertPrincipal(p);
    try{const value=await action();if(value===null||value===false)throw new NotFoundException();return value;}
    catch(error){if(error instanceof WorkshopConflict)throw new ConflictException({reasonCode:safeWorkshopConflictCode(error),message:WORKSHOP_CONFLICT_MESSAGE});throw error;}
  }
  @Get('comments')
  async comments(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string){return {items:await this.result(p,()=>this.workshop.comments(p,b))};}
  @Post('comments')
  addComment(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string,@Body(new ZodBodyPipe(C.CreateComment)) input:C.CreateComment){return this.result(p,()=>this.workshop.addComment(p,b,input));}
  @Delete('comments/:commentId')
  async deleteComment(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string,@Param('commentId',new ParseUUIDPipe()) id:string){await this.result(p,()=>this.workshop.deleteComment(p,b,id));return {ok:true};}
  @Get('draft')
  draft(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string){return this.result(p,()=>this.workshop.draft(p,b));}
  @Put('draft')
  saveDraft(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string,@Body(new ZodBodyPipe(C.SavePrivateDraft)) input:C.SavePrivateDraft){return this.result(p,()=>this.workshop.saveDraft(p,b,input));}
  @Post('draft/publish')
  publishDraft(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string,@Body(new ZodBodyPipe(C.PublishDraft)) input:C.PublishDraft){return this.result(p,()=>this.workshop.publishDraft(p,b,input));}
  @Get('votes')
  async votes(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string){return {items:await this.result(p,()=>this.workshop.votes(p,b))};}
  @Post('votes')
  createVote(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string,@Body(new ZodBodyPipe(C.CreateVote)) input:C.CreateVote){return this.result(p,()=>this.workshop.createVote(p,b,input));}
  @Post('votes/:voteId/ballots')
  castVote(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string,@Param('voteId',new ParseUUIDPipe()) id:string,@Body(new ZodBodyPipe(C.CastVote)) input:C.CastVote){return this.result(p,()=>this.workshop.castVote(p,b,id,input));}
  @Post('votes/:voteId/close')
  closeVote(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string,@Param('voteId',new ParseUUIDPipe()) id:string){return this.result(p,()=>this.workshop.closeVote(p,b,id));}
  @Get('timer')
  timer(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string){return this.result(p,()=>this.workshop.timer(p,b));}
  @Put('timer')
  startTimer(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string,@Body(new ZodBodyPipe(C.StartTimer)) input:C.StartTimer){return this.result(p,()=>this.workshop.startTimer(p,b,input));}
  @Delete('timer')
  stopTimer(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) b:string){return this.result(p,()=>this.workshop.stopTimer(p,b));}
}
