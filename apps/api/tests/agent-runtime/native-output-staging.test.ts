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

it('admits JSON artifacts as data only and rejects malformed or non-UTF8 bytes',async()=>{
 const input=NativeArtifactPublishInput.parse({workspacePath:'/workspace/draft.json',title:'draft.json',mediaType:'application/json',idempotencyKey:'draft'});
 await expect(validateNativeArtifactBytes(input,Buffer.from('{"files":[],"title":"草稿"}'))).resolves.toBeUndefined();
 for(const bytes of [Buffer.from('{"broken":'),Buffer.from([255,255]),Buffer.from('<script>invalid JSON</script>')])await expect(validateNativeArtifactBytes(input,bytes)).rejects.toThrow();
 await expect(validateNativeArtifactBytes({...input,title:'draft.txt'},Buffer.from('{}'))).rejects.toThrow();
});

it('delivers Python reproduction source as UTF8 data while rejecting binary and mismatched titles',async()=>{
 const input=NativeArtifactPublishInput.parse({workspacePath:'/workspace/analyze.py',title:'analyze.py',mediaType:'text/plain',idempotencyKey:'source'});
 await expect(validateNativeArtifactBytes(input,Buffer.from('import pandas as pd\nprint(52)\n'))).resolves.toBeUndefined();
 for(const bytes of [Buffer.from([0x7f,0x45,0x4c,0x46]),Buffer.from([255,255]),Buffer.from('x\0y')])await expect(validateNativeArtifactBytes(input,bytes)).rejects.toThrow();
 await expect(validateNativeArtifactBytes({...input,title:'analyze.txt'},Buffer.from('print(52)'))).rejects.toThrow();
});
it('HTML download artifacts require exact MIME and UTF8 bytes, never a disguised binary',async()=>{
 const input=NativeArtifactPublishInput.parse({workspacePath:'/workspace/bundle.html',title:'bundle.html',mediaType:'text/html',idempotencyKey:'html'});
 const bytes=Buffer.from('<!doctype html><html><body><script>window.test=1</script>合成网页</body></html>');
 await expect(validateNativeArtifactBytes(input,bytes)).resolves.toBeUndefined();
 for(const bad of [Buffer.from([255]),Buffer.from([0x7f,0x45,0x4c,0x46]),Buffer.from('a\0b')])await expect(validateNativeArtifactBytes(input,bad)).rejects.toThrow();
 await expect(validateNativeArtifactBytes({...input,mediaType:'text/plain'},bytes)).rejects.toThrow();
 await expect(validateNativeArtifactBytes({...input,title:'bundle.txt'},bytes)).rejects.toThrow();
});
