import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {RETRIEVAL_EMBEDDING_LIMITS,RetrievalEmbeddingRequest,RetrievalEmbeddingResponse} from '../src/retrieval-embedding';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({limits:RETRIEVAL_EMBEDDING_LIMITS,input:zodToJsonSchema(RetrievalEmbeddingRequest,opts),output:zodToJsonSchema(RetrievalEmbeddingResponse,opts)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/retrieval_embedding_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('retrieval embedding schema stale');}else writeFileSync(path,content);
