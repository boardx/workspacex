import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {SubtaskSpawnInput,SubtaskSpawnOutput,SubtaskSpawnInvocation,STANDARD_SUBTASK_LIMITS,STANDARD_SUBTASK_TOOL} from '../src/standard-subtask-tools';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:STANDARD_SUBTASK_TOOL,limits:STANDARD_SUBTASK_LIMITS,toolInput:zodToJsonSchema(SubtaskSpawnInput,options),input:zodToJsonSchema(SubtaskSpawnInvocation,options),output:zodToJsonSchema(SubtaskSpawnOutput,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_subtask_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('subtask schema stale');}else writeFileSync(path,content);
