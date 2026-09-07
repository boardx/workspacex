import type {AuthorizeDeps} from '../../application/identity/authorize';
import type {TrustedContextActor} from '../../application/agent-run/standard-context-tools';
import {retrieveCandidates} from '../../application/retrieval/retrieve-candidates';
import type {EmbeddingPort,RerankPort,SegmentRetriever} from '../../application/retrieval/ports';
import {analyzeQuery,planChannels,type QueryTask} from '../../domain/retrieval/channel-plan';
import {isLocalOrg} from '../../domain/identity/local-org';
import {STANDARD_CONTEXT_LIMITS as L} from '@repo/contracts/standard-context-tools';
import type {PgOrganizationKnowledgeIndex} from './pg-organization-knowledge-index';
export interface OrganizationHybridRuntime {retriever:SegmentRetriever;embeddings:EmbeddingPort;rerank:RerankPort;}
/** Uses existing planner, channel SQL, per-source disclosure, fusion and rerank. */
export class OrganizationHybridRetrieval {
 constructor(private index:PgOrganizationKnowledgeIndex,private identity:AuthorizeDeps,private runtime?:OrganizationHybridRuntime){}
 async search(actor:TrustedContextActor,input:{query:string;projectId?:string;queryTask?:QueryTask}){
  if(!this.runtime)throw new Error('hybrid_not_configured');
  const org=await this.identity.repo.findOrganization(actor.orgId);
  if(!org||isLocalOrg(org.kind))throw new Error('hybrid_not_available');
  const task=input.queryTask??'search';
  if(planChannels(task,analyzeQuery(input.query)).some(p=>p.channel==='graph'))throw new Error('hybrid_graph_seeds_unavailable');
  const outcome=await retrieveCandidates({...this.identity,...this.runtime,
   discloseChannel:(rows,path)=>this.index.discloseChannel(actor,rows,input.projectId,path)},
   {orgId:actor.orgId,userId:actor.userId,projectId:input.projectId??null,task,query:input.query,timeRange:null,limit:L.maxResults,evidencePolicyRaw:'primary-only'});
  const candidates=[];
  for(const ranked of outcome.ranked){
   const current=await this.index.read(actor,ranked.row.segmentId,input.projectId);
   if(!current||current.row.artifactVersionId!==ranked.row.artifactVersionId||current.row.content!==ranked.row.content)throw new Error('context_source_unavailable');
   candidates.push(current);
  }
  // Raw claim statements/opposing IDs and withheld refs are not a public knowledge-tool output.
  return {candidates,plan:outcome.plan};
 }
}
