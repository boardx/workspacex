import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {DocumentParseInput,DocumentParseOutput,DocumentParseInvocation,DOCUMENT_PARSE_LIMITS,DOCUMENT_OCR_LIMITS,DOCUMENT_STRUCTURE_LIMITS,DocumentStructure,DocumentNativeStructure,DOCUMENT_PARSE_TOOL} from '../src/standard-document-tools';
it('Python document schema exactly matches the shared contract',()=>{
 const options={target:'jsonSchema7',$refStrategy:'none'} as const;
 const actual=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_document_schema.json'),'utf8'));
 expect(actual).toEqual({toolName:DOCUMENT_PARSE_TOOL,limits:DOCUMENT_PARSE_LIMITS,ocrLimits:DOCUMENT_OCR_LIMITS,structureLimits:DOCUMENT_STRUCTURE_LIMITS,structure:zodToJsonSchema(DocumentStructure,options),toolInput:zodToJsonSchema(DocumentParseInput,options),input:zodToJsonSchema(DocumentParseInvocation,options),output:zodToJsonSchema(DocumentParseOutput,options)});
});
it('allows implemented chunks but rejects unknown output and model identities',()=>{
 for(const input of [{workspacePath:'/workspace/file.docx'},{workspacePath:'/inputs/file',outputMode:'xml'},{workspacePath:'/inputs/file',orgId:'forged'}])expect(DocumentParseInput.safeParse(input).success).toBe(false);
 expect(DocumentParseInput.parse({workspacePath:'/inputs/file'})).toEqual({workspacePath:'/inputs/file'});
 expect(DocumentParseInput.parse({workspacePath:'/inputs/file',outputMode:'chunks'}).outputMode).toBe('chunks');
});

it('validates native Office and cross-page cell locators without invented Word pages',()=>{
 const pdf={schemaVersion:1,engine:{name:'pdfplumber',version:'0.11.10'},sourceFormat:'pdf',coordinateSpace:'pdf_points_top_left',tables:[{tableId:'pdf-table-0',fragmentIndex:0,pageNumber:1,pageTableIndex:0,bbox:[1,2,30,40],columnCount:2,continuationDetection:'none'},{tableId:'pdf-table-0',fragmentIndex:1,pageNumber:2,pageTableIndex:0,bbox:[1,2,30,40],columnCount:2,continuationDetection:'repeated_header_and_columns'}],chunks:[{type:'pdf_table_cell',text:'金额',locator:{tableId:'pdf-table-0',fragmentIndex:1,pageNumber:2,pageTableIndex:0,rowIndex:0,columnIndex:1,bbox:[1,2,3,4]}}]};
 expect(DocumentNativeStructure.parse(pdf).tables?.map(x=>x.pageNumber)).toEqual([1,2]);
 expect(DocumentNativeStructure.safeParse({...pdf,engine:{name:'openpyxl',version:'3.1.5'}}).success).toBe(false);
 const docx={schemaVersion:1,engine:{name:'python-docx',version:'1.2.0'},sourceFormat:'docx',coordinateSpace:'ooxml_native',chunks:[{type:'docx_paragraph',text:'原文',locator:{paragraphIndex:0}}]};
 expect(DocumentNativeStructure.safeParse(docx).success).toBe(true);
 expect(DocumentNativeStructure.safeParse({...docx,chunks:[{type:'docx_paragraph',text:'原文',locator:{paragraphIndex:0,pageNumber:1}}]}).success).toBe(false);
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
