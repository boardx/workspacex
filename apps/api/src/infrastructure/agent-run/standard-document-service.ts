import {createHash,randomUUID} from 'node:crypto';
import {DocumentParseInput,DocumentParseOutput,DOCUMENT_PARSE_LIMITS,DOCUMENT_OCR_LIMITS,DocumentOcrStructure,DOCUMENT_PARSE_TOOL} from '@repo/contracts/standard-document-tools';
import {schemas,limits} from '@repo/contracts/sandbox-session';
import type {z} from 'zod';
import type {NativeSessionOwner,NativeResolved} from '../../application/agent-run/native-session-owner';
import type {NativeRunInputs} from '../../application/agent-run/native-run-inputs';
import type {DocumentContext,DocumentSession,StandardDocumentService} from '../../application/agent-run/standard-document-tools';
import type {ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import {planExtraction} from '../../domain/chat/attachment-extraction';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
/** Thin execution adapter around the same locked AnyDoc CLI in the existing OS sandbox. */
export class DefaultStandardDocumentService implements StandardDocumentService {
 constructor(private owner:NativeSessionOwner,private inputs:NativeRunInputs,private sessions:(bound:NativeResolved)=>DocumentSession,private authority:Pick<ToolExecutionAuthority,'check'>){}
 async parse(context:DocumentContext,raw:z.infer<typeof DocumentParseInput>){
  const input=DocumentParseInput.parse(raw);
  const allowed=await this.authority.check({...context,toolName:DOCUMENT_PARSE_TOOL,toolArgs:input});
  if(!allowed.allowed)throw new Error('document_parse_denied');
  const bound=await this.owner.resolve(context.bindingId,context),source=bound.inputs.find(i=>i.path===input.workspacePath);
  if(!source)throw new Error('document_parse_input_not_bound');
  const current=await this.inputs.read(context),actual=current.manifest.find(i=>i.path===source.path);
  if(!actual||actual.attachmentId!==source.attachmentId||actual.digest!==source.digest||actual.sizeBytes!==source.sizeBytes||actual.mediaType!==source.mediaType)throw new Error('document_parse_input_changed');
  const session=this.sessions(bound),original=schemas.file.parse(await session.read(source.path));
  const bytes=Buffer.from(original.contentBase64,'base64');
  if(original.path!==source.path||original.sizeBytes!==source.sizeBytes||bytes.length!==source.sizeBytes||bytes.toString('base64')!==original.contentBase64||hash(bytes)!==source.digest)throw new Error('document_parse_input_changed');
  const plan=planExtraction(source.mediaType);
  if(input.ocr&&!['application/pdf','image/png','image/jpeg'].includes(source.mediaType))throw new Error('document_ocr_format_unsupported');
  if(!input.ocr&&plan.kind!=='convert'&&plan.kind!=='passthrough')throw new Error('document_parse_format_unsupported');
  const directory=`/workspace/parsed-${randomUUID()}`,textPath=`${directory}/document.md`;
  const convert=input.ocr
   ? ['python3','/usr/local/lib/workspacex/ocr-document.py','--source',source.path,'--media-type',source.mediaType,'--directory',directory,'--max-pages',String(DOCUMENT_OCR_LIMITS.maxPages),'--max-pixels',String(DOCUMENT_OCR_LIMITS.maxPixels),'--max-dimension',String(DOCUMENT_OCR_LIMITS.maxDimension),'--max-output-bytes',String(DOCUMENT_OCR_LIMITS.maxOutputBytes),'--timeout-ms',String(DOCUMENT_PARSE_LIMITS.timeoutMs)]
   : plan.kind==='convert'
   ? ['node','/opt/sandbox/node_modules/@firecrawl/anydoc/cli.js',source.path,'--format',plan.format,'--output',textPath]
   : ['cp','--',source.path,textPath];
  // Each argument is shell quoted even though the manifest path grammar is narrower.
  const command=(input.ocr?'':`mkdir -- ${quote(directory)} && `)+convert.map(quote).join(' ');
  const dispatch=await this.authority.check({...context,toolName:DOCUMENT_PARSE_TOOL,toolArgs:input});
  if(!dispatch.allowed)throw new Error('document_parse_denied');
  const execution={executionId:randomUUID(),command,timeoutMs:DOCUMENT_PARSE_LIMITS.timeoutMs};
  const result=await session.execute(execution);
  if(result.executionId!==execution.executionId||result.exitCode!==0||result.timedOut||result.cancelled||result.truncated)throw new Error('document_parse_failed_no_replay');
  const output=schemas.file.parse(await session.read(textPath)),content=Buffer.from(output.contentBase64,'base64');
  if(output.path!==textPath||content.length!==output.sizeBytes||content.length>limits.maxFileBytes||content.toString('base64')!==output.contentBase64)throw new Error('document_parse_output_invalid');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(content);
  if(!text.trim())throw new Error('document_parse_empty');
  let structureResult:{}|{structurePath:string;structureHash:string}={};
  if(input.ocr){
   const structurePath=`${directory}/structure.json`,file=schemas.file.parse(await session.read(structurePath)),data=Buffer.from(file.contentBase64,'base64');
   if(file.path!==structurePath||data.length!==file.sizeBytes||data.toString('base64')!==file.contentBase64||data.length+content.length>DOCUMENT_OCR_LIMITS.maxOutputBytes)throw new Error('document_ocr_structure_invalid');
   const structure=DocumentOcrStructure.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)));
   if(!structure.pages.some(page=>page.words.length))throw new Error('document_ocr_empty');
   for(const [index,page] of structure.pages.entries()){
    if(page.pageNumber!==index+1||page.width*page.height>DOCUMENT_OCR_LIMITS.maxPixels||page.words.some(word=>word.bbox.x+word.bbox.width>page.width||word.bbox.y+word.bbox.height>page.height))throw new Error('document_ocr_structure_invalid');
   }
   structureResult={structurePath,structureHash:hash(data)};
  }
  // Do not return previously authorized text after the current source permission was revoked.
  const after=await this.inputs.read(context);
  if(after.manifest.find(i=>i.path===source.path)?.digest!==source.digest)throw new Error('document_parse_input_changed');
  return DocumentParseOutput.parse({...structureResult,textPath,sourceHash:source.digest,textHash:hash(content),source:{attachmentId:source.attachmentId,path:source.path,mediaType:source.mediaType,sizeBytes:source.sizeBytes},warnings:input.ocr?['ocr_may_misrecognize_text','tables_may_lose_layout']:['markdown_only_no_page_coordinates','ocr_not_performed','tables_may_lose_layout']});
 }
}
