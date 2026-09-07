import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {DocumentParseInput,DocumentParseOutput,DocumentParseInvocation,DOCUMENT_PARSE_LIMITS,DOCUMENT_PARSE_TOOL} from '../src/standard-document-tools';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:DOCUMENT_PARSE_TOOL,limits:DOCUMENT_PARSE_LIMITS,toolInput:zodToJsonSchema(DocumentParseInput,options),input:zodToJsonSchema(DocumentParseInvocation,options),output:zodToJsonSchema(DocumentParseOutput,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_document_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard document schema stale');}else writeFileSync(path,content);
