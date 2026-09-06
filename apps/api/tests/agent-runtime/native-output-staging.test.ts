import { expect,it } from 'vitest';
import { NativeArtifactPublishInput } from '@repo/contracts/native-artifact-publish';
import { validateNativeArtifactBytes } from '../../src/application/agent-run/native-output-staging';
it('rejects unsupported fields and MIME mismatch before storage',async()=>{
 expect(NativeArtifactPublishInput.safeParse({workspacePath:'/workspace/a.pdf',title:'a.pdf',mediaType:'application/pdf',idempotencyKey:'one',targetProjectId:'other'}).success).toBe(false);
 await expect(validateNativeArtifactBytes({workspacePath:'/workspace/a.pdf',title:'a.pdf',mediaType:'application/pdf',idempotencyKey:'one'},Buffer.from('not a PDF'))).rejects.toThrow();
});
import {writeZip} from '../../src/infrastructure/files/zip-codec';
const office={workspacePath:'/workspace/a.docx',title:'a.docx',mediaType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const,idempotencyKey:'office'};
const xml=(part:string,type:string)=>`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="${type}"/></Types>`;
it('accepts strict OOXML metadata, rejects generic ZIP and mismatched Office family',async()=>{
 const pack=(text:string,part:string)=>writeZip([{path:'[Content_Types].xml',content:Buffer.from(text)},{path:part,content:Buffer.from('<document/>')}]);
 await expect(validateNativeArtifactBytes(office,writeZip([{path:'a.txt',content:Buffer.from('generic') }]))).rejects.toThrow();
 await expect(validateNativeArtifactBytes(office,pack(xml('xl/workbook.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'),'xl/workbook.xml'))).rejects.toThrow();
 await expect(validateNativeArtifactBytes(office,pack(xml('word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'),'word/document.xml'))).resolves.toBeUndefined();
 await expect(validateNativeArtifactBytes(office,pack(xml('word/document.xml','wrong'),'word/document.xml'))).rejects.toThrow();
});
it('supports PNG JPEG UTF8 and rejects binary text',async()=>{
 for(const [ext,mime,bytes] of [['png','image/png',Buffer.from([137,80,78,71,13,10,26,10])],['jpg','image/jpeg',Buffer.from([255,216,255])],['txt','text/plain',Buffer.from('实际 UTF8')]] as const){
  await expect(validateNativeArtifactBytes({workspacePath:`/workspace/a.${ext}`,title:`a.${ext}`,mediaType:mime,idempotencyKey:'x'},bytes)).resolves.toBeUndefined();
 }
 await expect(validateNativeArtifactBytes({workspacePath:'/workspace/a.txt',title:'a.txt',mediaType:'text/plain',idempotencyKey:'x'},Buffer.from([255,255]))).rejects.toThrow();
});
