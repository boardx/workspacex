import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Inject,NotFoundException,Param,ParseUUIDPipe,PayloadTooLargeException,Post,ServiceUnavailableException} from '@nestjs/common';
import {PortableImportRequest} from '@repo/contracts/whiteboard-portable';
import {PortableBoardService,WHITEBOARD_PORTABLE_SERVICE} from '../../application/whiteboard/portable-board';
import {CurrentPrincipal} from '../current-principal.decorator';
import type {Principal} from '../../domain/principal';
import {ZodBodyPipe} from '../pipes/zod-body.pipe';
function failure(error:unknown):never{const code=error&&typeof error==='object'&&'code' in error?String(error.code):'INVALID_UPLOAD',body={reasonCode:code};if(code==='NOT_FOUND')throw new NotFoundException(body);if(code==='FORBIDDEN')throw new ForbiddenException(body);if(code==='PAYLOAD_TOO_LARGE'||code==='IMAGE_TOO_LARGE')throw new PayloadTooLargeException(body);if(['STALE_EPOCH','STALE_HEAD','IDEMPOTENCY_CONFLICT','ARCHIVED'].includes(code))throw new ConflictException(body);if(['INTEGRITY_FAILED','DEPENDENCY_UNAVAILABLE','VALIDATOR_UNAVAILABLE'].includes(code))throw new ServiceUnavailableException(body);throw new BadRequestException(body);}
@Controller('whiteboards/:boardId/portable')
export class WhiteboardPortableController{
 constructor(@Inject(WHITEBOARD_PORTABLE_SERVICE)private readonly service:PortableBoardService){}
 @Post('export')async export(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string){try{return await this.service.export(p,boardId);}catch(error){failure(error);}}
 @Post('import')async import(@CurrentPrincipal()p:Principal,@Param('boardId',new ParseUUIDPipe())boardId:string,@Body(new ZodBodyPipe(PortableImportRequest))input:unknown){try{return await this.service.import(p,boardId,input);}catch(error){failure(error);}}
}
