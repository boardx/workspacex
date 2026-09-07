import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {NativeFileDelegationCheckInput,NativeFileDelegationCheckOutput} from '@repo/contracts/native-file-delegation';
import {NATIVE_FILE_DELEGATION,type NativeFileDelegation} from '../../application/agent-run/native-file-delegation';
import {Public} from '../public.decorator';
@Controller()
export class NativeFileDelegationController {
 constructor(@Inject(NATIVE_FILE_DELEGATION) private readonly proof:NativeFileDelegation|null){}
 @Public() @Post('/internal/agent-runs/:runId/delegation/files/check') @HttpCode(200)
 async check(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() raw:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const input=NativeFileDelegationCheckInput.safeParse(raw);
  if(!input.success||!runId.trim()||runId.length>256)throw new BadRequestException();
  if(!this.proof)throw new ServiceUnavailableException();
  try{return NativeFileDelegationCheckOutput.parse(await this.proof.check(runId,input.data));}
  catch{throw new ServiceUnavailableException('delegation_file_unavailable');}
 }
}
