import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {STANDARD_WEB_LIMITS,STANDARD_WEB_TOOLS,StandardWebInvocation,StandardWebFailureBody,STANDARD_WEB_FAILURE_GUIDANCE} from '../src/standard-web-tools';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({limits:STANDARD_WEB_LIMITS,failure:{body:zodToJsonSchema(StandardWebFailureBody,opts),guidance:STANDARD_WEB_FAILURE_GUIDANCE},input:zodToJsonSchema(StandardWebInvocation,opts),tools:Object.fromEntries(Object.entries(STANDARD_WEB_TOOLS).map(([k,v])=>[k,{input:zodToJsonSchema(v.input,opts),output:zodToJsonSchema(v.output,opts)}]))},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_web_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard web schema stale');}else writeFileSync(path,content);
