import {createHash} from 'node:crypto';
import {KnowledgeReadOutput,KnowledgeSearchOutput,STANDARD_CONTEXT_LIMITS as L,STANDARD_CONTEXT_TOOLS as C} from '@repo/contracts/standard-context-tools';
import type {z} from 'zod';
import type {ObjectStore} from '../../application/artifact/ports';
import {extractedObjectKey} from '../../application/chat/attachment-extraction-worker';
import {authorize} from '../../application/identity/authorize';
import {resolveVisibility,type ResolveVisibilityDeps} from '../../application/chat/resolve-visibility';
import type {StandardKnowledgeSource,TrustedContextActor} from '../../application/agent-run/standard-context-tools';
import type {FileRetrievalScope} from '../../application/agent-run/file-retrieval';
import {windowExcerpt} from '../../application/agent-run/file-retrieval';
import {PgFileRetrieval,type FileSourceRow} from './pg-file-retrieval';

/** Existing restricted FTS retrieval, with immutable extracted bytes and current read authorization. */
export class StandardContextSource implements StandardKnowledgeSource {
 constructor(private retrieval:PgFileRetrieval,private store:ObjectStore,private visibility:ResolveVisibilityDeps){}
 private async scope(actor:TrustedContextActor,projectId?:string):Promise<FileRetrievalScope>{
  const project=projectId??actor.projectId;
  if(project!==null){
   const decision=await authorize(this.visibility,{orgId:actor.orgId,userId:actor.userId,projectId:project,object:{kind:'project',id:project},action:'read.published'});
   if(!decision.allowed)throw new Error('context_source_unavailable');
  }
  return {threadId:actor.threadId,projectId:project,actorUserId:actor.userId};
 }
 private async permitted(actor:TrustedContextActor,row:FileSourceRow):Promise<boolean>{
  return (await resolveVisibility(this.visibility,{orgId:actor.orgId,userId:actor.userId,threadId:row.thread_id,projectId:row.project_id})).kind==='allow';
 }
 private citation(row:FileSourceRow){return {kind:'chat-attachment' as const,sourceRecordId:row.source_record_id,threadId:row.thread_id,messageId:row.message_id,projectId:row.project_id};}
 private async content(actor:TrustedContextActor,row:FileSourceRow){
  if(row.extracted_ref!==extractedObjectKey(actor.orgId,row.source_record_id))throw new Error('context_source_unavailable');
  const head=await this.store.head(row.extracted_ref);
  if(!head||head.sizeBytes>L.maxReadBytes)throw new Error('context_source_unavailable');
  const bytes=await this.store.get(row.extracted_ref);
  if(!bytes||bytes.byteLength!==head.sizeBytes||bytes.byteLength>L.maxReadBytes)throw new Error('context_source_unavailable');
  return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),version:`sha256:${createHash('sha256').update(bytes).digest('hex')}`};
 }
 async search(actor:TrustedContextActor,input:z.infer<typeof C.wx_knowledge_search.input>){
  const limit=input.limit??5;
  const rows=await this.retrieval.searchSources(actor.orgId,await this.scope(actor,input.projectId),input.query,limit+1);
  const items=[];
  for(const row of rows.slice(0,limit)){
   // Landing excerpts are not immutable original content; they remain available only in legacy retrieval.
   if(row.kind!=='chat-attachment'||!row.extracted_ref||!await this.permitted(actor,row))continue;
   const content=await this.content(actor,row);
   if(!await this.permitted(actor,row))throw new Error('context_source_unavailable');
   items.push({sourceId:`chat-attachment:${row.source_record_id}`,versionId:content.version,title:row.title??'',excerpt:windowExcerpt(content.text,input.query.toLowerCase().split(/\s+/),2000),citationAnchor:this.citation(row)});
  }
  return KnowledgeSearchOutput.parse({items,scopeMode:'existing-file-retrieval',truncated:rows.length>limit});
 }
 async read(actor:TrustedContextActor,input:z.infer<typeof C.wx_knowledge_read.input>){
  if(!input.sourceId.startsWith('chat-attachment:'))throw new Error('context_source_unavailable');
  const row=await this.retrieval.findAttachmentSource(actor.orgId,await this.scope(actor,input.projectId),input.sourceId.slice('chat-attachment:'.length));
  if(!row||!await this.permitted(actor,row))throw new Error('context_source_unavailable');
  const content=await this.content(actor,row);
  if(content.version!==input.versionId||!await this.permitted(actor,row))throw new Error('context_source_unavailable');
  return KnowledgeReadOutput.parse({sourceId:input.sourceId,sourceVersion:content.version,content:content.text.slice(0,L.maxTextChars),citationAnchor:this.citation(row),accessibleAt:new Date().toISOString(),truncated:content.text.length>L.maxTextChars,contentKind:'extracted-source'});
 }
}
