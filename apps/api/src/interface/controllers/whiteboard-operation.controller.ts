import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import { WHITEBOARD_OPERATION_SERVICE, WhiteboardOperationError, type WhiteboardOperationService } from '../../application/whiteboard/operation-service';
import { WHITEBOARD_PROPOSAL_SERVICE, type WhiteboardProposalService } from '../../application/whiteboard/proposal-service';
import { WHITEBOARD_PRESENTATION_SERVICE, type WhiteboardPresentationService } from '../../application/whiteboard/presentation-service';
import { CurrentPrincipal } from '../current-principal.decorator';

/** Versioned public Board API. Service/API/AI callers use the same actor-bound operation envelope. */
@Controller('v1/whiteboards/:boardId')
export class WhiteboardOperationController {
  constructor(@Inject(WHITEBOARD_OPERATION_SERVICE)private readonly service:WhiteboardOperationService,@Inject(WHITEBOARD_PROPOSAL_SERVICE)private readonly proposals:WhiteboardProposalService,@Inject(WHITEBOARD_PRESENTATION_SERVICE)private readonly presentation:WhiteboardPresentationService){}
  @Post('operations')
  async execute(@CurrentPrincipal()principal:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Body()body:unknown){assertPrincipal(principal);try{return await this.service.execute(principal,boardId,body);}catch(error){this.rethrow(error);}}
  @Post('artifact-handoffs') async artifactHandoff(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Body()body:unknown){try{return await this.service.handoff(p,b,body);}catch(error){this.rethrow(error);}}
  @Get('events')
  async events(@CurrentPrincipal()principal:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Query('afterSeq')afterSeq?:string,@Query('limit')limit?:string){assertPrincipal(principal);try{return await this.service.events(principal,boardId,{afterSeq:afterSeq===undefined?0:Number(afterSeq),limit:limit===undefined?100:Number(limit)});}catch(error){this.rethrow(error);}}
  @Get('head') async head(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string){try{return await this.service.head(p,b);}catch(error){this.rethrow(error);}}
  @Post('ai-proposals') async createProposal(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Body()body:unknown){try{return await this.proposals.create(p,b,body);}catch(error){this.rethrow(error);}}
  @Get('ai-proposals/:proposalId') async readProposal(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Param('proposalId',new ParseUUIDPipe())id:string){try{return await this.proposals.read(p,b,id);}catch(error){this.rethrow(error);}}
  @Post('ai-proposals/:proposalId/cancel') async cancelProposal(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Param('proposalId',new ParseUUIDPipe())id:string,@Body()body:unknown){try{return await this.proposals.cancel(p,b,id,body);}catch(error){this.rethrow(error);}}
  @Post('ai-proposals/:proposalId/confirm') async confirmProposal(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Param('proposalId',new ParseUUIDPipe())id:string,@Body()body:unknown){try{return await this.proposals.confirm(p,b,id,body);}catch(error){this.rethrow(error);}}
  @Post('rooms/join') async joinRoom(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Body()body:unknown){try{return await this.presentation.join(p,b,body);}catch(error){this.rethrow(error);}}
  @Get('presentation') async readPresentation(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Query('roomId')roomId:string){try{return await this.presentation.read(p,b,roomId);}catch(error){this.rethrow(error);}}
  @Post('presentation') async updatePresentation(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())b:string,@Body()body:unknown){try{return await this.presentation.dispatch(p,b,body);}catch(error){this.rethrow(error);}}
  private rethrow(error:unknown):never{if(error instanceof WhiteboardOperationError){if(error.code==='FORBIDDEN')throw new ForbiddenException();if(error.code==='NOT_FOUND')throw new NotFoundException();if(error.code==='DEPENDENCY_UNAVAILABLE')throw new ServiceUnavailableException();if(error.code==='RATE_LIMITED')throw new HttpException('RATE_LIMITED',HttpStatus.TOO_MANY_REQUESTS);if(error.code==='STALE_REVISION'||error.code==='IDEMPOTENCY_CONFLICT'||error.code==='ARCHIVED')throw new ConflictException(error.code);throw new BadRequestException();}if(error instanceof Error&&error.name==='ZodError')throw new BadRequestException();throw error;}
}
