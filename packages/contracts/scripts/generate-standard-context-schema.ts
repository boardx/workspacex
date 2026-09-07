import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {STANDARD_CONTEXT_LIMITS,STANDARD_CONTEXT_TOOLS,StandardContextInvocation} from '../src/standard-context-tools';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({limits:STANDARD_CONTEXT_LIMITS,input:zodToJsonSchema(StandardContextInvocation,opts),tools:Object.fromEntries(Object.entries(STANDARD_CONTEXT_TOOLS).map(([k,v])=>[k,{input:zodToJsonSchema(v.input,opts),output:zodToJsonSchema(v.output,opts)}]))},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_context_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard context schema stale');}else writeFileSync(path,content);
