import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {SubtaskSpawnInvocation} from '@repo/contracts/standard-subtask-tools';
import {STANDARD_SUBTASK_SERVICE,type StandardSubtaskService} from '../../application/agent-run/standard-subtask-tools';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class StandardSubtaskToolsController {
 constructor(@Inject(STANDARD_SUBTASK_SERVICE) private service:StandardSubtaskService|null){}
 @Public() @Post('/internal/agent-runs/:runId/subtasks/spawn') @HttpCode(200)
 async spawn(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=SubtaskSpawnInvocation.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('subtask_spawn_invalid_or_unsupported');
  if(!this.service)throw new ServiceUnavailableException('subtask_spawn_unavailable');
  const {orgId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId,toolArgs}=parsed.data;
  try{return await this.service.spawn({orgId:toOrgId(orgId),parentRunId:runId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId},toolArgs);}
  catch{throw new ServiceUnavailableException('subtask_spawn_failed_no_result_confirmed');}
 }
}
