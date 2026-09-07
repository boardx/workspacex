import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {STANDARD_CANVAS_LIMITS,STANDARD_CANVAS_TOOLS,StandardCanvasInvocation} from '../src/standard-canvas-tools';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({limits:STANDARD_CANVAS_LIMITS,input:zodToJsonSchema(StandardCanvasInvocation,opts),tools:Object.fromEntries(Object.entries(STANDARD_CANVAS_TOOLS).map(([k,v])=>[k,{input:zodToJsonSchema(v.input,opts),output:zodToJsonSchema(v.output,opts)}]))},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_canvas_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard canvas schema stale');}else writeFileSync(path,content);
