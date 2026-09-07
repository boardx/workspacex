import type {OrgId} from '../../domain/org-id';
import type {AuthorizeDeps} from '../identity/authorize';
import {disclose,type Guarded} from '../security/permission-filter';
import {replayIngestionRun,type IngestionWorkerDeps,type ReviewGate} from '../files/ingestion-worker';
import type {ArtifactIndexProducer} from './index-artifact-version';
export interface ArtifactIndexTarget {artifactId:string;status:string;confidential:boolean;}
export interface ArtifactIndexTargets {find(orgId:OrgId,versionId:string):Promise<{projectId:string|null;target:Guarded<ArtifactIndexTarget>}|null>;}
export class ArtifactIndexDenied extends Error{}
export const ARTIFACT_INDEXING_SERVICE=Symbol('ArtifactIndexingService');
export class ArtifactIndexingService {
 constructor(private targets:ArtifactIndexTargets,private identity:AuthorizeDeps,private worker:IngestionWorkerDeps,private producer:ArtifactIndexProducer,private review:ReviewGate){if(worker.indexer!==producer)throw new Error('artifact_index_worker_not_configured');}
 private async authorize(orgId:OrgId,userId:string,versionId:string){
  const found=await this.targets.find(orgId,versionId);if(!found)throw new ArtifactIndexDenied();
  const decision=await disclose(this.identity,{orgId,userId,projectId:found.projectId??undefined,action:'content.indexFile',path:'retrieval',items:[found.target]});
  const target=decision.visible[0]?.payload;if(!target)throw new ArtifactIndexDenied();return target;
 }
 async request(orgId:OrgId,userId:string,artifactVersionId:string){
  const result=(status:'ready'|'review_pending'|'busy'|'failed')=>({artifactVersionId,status});
  for(let step=0;step<6;step++){
   const target=await this.authorize(orgId,userId,artifactVersionId);
   if(target.status==='REVIEW_PENDING')return result('review_pending');
   if(target.status==='READY'){
    if(step===0)await this.producer.index({orgId,artifactVersionId});
    const latest=await this.authorize(orgId,userId,artifactVersionId);
    return result(latest.status==='READY'?'ready':latest.status==='REVIEW_PENDING'?'review_pending':'busy');
   }
   const pending=await this.worker.outbox.findByVersion(orgId,artifactVersionId);
   if(!pending)return result('failed');
   if(pending.step==='REVIEW_PENDING')return result('review_pending');
   const attempted=await replayIngestionRun(this.worker,orgId,artifactVersionId,'user-index',this.review,true);
   if(!attempted.claimed)return result('busy');
   const next=await this.worker.outbox.findByVersion(orgId,artifactVersionId);
   if(next?.id===pending.id)return result('failed');
  }
  return result('busy');
 }
}
