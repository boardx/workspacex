import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {DocumentParseInvocation} from '@repo/contracts/standard-document-tools';
import {STANDARD_DOCUMENT_SERVICE,type StandardDocumentService} from '../../application/agent-run/standard-document-tools';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class StandardDocumentToolsController {
 constructor(@Inject(STANDARD_DOCUMENT_SERVICE) private service:StandardDocumentService|null){}
 @Public() @Post('/internal/agent-runs/:runId/document/parse') @HttpCode(200)
 async parse(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=DocumentParseInvocation.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('document_parse_invalid_or_unsupported');
  if(!this.service)throw new ServiceUnavailableException('document_parse_unavailable');
  const {orgId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId,toolArgs}=parsed.data;
  try{return await this.service.parse({orgId:toOrgId(orgId),parentRunId:runId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId},toolArgs);}
  catch{throw new ServiceUnavailableException('document_parse_failed_no_result_confirmed');}
 }
}
