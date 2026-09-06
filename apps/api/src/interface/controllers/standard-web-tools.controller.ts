import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,BadRequestException,UnauthorizedException,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {StandardWebInvocation} from '@repo/contracts/standard-web-tools';
import {STANDARD_WEB_SERVICE,type StandardWebService} from '../../application/agent-run/standard-web-tools';
import {TOOL_EXECUTION_AUTHORITY,type ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import {IDENTITY_REPOSITORY,type IdentityRepository} from '../../application/identity/ports';
import {isLocalOrg} from '../../domain/identity/local-org';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class StandardWebToolsController {
 constructor(@Inject(STANDARD_WEB_SERVICE) private service:StandardWebService,
 @Inject(TOOL_EXECUTION_AUTHORITY) private authority:ToolExecutionAuthority,
 @Inject(IDENTITY_REPOSITORY) private identities:IdentityRepository){}
 @Public() @Post('/internal/agent-runs/:runId/standard-web/invoke') @HttpCode(200)
 async invoke(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=StandardWebInvocation.safeParse(body);if(!parsed.success)throw new BadRequestException('standard_web_invalid_or_unsupported_input');
  const input=parsed.data,orgId=toOrgId(input.orgId);
  const decision=await this.authority.check({...input,orgId,parentRunId:runId});
  if(!decision.allowed)throw new ForbiddenException('standard_web_authority_denied');
  const org=await this.identities.findOrganization(orgId);
  if(!org||isLocalOrg(org.kind))throw new ForbiddenException('standard_web_egress_denied');
  try{return input.toolName==='web_search'?await this.service.search(input.toolArgs):await this.service.fetch(input.toolArgs);}
  catch{throw new ServiceUnavailableException('standard_web_unavailable_or_refused');}
 }
}
