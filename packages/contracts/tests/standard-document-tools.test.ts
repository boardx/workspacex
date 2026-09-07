import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {DocumentParseInput,DocumentParseOutput,DocumentParseInvocation,DOCUMENT_PARSE_LIMITS,DOCUMENT_PARSE_TOOL} from '../src/standard-document-tools';
it('Python document schema exactly matches the shared contract',()=>{
 const options={target:'jsonSchema7',$refStrategy:'none'} as const;
 const actual=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_document_schema.json'),'utf8'));
 expect(actual).toEqual({toolName:DOCUMENT_PARSE_TOOL,limits:DOCUMENT_PARSE_LIMITS,toolInput:zodToJsonSchema(DocumentParseInput,options),input:zodToJsonSchema(DocumentParseInvocation,options),output:zodToJsonSchema(DocumentParseOutput,options)});
});
it('rejects unimplemented output/OCR and model identities without changing approved arguments',()=>{
 for(const input of [{workspacePath:'/workspace/file.docx'},{workspacePath:'/inputs/file',ocr:true},{workspacePath:'/inputs/file',outputMode:'chunks'},{workspacePath:'/inputs/file',orgId:'forged'}])expect(DocumentParseInput.safeParse(input).success).toBe(false);
 expect(DocumentParseInput.parse({workspacePath:'/inputs/file'})).toEqual({workspacePath:'/inputs/file'});
});
