import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {ScheduleToolRequest,SCHEDULE_OUTPUT_SCHEMAS} from '@repo/contracts/standard-schedule';
import {STANDARD_SCHEDULE,type StandardSchedule} from '../../application/agent-run/standard-schedule';
import {Public} from '../public.decorator';
@Controller()
export class StandardScheduleController{
 constructor(@Inject(STANDARD_SCHEDULE) private readonly schedules:StandardSchedule|null){}
 @Public() @Post('/internal/agent-runs/:runId/schedule/tools/invoke') @HttpCode(200)
 async invoke(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=ScheduleToolRequest.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('schedule_invalid');
  if(!this.schedules)throw new ServiceUnavailableException('schedule_unavailable');
  try{return SCHEDULE_OUTPUT_SCHEMAS[parsed.data.toolName].parse(await this.schedules.invoke(runId,parsed.data));}
  catch{throw new ServiceUnavailableException('schedule_refused');}
 }
}
