import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {DocumentParseInput,DocumentParseOutput,DocumentParseInvocation,DOCUMENT_PARSE_LIMITS,DOCUMENT_OCR_LIMITS,DocumentOcrStructure,DOCUMENT_PARSE_TOOL} from '../src/standard-document-tools';
it('Python document schema exactly matches the shared contract',()=>{
 const options={target:'jsonSchema7',$refStrategy:'none'} as const;
 const actual=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_document_schema.json'),'utf8'));
 expect(actual).toEqual({toolName:DOCUMENT_PARSE_TOOL,limits:DOCUMENT_PARSE_LIMITS,ocrLimits:DOCUMENT_OCR_LIMITS,structure:zodToJsonSchema(DocumentOcrStructure,options),toolInput:zodToJsonSchema(DocumentParseInput,options),input:zodToJsonSchema(DocumentParseInvocation,options),output:zodToJsonSchema(DocumentParseOutput,options)});
});
it('rejects unimplemented output and model identities without changing approved arguments',()=>{
 for(const input of [{workspacePath:'/workspace/file.docx'},{workspacePath:'/inputs/file',outputMode:'chunks'},{workspacePath:'/inputs/file',orgId:'forged'}])expect(DocumentParseInput.safeParse(input).success).toBe(false);
 expect(DocumentParseInput.parse({workspacePath:'/inputs/file'})).toEqual({workspacePath:'/inputs/file'});
});

it('allows explicit OCR without changing omitted defaults',()=>{expect(DocumentParseInput.parse({workspacePath:'/inputs/scan.pdf',ocr:true})).toEqual({workspacePath:'/inputs/scan.pdf',ocr:true});});

it('requires the OCR structure path/hash pair in both native and generated schemas',()=>{
 const base={textPath:'/workspace/parsed-12345678-1234-1234-1234-123456789012/document.md',sourceHash:'a'.repeat(64),textHash:'b'.repeat(64),source:{attachmentId:'a',path:'/inputs/a',mediaType:'application/pdf',sizeBytes:1},warnings:[]};
 const structurePath='/workspace/parsed-12345678-1234-1234-1234-123456789012/structure.json',structureHash='c'.repeat(64);
 expect(DocumentParseOutput.safeParse({...base,structurePath}).success).toBe(false);expect(DocumentParseOutput.safeParse({...base,structureHash}).success).toBe(false);
 expect(DocumentParseOutput.safeParse({...base,structurePath,structureHash}).success).toBe(true);
 const json=zodToJsonSchema(DocumentParseOutput,{target:'jsonSchema7',$refStrategy:'none'}) as {anyOf:Array<{required:string[];additionalProperties:boolean}>};
 expect(json.anyOf).toHaveLength(2);expect(json.anyOf[1]!.required).toEqual(expect.arrayContaining(['structurePath','structureHash']));expect(json.anyOf.every(x=>x.additionalProperties===false)).toBe(true);
});
