import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {SQL_LIMITS,StandardSqlSources,StandardSqlSourceCheckInput,StandardSqlSourceCheckOutput} from '../src/standard-sql';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({limits:SQL_LIMITS,sources:zodToJsonSchema(StandardSqlSources,options),input:zodToJsonSchema(StandardSqlSourceCheckInput,options),output:zodToJsonSchema(StandardSqlSourceCheckOutput,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_sql_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard SQL schema stale');}else writeFileSync(path,content);
