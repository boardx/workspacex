import {createHash} from 'node:crypto';
import {KnowledgeReadOutput,KnowledgeSearchOutput,STANDARD_CONTEXT_LIMITS as L,STANDARD_CONTEXT_TOOLS as C} from '@repo/contracts/standard-context-tools';
import type {z} from 'zod';
import {authorize,type AuthorizeDeps} from '../../application/identity/authorize';
import type {StandardKnowledgeSource,TrustedContextActor} from '../../application/agent-run/standard-context-tools';
import {windowExcerpt} from '../../application/agent-run/file-retrieval';
import type {PgOrganizationKnowledgeIndex,AuthorizedIndexedSegment} from '../retrieval/pg-organization-knowledge-index';
const version=(item:AuthorizedIndexedSegment)=>`${item.row.artifactVersionId}@sha256:${createHash('sha256').update(item.row.content,'utf8').digest('hex')}`;
const citation=(item:AuthorizedIndexedSegment)=>({kind:'indexed-segment' as const,segmentId:item.row.segmentId,artifactId:item.row.artifactId,artifactVersionId:item.row.artifactVersionId,projectId:item.locator.project_id,anchor:{kind:item.locator.anchor_kind,locator:item.locator.anchor_locator}});
/** Explicit organization-index profile, composed alongside existing extracted attachments. */
export class OrganizationContextSource implements StandardKnowledgeSource {
 constructor(private index:PgOrganizationKnowledgeIndex,private identity:AuthorizeDeps,private files:StandardKnowledgeSource){}
 private async project(actor:TrustedContextActor,projectId?:string){
  if(projectId&&!(await authorize(this.identity,{orgId:actor.orgId,userId:actor.userId,projectId,object:{kind:'project',id:projectId},action:'read.published'})).allowed)throw new Error('context_source_unavailable');
 }
 async search(actor:TrustedContextActor,input:z.infer<typeof C.wx_knowledge_search.input>){
  if(input.scope!=='organization-index')return this.files.search(actor,input);
  await this.project(actor,input.projectId);const limit=input.limit??5;
  const candidates=await this.index.search(actor,input.query,input.projectId),items=[];
  for(const candidate of candidates.slice(0,limit)){
   const current=await this.index.read(actor,candidate.row.segmentId,input.projectId);
   if(!current)throw new Error('context_source_unavailable');
   items.push({sourceId:`segment:${current.row.segmentId}`,versionId:version(current),title:current.locator.title,excerpt:windowExcerpt(current.row.content,input.query.toLowerCase().split(/\s+/),2000),citationAnchor:citation(current)});
  }
  return KnowledgeSearchOutput.parse({items,scopeMode:'organization-index-fts',coverage:'primary-file-index',truncated:candidates.length>limit});
 }
 async read(actor:TrustedContextActor,input:z.infer<typeof C.wx_knowledge_read.input>){
  if(!input.sourceId.startsWith('segment:'))return this.files.read(actor,input);
  await this.project(actor,input.projectId);
  const first=await this.index.read(actor,input.sourceId.slice(8),input.projectId);
  if(!first||version(first)!==input.versionId)throw new Error('context_source_unavailable');
  const current=await this.index.read(actor,first.row.segmentId,input.projectId);
  if(!current||version(current)!==input.versionId)throw new Error('context_source_unavailable');
  return KnowledgeReadOutput.parse({sourceId:input.sourceId,sourceVersion:input.versionId,content:current.row.content.slice(0,L.maxTextChars),citationAnchor:citation(current),accessibleAt:new Date().toISOString(),truncated:current.row.content.length>L.maxTextChars,contentKind:'indexed-segment'});
 }
}
