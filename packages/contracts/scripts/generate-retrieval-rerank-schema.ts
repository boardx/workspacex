import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {RETRIEVAL_RERANK_LIMITS,RetrievalRerankRequest,RetrievalRerankResponse} from '../src/retrieval-rerank';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const value=JSON.stringify({limits:RETRIEVAL_RERANK_LIMITS,input:zodToJsonSchema(RetrievalRerankRequest,options),output:zodToJsonSchema(RetrievalRerankResponse,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/retrieval_rerank_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==value)throw new Error('retrieval rerank schema stale');}else writeFileSync(path,value);
