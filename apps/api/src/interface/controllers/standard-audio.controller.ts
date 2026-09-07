import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {AudioTranscribeInvocation} from '@repo/contracts/standard-audio-tools';
import {STANDARD_AUDIO_SERVICE,type StandardAudioService} from '../../application/agent-run/standard-audio-tools';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class StandardAudioController {
 constructor(@Inject(STANDARD_AUDIO_SERVICE) private service:StandardAudioService|null){}
 @Public() @Post('/internal/agent-runs/:runId/audio-transcribe') @HttpCode(200)
 async parse(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=AudioTranscribeInvocation.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('audio_transcription_invalid_or_unsupported');
  if(!this.service)throw new ServiceUnavailableException('audio_transcription_unavailable');
  const {orgId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId,toolArgs}=parsed.data;
  try{return await this.service.transcribe({orgId:toOrgId(orgId),parentRunId:runId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId},toolArgs);}
  catch{throw new ServiceUnavailableException('audio_transcription_failed_no_result_confirmed');}
 }
}
