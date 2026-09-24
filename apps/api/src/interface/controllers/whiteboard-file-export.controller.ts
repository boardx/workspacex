import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpException, Inject, NotFoundException, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import { whiteboardFileExport as C } from '@repo/contracts';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';
import { WHITEBOARD_FILE_EXPORT_SERVICE, WhiteboardFileExportError, type WhiteboardFileExportService } from '../../application/whiteboard/file-export-ports';

function fail(error:unknown):never{
  if(!(error instanceof WhiteboardFileExportError))throw error;
  if(error.code==='NOT_FOUND')throw new NotFoundException();
  if(error.code==='FORBIDDEN')throw new ForbiddenException();
  if(error.code==='NOT_READY')throw new ConflictException({reasonCode:'EXPORT_NOT_READY'});
  if(error.code==='BOUNDS_EXCEEDED')throw new HttpException({reasonCode:'EXPORT_BOUNDS_EXCEEDED'},413);
  throw new BadRequestException({reasonCode:'INVALID_EXPORT_REQUEST'});
}

@Controller()
export class WhiteboardFileExportController {
  constructor(@Inject(WHITEBOARD_FILE_EXPORT_SERVICE)private readonly exports:WhiteboardFileExportService){}

  @Post('whiteboards/:boardId/file-exports')
  async create(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Body(new ZodBodyPipe(C.BoardFileExportInput))input:C.BoardFileExportInput){assertPrincipal(p);try{return await this.exports.create(p,boardId,input);}catch(error){fail(error);}}

  @Get('whiteboard-file-exports/:jobId')
  async status(@CurrentPrincipal()p:Principal,@Param('jobId',new ParseUUIDPipe())jobId:string){assertPrincipal(p);try{return await this.exports.status(p,jobId);}catch(error){fail(error);}}

  @Delete('whiteboard-file-exports/:jobId')
  async cancel(@CurrentPrincipal()p:Principal,@Param('jobId',new ParseUUIDPipe())jobId:string){assertPrincipal(p);try{return await this.exports.cancel(p,jobId);}catch(error){fail(error);}}

  @Get('whiteboard-file-exports/:jobId/content')
  async content(@CurrentPrincipal()p:Principal,@Param('jobId',new ParseUUIDPipe())jobId:string){assertPrincipal(p);try{const file=await this.exports.content(p,jobId);return new StreamableFile(Buffer.from(file.bytes),{type:file.mimeType,disposition:`attachment; filename="board.${file.filename.split('.').pop()??'bin'}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`});}catch(error){fail(error);}}
}
