import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {SkillDraftInvocation} from '@repo/contracts/standard-skill-draft';
import {SKILL_DRAFT_SERVICE,type SkillDraftService} from '../../application/agent-run/skill-draft';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class SkillDraftController {
 constructor(@Inject(SKILL_DRAFT_SERVICE) private service:SkillDraftService|null){}
 @Public() @Post('/internal/agent-runs/:runId/skill-draft') @HttpCode(200)
 async parse(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=SkillDraftInvocation.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('skill_draft_invalid_or_unsupported');
  if(!this.service)throw new ServiceUnavailableException('skill_draft_unavailable');
  const {orgId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId,toolArgs}=parsed.data;
  try{return await this.service.create({orgId:toOrgId(orgId),parentRunId:runId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId},toolArgs);}
  catch{throw new ServiceUnavailableException('skill_draft_failed_no_result_confirmed');}
 }
}
