import {timingSafeEqual} from 'node:crypto';
import {BadRequestException,Body,Controller,ForbiddenException,Headers,HttpCode,Inject,Param,Post,UnauthorizedException} from '@nestjs/common';
import {StandardRunStatusInvocation} from '@repo/contracts/standard-run-status';
import {STANDARD_RUN_STATUS,StandardRunStatusService} from '../../application/agent-run/standard-run-status';
import {STANDARD_ENTRY_SCOPE,type StandardEntryScope} from '../../application/agent-run/standard-entry-scope';
import {Public} from '../public.decorator';
@Controller() export class StandardRunStatusController {
 constructor(@Inject(STANDARD_RUN_STATUS) private readonly service:StandardRunStatusService,@Inject(STANDARD_ENTRY_SCOPE) private readonly scope:StandardEntryScope){}
 @Public() @Post('/internal/agent-runs/:parentRunId/standard-run-status/invoke') @HttpCode(200)
 async invoke(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('parentRunId') parentRunId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=StandardRunStatusInvocation.safeParse(body);if(!parsed.success)throw new BadRequestException('standard_entry_invalid');
  const input=parsed.data;
  try{return await this.scope.run(parentRunId,input,actor=>this.service.invoke(actor,input.toolArgs.runId));}
  catch{throw new ForbiddenException('standard_entry_refused');}
 }
}
