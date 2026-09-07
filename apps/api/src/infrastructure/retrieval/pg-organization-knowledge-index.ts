import {STANDARD_CONTEXT_LIMITS as L} from '@repo/contracts/standard-context-tools';
import type {DatabasePort} from '../../application/ports/database.port';
import type {AuthorizeDeps} from '../../application/identity/authorize';
import type {TrustedContextActor} from '../../application/agent-run/standard-context-tools';
import {disclose,type Guarded} from '../../application/security/permission-filter';
import type {CandidateRow} from '../../application/retrieval/ports';
import {PgSegmentRetriever} from './pg-segment-retriever';
interface LocatorRow {artifact_id:string;artifact_version_id:string;project_id:string|null;title:string;source:string;synthesized:boolean;confidential:boolean;anchor_kind:string;anchor_locator:string;}
export interface AuthorizedIndexedSegment {readonly row:CandidateRow;readonly locator:LocatorRow;}
/** Reuses existing FTS and artifact disclosure. Source project membership is checked per candidate. */
export class PgOrganizationKnowledgeIndex {
 private retriever:PgSegmentRetriever;
 constructor(private db:DatabasePort,private identity:AuthorizeDeps){this.retriever=new PgSegmentRetriever(db);}
 private async authorized(actor:TrustedContextActor,item:Guarded<CandidateRow>,projectId?:string):Promise<AuthorizedIndexedSegment|null>{
  if(item.ref.kind!=='segment')throw new Error('context_index_unavailable');
  const locator=await this.db.withTenant(actor.orgId,async s=>(await s.query<LocatorRow>(`SELECT v.artifact_id,v.id AS artifact_version_id,a.project_id,a.title,a.source,a.synthesized,a.confidential,k.kind AS anchor_kind,k.locator AS anchor_locator
    FROM segments sg JOIN artifact_versions v ON v.org_id=sg.org_id AND v.id=sg.artifact_version_id
    JOIN artifacts a ON a.org_id=v.org_id AND a.id=v.artifact_id
    JOIN LATERAL (SELECT kind,locator FROM anchors an WHERE an.org_id=sg.org_id AND an.segment_id=sg.id ORDER BY an.id LIMIT 1) k ON true
    WHERE sg.org_id=$1 AND sg.id=$2`,[actor.orgId,item.ref.id])).rows[0]);
  if(!locator||item.sources.length!==1||item.sources[0]?.kind!=='artifact'||item.sources[0].id!==locator.artifact_id)return null;
  if(projectId&&locator.project_id!==null&&locator.project_id!==projectId)return null;
  const result=await disclose(this.identity,{orgId:actor.orgId,userId:actor.userId,projectId:locator.project_id??undefined,action:'read.allHands',path:'retrieval',items:[item]});
  const row=result.visible[0]?.payload;
  if(!row||row.artifactId!==locator.artifact_id||row.artifactVersionId!==locator.artifact_version_id||row.projectId!==locator.project_id)return null;
  // Interview/session consent and external confidential processing need their original
  // source gates; this explicitly named first increment only exposes primary uploaded files.
  if(locator.source!=='upload'||locator.synthesized||locator.confidential||row.confidential||row.speakerSubjectId!==null||!['file','photo'].includes(row.sourceType)||row.lifecycle!=='effective'||!row.inScope)return null;
  if(Buffer.byteLength(row.content,'utf8')>L.maxReadBytes)throw new Error('context_index_unavailable');
  return {row,locator};
 }
 async search(actor:TrustedContextActor,query:string,projectId?:string):Promise<readonly AuthorizedIndexedSegment[]>{
  const raw=await this.retriever.fts({orgId:actor.orgId,projectId:projectId??null,query,timeRange:null,limit:L.maxIndexedCandidates});
  const visible:AuthorizedIndexedSegment[]=[];
  for(const item of raw){const value=await this.authorized(actor,item,projectId);if(value)visible.push(value);}
  return visible;
 }
 async read(actor:TrustedContextActor,segmentId:string,projectId?:string):Promise<AuthorizedIndexedSegment|null>{
  const row=await this.retriever.byId(actor.orgId,segmentId);
  return row?this.authorized(actor,row,projectId):null;
 }
}
