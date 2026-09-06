import type { z } from 'zod';
import type { NativeArtifactPublishInput,NativeArtifactStaged } from '@repo/contracts/native-artifact-publish';
import { standardCapabilities as SC } from '@repo/contracts';
import type { ExecutionAuthorityContext } from './tool-execution-authority';
import type { OrgId } from '../../domain/org-id';
import type { RunOutputFile } from './ports';
import { sniffAndCheck } from '../../domain/files/mime-sniff';
import { inspectZipForBomb,readZipEntryBounded,zipEntryNames } from '../../domain/files/zip-inspect';
import { UPLOAD_LIMITS } from '../../domain/files/upload-limits';
export const NATIVE_OUTPUT_STAGING=Symbol('NativeOutputStaging');
export type PublishInput=z.infer<typeof NativeArtifactPublishInput>;
export type PublishReceipt=z.infer<typeof NativeArtifactStaged>;
export type PublishContext=ExecutionAuthorityContext & {bindingId:string;toolCallId:string};
export interface NativeOutputStaging {
 stage(context:PublishContext,input:PublishInput):Promise<PublishReceipt>;
 listFiles(orgId:OrgId,runId:string):Promise<readonly RunOutputFile[]>;
}
const TYPES:Record<string,{mime:string;kind:string}>={
 pdf:{mime:'application/pdf',kind:'pdf'},png:{mime:'image/png',kind:'png'},jpg:{mime:'image/jpeg',kind:'jpeg'},jpeg:{mime:'image/jpeg',kind:'jpeg'},
 txt:{mime:'text/plain',kind:'text'},md:{mime:'text/markdown',kind:'text'},csv:{mime:'text/csv',kind:'text'},
 docx:{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',kind:'zip'},xlsx:{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',kind:'zip'},pptx:{mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',kind:'zip'},
};
export async function validateNativeArtifactBytes(input:PublishInput,bytes:Uint8Array):Promise<void>{
 SC.SkillPackagePath.parse(input.workspacePath.slice('/workspace/'.length));
 const ext=input.workspacePath.split('.').at(-1)?.toLowerCase()??'';
 const type=TYPES[ext];
 if(!type||type.mime!==input.mediaType||input.title.split('.').at(-1)?.toLowerCase()!==ext||sniffAndCheck(input.title,bytes,[type.kind]).mismatch)throw new Error('native_output_mime_mismatch');
 if(type.kind==='text'){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('native_output_mime_mismatch');}}
 if(type.kind==='zip'){
  const check=await inspectZipForBomb(bytes,{maxEntries:UPLOAD_LIMITS.maxZipEntries,maxDecompressedBytes:UPLOAD_LIMITS.maxDecompressedBytes,maxNestingDepth:UPLOAD_LIMITS.maxZipNestingDepth});
  if(!check.ok)throw new Error('native_output_archive_invalid');
  validateOfficeMetadata(bytes,ext);
 }
}

/** Strict non-expanding OOXML metadata subset: no DTD, entities, comments or prefixed aliases. */
function validateOfficeMetadata(bytes:Uint8Array,ext:string){
 const names=zipEntryNames(bytes);
 if(new Set(names).size!==names.length)throw new Error('native_output_archive_invalid');
 const part={docx:'word/document.xml',xlsx:'xl/workbook.xml',pptx:'ppt/presentation.xml'}[ext];
 const type={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'}[ext];
 if(!part||!names.includes(part))throw new Error('native_output_office_mismatch');
 const xml=new TextDecoder('utf-8',{fatal:true}).decode(readZipEntryBounded(bytes,'[Content_Types].xml',256*1024)).replace(/^\uFEFF/,'');
 if(/[&!]/.test(xml))throw new Error('native_output_office_mismatch');
 const root=/^\s*(?:<\?xml\s+[^?]*\?>\s*)?<Types\s+xmlns=(['"])http:\/\/schemas\.openxmlformats\.org\/package\/2006\/content-types\1\s*>([\s\S]*)<\/Types>\s*$/.exec(xml);
 if(!root)throw new Error('native_output_office_mismatch');
 let rest=root[2]!,matched=false;
 while(rest.trim()){
  const tag=/^\s*<(Default|Override)\s+([^<>]+?)\s*\/>/.exec(rest);
  if(!tag)throw new Error('native_output_office_mismatch');
  const attrs:Record<string,string>={};let text=tag[2]!;
  while(text.trim()){
   const attr=/^\s*([A-Za-z]+)\s*=\s*(['"])([^<>]*?)\2/.exec(text);
   if(!attr||attrs[attr[1]!]!==undefined)throw new Error('native_output_office_mismatch');
   attrs[attr[1]!]=attr[3]!;text=text.slice(attr[0].length);
   if(text&&!/^\s/.test(text))throw new Error('native_output_office_mismatch');
  }
  const key=tag[1]==='Override'?'PartName':'Extension';
  if(Object.keys(attrs).length!==2||!attrs[key]||!attrs.ContentType)throw new Error('native_output_office_mismatch');
  if(tag[1]==='Override'&&attrs.PartName==='/'+part){if(matched||attrs.ContentType!==type)throw new Error('native_output_office_mismatch');matched=true;}
  rest=rest.slice(tag[0].length);
 }
 if(!matched)throw new Error('native_output_office_mismatch');
}
