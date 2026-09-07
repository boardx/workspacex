import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {zodToJsonSchema} from 'zod-to-json-schema';
import {RunStatusInput,RunStatusOutput,STANDARD_RUN_STATUS_TOOL,StandardRunStatusInvocation} from '../src/standard-run-status';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:STANDARD_RUN_STATUS_TOOL,input:zodToJsonSchema(StandardRunStatusInvocation,opts),toolInput:zodToJsonSchema(RunStatusInput,opts),toolOutput:zodToJsonSchema(RunStatusOutput,opts),limits:{deadlineMs:30000,maxResponseBytes:1048576}},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_run_status_schema.json');if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard run status schema stale');}else writeFileSync(path,content);
