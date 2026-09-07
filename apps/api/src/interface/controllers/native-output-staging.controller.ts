import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {NativeArtifactStageInput} from '@repo/contracts/native-artifact-publish';
import {NATIVE_OUTPUT_STAGING,type NativeOutputStaging} from '../../application/agent-run/native-output-staging';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class NativeOutputStagingController{
 constructor(@Inject(NATIVE_OUTPUT_STAGING) private readonly staging:NativeOutputStaging|null){}
 @Public() @Post('/internal/agent-runs/:runId/native-artifacts/stage') @HttpCode(200)
 async stage(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=NativeArtifactStageInput.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('native_output_invalid');
  if(!this.staging)throw new ServiceUnavailableException('native_output_unavailable');
  const {orgId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId,toolArgs}=parsed.data;
  try{return await this.staging.stage({orgId:toOrgId(orgId),parentRunId:runId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId},toolArgs);}
  catch{throw new ServiceUnavailableException('native_output_stage_failed');}
 }
}
