import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import { WHITEBOARD_OPERATION_SERVICE, WhiteboardOperationError, type WhiteboardOperationService } from '../../application/whiteboard/operation-service';
import { CurrentPrincipal } from '../current-principal.decorator';

/** Versioned public Board API. Service/API/AI callers use the same actor-bound operation envelope. */
@Controller('v1/whiteboards/:boardId')
export class WhiteboardOperationController {
  constructor(@Inject(WHITEBOARD_OPERATION_SERVICE)private readonly service:WhiteboardOperationService){}
  @Post('operations')
  async execute(@CurrentPrincipal()principal:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Body()body:unknown){assertPrincipal(principal);try{return await this.service.execute(principal,boardId,body);}catch(error){this.rethrow(error);}}
  @Get('events')
  async events(@CurrentPrincipal()principal:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Query('afterSeq')afterSeq?:string,@Query('limit')limit?:string){assertPrincipal(principal);try{return await this.service.events(principal,boardId,{afterSeq:afterSeq===undefined?0:Number(afterSeq),limit:limit===undefined?100:Number(limit)});}catch(error){this.rethrow(error);}}
  private rethrow(error:unknown):never{if(error instanceof WhiteboardOperationError){if(error.code==='FORBIDDEN')throw new ForbiddenException();if(error.code==='NOT_FOUND')throw new NotFoundException();if(error.code==='DEPENDENCY_UNAVAILABLE')throw new ServiceUnavailableException();if(error.code==='RATE_LIMITED')throw new HttpException('RATE_LIMITED',HttpStatus.TOO_MANY_REQUESTS);if(error.code==='STALE_REVISION'||error.code==='IDEMPOTENCY_CONFLICT'||error.code==='ARCHIVED')throw new ConflictException(error.code);throw new BadRequestException();}if(error instanceof Error&&error.name==='ZodError')throw new BadRequestException();throw error;}
}
