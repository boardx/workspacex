import { timingSafeEqual } from 'node:crypto';
import { Body,Controller,Header,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException } from '@nestjs/common';
import { NativeSessionBindingRef,NativeSessionResolveInput } from '@repo/contracts/native-session-binding';
import { NATIVE_SESSION_OWNER,type NativeSessionOwner } from '../../application/agent-run/native-session-owner';
import { toOrgId } from '../../domain/org-id';
import { Public } from '../public.decorator';
@Controller()
export class NativeSessionController {
 constructor(@Inject(NATIVE_SESSION_OWNER) private readonly owner:NativeSessionOwner|null){}
 @Public() @Post('/internal/native-sessions/:bindingId/resolve') @HttpCode(200) @Header('Cache-Control','no-store')
 async resolve(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('bindingId') bindingId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const input=NativeSessionResolveInput.safeParse(body);
  if(!input.success||!NativeSessionBindingRef.shape.bindingId.safeParse(bindingId).success)throw new BadRequestException('native_session_invalid');
  if(!this.owner)throw new ServiceUnavailableException('native_session_unavailable');
  try{return await this.owner.resolve(bindingId,{orgId:toOrgId(input.data.orgId),parentRunId:input.data.runId,attemptId:input.data.attemptId,leaseEpoch:input.data.leaseEpoch});}
  catch{throw new ServiceUnavailableException('native_session_unavailable');}
 }
}
