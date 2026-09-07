import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {STANDARD_CANVAS_TOOLS,STANDARD_CANVAS_LIMITS,StandardCanvasInvocation} from '../src/standard-canvas-tools';
describe('standard canvas single-source protocol',()=>{
 it('Python artifact exactly matches current schemas and limits',()=>{
  const options={target:'jsonSchema7',$refStrategy:'none'} as const;
  const actual=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_canvas_schema.json'),'utf8'));
  expect(actual).toEqual({limits:STANDARD_CANVAS_LIMITS,input:zodToJsonSchema(StandardCanvasInvocation,options),tools:Object.fromEntries(Object.entries(STANDARD_CANVAS_TOOLS).map(([k,v])=>[k,{input:zodToJsonSchema(v.input,options),output:zodToJsonSchema(v.output,options)}]))});
 });
 it('strict operations preserve approval args and reject unsupported changes',()=>{
  expect(STANDARD_CANVAS_TOOLS.wx_canvas_update.input.safeParse({canvasId:'c',expectedRevision:1,changes:{kind:'pixel-edit'},idempotencyKey:'k'}).success).toBe(false);
  expect(STANDARD_CANVAS_TOOLS.wx_canvas_read.input.safeParse({canvasId:'c',orgId:'other'}).success).toBe(false);
  expect(STANDARD_CANVAS_TOOLS.wx_canvas_update.input.parse({canvasId:'c',expectedRevision:1,changes:{kind:'replace-source',markdown:'  original  '},idempotencyKey:'k'}).changes.markdown).toBe('  original  ');
 });
});
