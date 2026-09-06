import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {STANDARD_WEB_TOOLS,STANDARD_WEB_LIMITS,StandardWebInvocation,WebSearchInput} from '../src/standard-web-tools';
describe('standard web single-source protocol',()=>{
 it('Python artifact exactly matches current schemas and limits',()=>{
  const options={target:'jsonSchema7',$refStrategy:'none'} as const;
  const actual=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_web_schema.json'),'utf8'));
  expect(actual).toEqual({limits:STANDARD_WEB_LIMITS,input:zodToJsonSchema(StandardWebInvocation,options),tools:Object.fromEntries(Object.entries(STANDARD_WEB_TOOLS).map(([k,v])=>[k,{input:zodToJsonSchema(v.input,options),output:zodToJsonSchema(v.output,options)}]))});
 });
 it('rejects unsupported filters and forbids caller credentials/identity in tool args',()=>{
  expect(WebSearchInput.safeParse({query:'a',timeRange:{from:'2026-01-01'}}).success).toBe(false);
  expect(WebSearchInput.safeParse({query:'a',token:'secret'}).success).toBe(false);
  expect(WebSearchInput.parse({query:'  query  '}).query).toBe('  query  '); // once approval digest must not silently change
  expect(StandardWebInvocation.safeParse({orgId:'o',attemptId:'a',leaseEpoch:0,toolCallId:'c',toolName:'fetch_url',toolArgs:{url:'https://example.com'}}).success).toBe(false);
 });
});
