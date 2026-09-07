import {StandardSqlBindings,StandardSqlSourceCheckInput,StandardSqlSourceCheckOutput,validateSqlToolArgs} from '@repo/contracts/standard-sql';
import type {z} from 'zod';
import type {DatabasePort} from '../../application/ports/database.port';
import type {ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import type {GetThreadDeps} from '../../application/chat/get-thread';
import type {StandardSqlSource} from '../../application/agent-run/standard-sql-source';
import {withAuthorizedStandardToolRun} from './with-authorized-standard-tool-run';
export class PgStandardSqlSource implements StandardSqlSource{
 constructor(private db:DatabasePort,private authority:Pick<ToolExecutionAuthority,'check'>,private visibility:GetThreadDeps){}
 async check(runId:string,raw:z.infer<typeof StandardSqlSourceCheckInput>){
  const input=StandardSqlSourceCheckInput.parse(raw),args=validateSqlToolArgs(input.toolName,input.toolArgs);
  return withAuthorizedStandardToolRun(this.db,this.authority,this.visibility,runId,{...input,toolArgs:args},async run=>{
   const bindings=StandardSqlBindings.parse(JSON.parse(process.env.STANDARD_SQL_BINDINGS??'[]'));
   const matches=bindings.filter(binding=>binding.orgId===run.orgId&&binding.userIds.includes(run.userId));
   if(matches.length!==1)throw new Error('sql_source_unavailable');
   return StandardSqlSourceCheckOutput.parse({dataSourceId:matches[0]!.dataSourceId});
  });
 }
}
