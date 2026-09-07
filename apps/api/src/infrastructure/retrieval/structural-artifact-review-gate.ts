import type {ArtifactRepository,ObjectStore} from '../../application/artifact/ports';
import type {AuthorizeDeps} from '../../application/identity/authorize';
import {disclose} from '../../application/security/permission-filter';
import {StructuralReviewGate} from '../../application/files/review-gate';
import {extractedIngestionObjectKey,type ReviewGate} from '../../application/files/ingestion-worker';
import type {ArtifactIndexTargets} from '../../application/retrieval/request-artifact-index';
import {RETRIEVAL_EMBEDDING_LIMITS as L} from '@repo/contracts/retrieval-embedding';
/** Existing structural classifier with strictly checked, version-bound inputs. */
export class StructuralArtifactReviewGate implements ReviewGate {
 constructor(private artifacts:ArtifactRepository,private objects:ObjectStore,private targets:ArtifactIndexTargets,private identity:AuthorizeDeps){}
 async needsReview(input:Parameters<ReviewGate['needsReview']>[0]):Promise<boolean>{
  const version=await this.artifacts.findVersion(input.orgId,input.artifactVersionId);
  const found=await this.targets.find(input.orgId,input.artifactVersionId);
  if(!version||!found)throw new Error('artifact_review_unavailable');
  const decision=await disclose(this.identity,{orgId:input.orgId,userId:version.pinnedBy,projectId:found.projectId??undefined,action:'read.allHands',path:'retrieval',items:[found.target]});
  const actual=decision.visible[0]?.payload;if(!actual||actual.artifactId!==version.artifactId)throw new Error('artifact_review_unavailable');
  const derived=(await this.artifacts.listDerived(input.orgId,version.artifactId)).filter(d=>d.derivedFrom===version.id&&d.objectStorageKey!==null);
  if(derived.some(d=>d.objectStorageKey!==extractedIngestionObjectKey(input.orgId,version.id,d.kind)))throw new Error('artifact_review_unavailable');
  if(!derived.length)throw new Error('artifact_review_unavailable');
  const store:ObjectStore={putOnce:(...args)=>this.objects.putOnce(...args),head:key=>this.objects.head(key),get:async key=>{
   if(!derived.some(d=>d.objectStorageKey===key))throw new Error('artifact_review_unavailable');
   const head=await this.objects.head(key);if(!head||head.sizeBytes>L.maxArtifactBytes)throw new Error('artifact_review_unavailable');
   const bytes=await this.objects.get(key);if(!bytes||bytes.length!==head.sizeBytes)throw new Error('artifact_review_unavailable');return bytes;
  }};
  return new StructuralReviewGate({artifacts:{findVersion:async()=>version,listDerived:async()=>derived},store,
   confidentiality:{isConfidential:async(orgId,artifactId)=>{if(orgId!==input.orgId||artifactId!==version.artifactId)throw new Error('artifact_review_unavailable');return actual.confidential;}}}).needsReview(input);
 }
}
