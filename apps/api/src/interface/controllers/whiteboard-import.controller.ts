import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, PayloadTooLargeException, Post, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { whiteboardImport as C } from '@repo/contracts';
import { WHITEBOARD_IMPORT_SERVICE, WhiteboardImportError, type WhiteboardImportService } from '../../application/whiteboard/import-service';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

function failure(error:unknown):never{
  if(!(error instanceof WhiteboardImportError))throw error;const body={reasonCode:error.code};
  if(error.code==='NOT_FOUND')throw new NotFoundException(body);
  if(error.code==='FORBIDDEN')throw new ForbiddenException(body);
  if(error.code==='PAYLOAD_TOO_LARGE')throw new PayloadTooLargeException(body);
  if(['ARCHIVED','STALE_HEAD','IDEMPOTENCY_CONFLICT'].includes(error.code))throw new ConflictException(body);
  if(['DEPENDENCY_UNAVAILABLE','INTEGRITY_FAILED'].includes(error.code))throw new ServiceUnavailableException(body);
  if(['UNSUPPORTED_FORMAT','UNSAFE_ARCHIVE'].includes(error.code))throw new UnprocessableEntityException(body);
  throw new BadRequestException(body);
}
@Controller('whiteboards/:boardId/imports')
export class WhiteboardImportController{
  constructor(@Inject(WHITEBOARD_IMPORT_SERVICE)private readonly service:WhiteboardImportService){}
  @Post()async upload(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Body(new ZodBodyPipe(C.UploadWhiteboardImport))input:unknown){assertPrincipal(p);try{return await this.service.upload(p,boardId,input);}catch(error){failure(error);}}
  @Post(':importId/preflight')@HttpCode(200)async preflight(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Param('importId',new ParseUUIDPipe())importId:string,@Body(new ZodBodyPipe(C.WhiteboardImportAction))input:unknown){assertPrincipal(p);try{return await this.service.preflight(p,boardId,importId,input);}catch(error){failure(error);}}
  @Post(':importId/execute')@HttpCode(200)async execute(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Param('importId',new ParseUUIDPipe())importId:string,@Body(new ZodBodyPipe(C.ExecuteWhiteboardImport))input:unknown){assertPrincipal(p);try{return await this.service.execute(p,boardId,importId,input);}catch(error){failure(error);}}
  @Get(':importId')async status(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Param('importId',new ParseUUIDPipe())importId:string){assertPrincipal(p);try{return await this.service.getStatus(p,boardId,importId);}catch(error){failure(error);}}
  @Get(':importId/report')async report(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Param('importId',new ParseUUIDPipe())importId:string){assertPrincipal(p);try{return await this.service.getReport(p,boardId,importId);}catch(error){failure(error);}}
}
