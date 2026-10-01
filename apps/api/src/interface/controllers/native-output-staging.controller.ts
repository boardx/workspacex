import {randomUUID,timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Optional,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {LOGGER_PORT,type LoggerPort,errorDetailOf,structuredErrorLog} from '../../application/ports/logger.port';
import {NativeArtifactStageInput} from '@repo/contracts/native-artifact-publish';
import {NATIVE_OUTPUT_STAGING,type NativeOutputStaging} from '../../application/agent-run/native-output-staging';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class NativeOutputStagingController{
 constructor(@Inject(NATIVE_OUTPUT_STAGING) private readonly staging:NativeOutputStaging|null,
  @Optional() @Inject(LOGGER_PORT) private readonly logger?:LoggerPort){}
 @Public() @Post('/internal/agent-runs/:runId/native-artifacts/stage') @HttpCode(200)
 async stage(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=NativeArtifactStageInput.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('native_output_invalid');
  if(!this.staging)throw new ServiceUnavailableException('native_output_unavailable');
  const {orgId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId,toolArgs}=parsed.data;
  try{return await this.staging.stage({orgId:toOrgId(orgId),parentRunId:runId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId},toolArgs);}
  catch(error){
   // 2026-09-27 devapp：`wx_artifact_publish` 失败，这里此前把七八种拒绝原因（授权/租约被拒、
   // 同名文件已暂存、同幂等键内容冲突、超限、路径不符、字节校验失败……）一律折成 503 且**不记日志**——
   // 真正的原因从此不存在于任何地方。响应仍是同一个 503（不改契约、不把内部原因发给调用方），
   // 只把原因留在服务端日志里，下一次发生时能直接查到是哪一种。
   if(this.logger)structuredErrorLog(this.logger,randomUUID)('native output stage failed',{runId,attemptId,leaseEpoch,toolCallId,err:errorDetailOf(error)});
   throw new ServiceUnavailableException('native_output_stage_failed');
  }
 }
}
