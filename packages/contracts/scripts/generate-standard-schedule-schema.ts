import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {SCHEDULE_LIMITS,ScheduleToolRequest,SCHEDULE_TOOL_SCHEMAS,SCHEDULE_OUTPUT_SCHEMAS} from '../src/standard-schedule';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({limits:SCHEDULE_LIMITS,input:zodToJsonSchema(ScheduleToolRequest,options),tools:Object.fromEntries(Object.entries(SCHEDULE_TOOL_SCHEMAS).map(([name,schema])=>[name,zodToJsonSchema(schema,options)])),outputs:Object.fromEntries(Object.entries(SCHEDULE_OUTPUT_SCHEMAS).map(([name,schema])=>[name,zodToJsonSchema(schema,options)]))},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_schedule_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard schedule schema stale');}else writeFileSync(path,content);
