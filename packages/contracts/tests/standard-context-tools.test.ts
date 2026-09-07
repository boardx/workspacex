import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {STANDARD_CONTEXT_TOOLS,STANDARD_CONTEXT_LIMITS,StandardContextInvocation,KnowledgeSearchInput} from '../src/standard-context-tools';
describe('standard context single-source protocol',()=>{
 it('Python artifact exactly matches current schemas and limits',()=>{
  const options={target:'jsonSchema7',$refStrategy:'none'} as const;
  const actual=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_context_schema.json'),'utf8'));
  expect(actual).toEqual({limits:STANDARD_CONTEXT_LIMITS,input:zodToJsonSchema(StandardContextInvocation,options),tools:Object.fromEntries(Object.entries(STANDARD_CONTEXT_TOOLS).map(([k,v])=>[k,{input:zodToJsonSchema(v.input,options),output:zodToJsonSchema(v.output,options)}]))});
 });
 it('rejects unsupported filters and forbids caller credentials/identity in tool args',()=>{
  expect(KnowledgeSearchInput.safeParse({query:'a',timeRange:{from:'2026-01-01'}}).success).toBe(false);
  expect(KnowledgeSearchInput.safeParse({query:'a',token:'secret'}).success).toBe(false);
  expect(KnowledgeSearchInput.parse({query:'  query  '}).query).toBe('  query  '); // once approval digest must not silently change
  expect(StandardContextInvocation.safeParse({orgId:'o',attemptId:'a',leaseEpoch:0,toolCallId:'c',toolName:'wx_knowledge_search',toolArgs:{query:'x'}}).success).toBe(false);
 });
});
