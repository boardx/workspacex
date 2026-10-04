import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,BadRequestException,ForbiddenException} from '@nestjs/common';
import {ArtifactEmbeddingRequestStart,ArtifactEmbeddingRequestTerminal} from '@repo/contracts/artifact-embedding-accounting';
import {ArtifactEmbeddingOwnershipDenied,ARTIFACT_EMBEDDING_USAGE,type ArtifactEmbeddingUsagePort} from '../../application/retrieval/artifact-embedding-accounting';
import {toOrgId} from '../../domain/org-id';
import {z} from 'zod';
import {Public} from '../public.decorator';
@Controller()
export class ArtifactEmbeddingUsageController {
 constructor(@Inject(ARTIFACT_EMBEDDING_USAGE) private readonly usage:ArtifactEmbeddingUsagePort){}
 private authenticate(key:string|undefined){const expected=Buffer.from((process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??'').trim()),actual=Buffer.from(key??'');if(!expected.length||actual.length!==expected.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();}
 @Public() @Post('/internal/artifact-index/:operationId/model-requests/start') @HttpCode(200)
 async start(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('operationId') operationId:string,@Body() body:unknown){
  this.authenticate(key);if(!z.string().uuid().safeParse(operationId).success)throw new BadRequestException('invalid_operation');const parsed=ArtifactEmbeddingRequestStart.safeParse(body);if(!parsed.success)throw new BadRequestException('invalid_usage_receipt');
  const {orgId,...input}=parsed.data;try{await this.usage.start(toOrgId(orgId),operationId,input);}catch(error){if(error instanceof ArtifactEmbeddingOwnershipDenied)throw new ForbiddenException('artifact_accounting_ownership_denied');throw error;}return {accepted:true};
 }
 @Public() @Post('/internal/artifact-index/:operationId/model-requests/terminal') @HttpCode(200)
 async terminal(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('operationId') operationId:string,@Body() body:unknown){
  this.authenticate(key);if(!z.string().uuid().safeParse(operationId).success)throw new BadRequestException('invalid_operation');const parsed=ArtifactEmbeddingRequestTerminal.safeParse(body);if(!parsed.success)throw new BadRequestException('invalid_usage_receipt');
  const {orgId,...input}=parsed.data;try{await this.usage.terminal(toOrgId(orgId),operationId,input);}catch(error){if(error instanceof ArtifactEmbeddingOwnershipDenied)throw new ForbiddenException('artifact_accounting_ownership_denied');throw error;}return {accepted:true};
 }
}
