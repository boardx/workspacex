import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,BadRequestException,UnauthorizedException,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {StandardContextInvocation} from '@repo/contracts/standard-context-tools';
import {STANDARD_CONTEXT_SERVICE,StandardContextService} from '../../application/agent-run/standard-context-tools';
import {TOOL_EXECUTION_AUTHORITY,type ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import {AGENT_RUN_STORE,type AgentRunStore} from '../../application/agent-run/ports';
import {IDENTITY_REPOSITORY,DECISION_ID_FACTORY,type IdentityRepository,type DecisionIdFactory} from '../../application/identity/ports';
import {CHAT_REPOSITORY,type ChatRepository} from '../../application/chat/ports';
import {resolveVisibility} from '../../application/chat/resolve-visibility';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class StandardContextToolsController {
 constructor(@Inject(STANDARD_CONTEXT_SERVICE) private service:StandardContextService,
 @Inject(TOOL_EXECUTION_AUTHORITY) private authority:ToolExecutionAuthority,@Inject(AGENT_RUN_STORE) private runs:AgentRunStore,
 @Inject(IDENTITY_REPOSITORY) private identity:IdentityRepository,@Inject(DECISION_ID_FACTORY) private decisions:DecisionIdFactory,
 @Inject(CHAT_REPOSITORY) private chat:ChatRepository){}
 @Public() @Post('/internal/agent-runs/:runId/standard-context/invoke') @HttpCode(200)
 async invoke(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=StandardContextInvocation.safeParse(body);if(!parsed.success)throw new BadRequestException('standard_context_invalid_or_unsupported_input');
  const input=parsed.data,orgId=toOrgId(input.orgId);
  const decision=await this.authority.check({...input,orgId,parentRunId:runId});if(!decision.allowed)throw new ForbiddenException('standard_context_denied');
  if(!this.runs.findRequesterUserId)throw new ServiceUnavailableException('standard_context_unavailable_or_refused');
  const userId=await this.runs.findRequesterUserId(orgId,runId),locator=await this.runs.findLocator(orgId,runId);
  if(!userId||!locator)throw new ForbiddenException('standard_context_denied');
  const visible=await resolveVisibility({repo:this.identity,ids:this.decisions,chat:this.chat},{orgId,userId,...locator});
  if(visible.kind!=='allow')throw new ForbiddenException('standard_context_denied');
  const actor={orgId,userId,...locator};
  try{switch(input.toolName){
   case 'wx_project_list':return await this.service.projects(actor,input.toolArgs);
   case 'wx_project_read':return await this.service.project(actor,input.toolArgs);
   case 'wx_knowledge_search':return await this.service.search(actor,input.toolArgs);
   case 'wx_knowledge_read':return await this.service.read(actor,input.toolArgs);
  }}catch{throw new ServiceUnavailableException('standard_context_unavailable_or_refused');}
 }
}
