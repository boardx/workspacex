import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as M from '../src/standard-memory';
const options = { target: 'jsonSchema7', $refStrategy: 'none' } as const;
const schemas = { searchInput:M.MemorySearchInput, writeInput:M.MemoryWriteInput, deleteInput:M.MemoryDeleteInput,
  searchOutput:M.MemorySearchOutput, writeOutput:M.MemoryWriteOutput, deleteOutput:M.MemoryDeleteOutput,
  proofInput:M.MemoryProofInput, proofOutput:M.MemoryProofOutput, scope:M.TrustedMemoryScope };
const content = JSON.stringify({ scopeKey:M.MEMORY_SCOPE_CONFIG_KEY, limits:M.MEMORY_LIMITS, failureCodes:M.MemoryFailure.options,
  ...Object.fromEntries(Object.entries(schemas).map(([key,value])=>[key,zodToJsonSchema(value,options)])) }, null, 2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_memory_schema.json');
if(process.argv.includes('--check')) { if(readFileSync(path,'utf8')!==content)throw new Error('standard memory schema stale'); }
else writeFileSync(path,content);
