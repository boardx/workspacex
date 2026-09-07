import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {ImageGenerateInvocation} from '@repo/contracts/standard-image-tools';
import {STANDARD_IMAGE_SERVICE,type StandardImageService} from '../../application/agent-run/standard-image-tools';
import {toOrgId} from '../../domain/org-id';
import {Public} from '../public.decorator';
@Controller()
export class StandardImageController {
 constructor(@Inject(STANDARD_IMAGE_SERVICE) private service:StandardImageService|null){}
 @Public() @Post('/internal/agent-runs/:runId/image-generate') @HttpCode(200)
 async parse(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=ImageGenerateInvocation.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('image_generation_invalid_or_unsupported');
  if(!this.service)throw new ServiceUnavailableException('image_generation_unavailable');
  const {orgId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId,toolArgs}=parsed.data;
  try{return await this.service.generate({orgId:toOrgId(orgId),parentRunId:runId,attemptId,leaseEpoch,bindingId,toolCallId,permissionRequestId},toolArgs);}
  catch{throw new ServiceUnavailableException('image_generation_failed_no_result_confirmed');}
 }
}
