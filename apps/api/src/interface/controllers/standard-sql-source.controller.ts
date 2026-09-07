import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {StandardSqlSourceCheckInput} from '@repo/contracts/standard-sql';
import {STANDARD_SQL_SOURCE,type StandardSqlSource} from '../../application/agent-run/standard-sql-source';
import {Public} from '../public.decorator';
@Controller()
export class StandardSqlSourceController{
 constructor(@Inject(STANDARD_SQL_SOURCE) private readonly source:StandardSqlSource|null){}
 @Public() @Post('/internal/agent-runs/:runId/sql/source/check') @HttpCode(200)
 async check(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=StandardSqlSourceCheckInput.safeParse(body);
  if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('sql_invalid');
  if(!this.source)throw new ServiceUnavailableException('sql_unavailable');
  try{return await this.source.check(runId,parsed.data);}catch{throw new ServiceUnavailableException('sql_refused');}
 }
}
