import {ArtifactEmbeddingOwnershipDenied} from '../../application/retrieval/artifact-embedding-accounting';
import {resolveArtifactRequestStart} from "../auth/pg-runtime-model-usage-repository";
import {randomUUID} from 'node:crypto';
import type {DatabasePort} from '../../application/ports/database.port';
import type {OrgId} from '../../domain/org-id';
import type {ArtifactEmbeddingAccounting,ArtifactIndexInput,ArtifactIndexBatch} from '../../application/retrieval/index-artifact-version';
import type {ArtifactEmbeddingUsagePort} from '../../application/retrieval/artifact-embedding-accounting';
import {guard,disclose} from '../../application/security/permission-filter';
import {PgArtifactRepository} from '../artifact/pg-artifact-repository';
import {PgIdentityRepository} from '../identity/pg-identity-repository';
import {PgIngestionRepository} from '../files/pg-ingestion-repository';
import {PgTokenUsageRepository} from '../auth/pg-token-usage-repository';
import {PgArtifactIndexTargets} from './pg-artifact-index-targets';
interface Operation {id:string;user_id:string;artifact_id:string;artifact_version_id:string;project_id:string|null;content_hash:string;ingestion_job_id:string|null;ingestion_attempt:number|null;}
/** Opaque operation only; each SDK HTTP rechecks stored actor and current artifact/job authority. */
export class PgArtifactEmbeddingAccounting implements ArtifactEmbeddingAccounting,ArtifactEmbeddingUsagePort {
 constructor(private readonly db:DatabasePort){}
 private async scoped<T>(orgId:OrgId,work:(db:DatabasePort)=>Promise<T>):Promise<T>{
  return this.db.withTenant(orgId,async s=>work({withTenant:async(org,fn)=>{if(org!==orgId)throw new ArtifactEmbeddingOwnershipDenied();return fn(s);},withoutTenant:async()=>{throw new ArtifactEmbeddingOwnershipDenied();},close:async()=>{}}));
 }
 private async authorized(db:DatabasePort,orgId:OrgId,op:Operation){
  const repo=new PgIdentityRepository(db),identity={repo,ids:{next:()=>randomUUID()}};
  if(!await repo.findOrgMembership(op.user_id,orgId))throw new ArtifactEmbeddingOwnershipDenied();
  const target=await new PgArtifactIndexTargets(db).find(orgId,op.artifact_version_id),version=await new PgArtifactRepository(db).findVersion(orgId,op.artifact_version_id);
  if(!target||!version||version.artifactId!==op.artifact_id||version.contentHash!==op.content_hash||target.projectId!==op.project_id)throw new ArtifactEmbeddingOwnershipDenied();
  const decision=await disclose(identity,{orgId,userId:op.user_id,projectId:op.project_id??undefined,action:'content.indexFile',path:'retrieval',items:[target.target]});
  const current=decision.visible[0]?.payload;
  if(!current||current.confidential||!['SEGMENTED','ENRICHED','INDEXED','READY'].includes(current.status))throw new ArtifactEmbeddingOwnershipDenied();
  if(op.ingestion_job_id!==null){if(!await new PgIngestionRepository(db).lockAccountingClaim(orgId,op.artifact_version_id,op.ingestion_job_id,op.ingestion_attempt!))throw new ArtifactEmbeddingOwnershipDenied();}
  else if(current.status!=='READY')throw new ArtifactEmbeddingOwnershipDenied();
 }
 async open(input:ArtifactIndexInput,batch:ArtifactIndexBatch){
  if(input.artifactVersionId!==batch.artifactVersionId||!batch.publisherUserId||!batch.externalEmbeddingAllowed||batch.requiresReview)throw new ArtifactEmbeddingOwnershipDenied();
  const op:Operation={id:randomUUID(),user_id:input.requestedBy??batch.publisherUserId,artifact_id:batch.artifactId,artifact_version_id:batch.artifactVersionId,project_id:batch.projectId,content_hash:batch.contentHash,ingestion_job_id:input.ingestionClaim?.jobId??null,ingestion_attempt:input.ingestionClaim?.attempt??null};
  await this.scoped(input.orgId,async db=>{await this.authorized(db,input.orgId,op);await db.withTenant(input.orgId,s=>s.query('INSERT INTO artifact_embedding_operations(id,org_id,user_id,artifact_id,artifact_version_id,project_id,content_hash,ingestion_job_id,ingestion_attempt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[op.id,input.orgId,op.user_id,op.artifact_id,op.artifact_version_id,op.project_id,op.content_hash,op.ingestion_job_id,op.ingestion_attempt]));});
  return {kind:'artifact-index' as const,orgId:String(input.orgId),operationId:op.id};
 }
 private async find(db:DatabasePort,orgId:OrgId,operationId:string){
  const op=await db.withTenant(orgId,async s=>(await s.query<Operation>('SELECT id,user_id,artifact_id,artifact_version_id,project_id,content_hash,ingestion_job_id,ingestion_attempt FROM artifact_embedding_operations WHERE org_id=$1 AND id=$2',[orgId,operationId])).rows[0]);
  if(!op)throw new ArtifactEmbeddingOwnershipDenied();
  // Metadata needed to derive the actor accompanies a guarded artifact operation, no source content.
  const result=await disclose({repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()}},{orgId,userId:op.user_id,projectId:op.project_id??undefined,action:'content.indexFile',path:'retrieval',items:[guard({kind:'artifact',id:op.artifact_id},op)]});
  if(!result.visible[0])throw new ArtifactEmbeddingOwnershipDenied();return result.visible[0].payload;
 }
 async start(orgId:OrgId,operationId:string,input:Parameters<ArtifactEmbeddingUsagePort['start']>[2]){
  if(process.env.KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED!=='1')throw new Error('artifact_accounting_disabled');
  if(process.env.KERNEL_AI_PRODUCT_QUOTA_ENABLED==='1')throw new Error('ARTIFACT_EMBEDDING_ADMISSION_REQUIRED');
  const provider=(process.env.KERNEL_MODEL_PROVIDER??'').trim();if(!provider||input.modelId!==process.env.KERNEL_EMBEDDING_MODEL_ID)throw new Error('artifact_accounting_binding_unconfigured');
  await this.scoped(orgId,async db=>{
   await db.withTenant(orgId,s=>s.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["artifact-model-request:"+input.requestId]));
   const usage=new PgTokenUsageRepository(db),existing=await db.withTenant(orgId,s=>resolveArtifactRequestStart(s,orgId,input.requestId));
   if(existing){if(existing.artifact_operation_id!==operationId||existing.model_id!==input.modelId||existing.model_provider!==provider||existing.started_at.toISOString()!==new Date(input.startedAt).toISOString())throw new ArtifactEmbeddingOwnershipDenied();return;}
   const op=await this.find(db,orgId,operationId);await this.authorized(db,orgId,op);
   await usage.startRequest(orgId,{...input,userId:op.user_id,runId:null,executionAttemptId:null,projectId:op.project_id,modelProvider:provider,artifactOperationId:op.id,callPurpose:'retrieval-embedding'});
   const stored=await db.withTenant(orgId,s=>resolveArtifactRequestStart(s,orgId,input.requestId));
   if(!stored||stored.artifact_operation_id!==op.id||stored.user_id!==op.user_id||stored.project_id!==op.project_id||stored.model_id!==input.modelId||stored.model_provider!==provider||stored.started_at.toISOString()!==new Date(input.startedAt).toISOString())throw new ArtifactEmbeddingOwnershipDenied();
  });
 }
 async terminal(orgId:OrgId,operationId:string,input:Parameters<ArtifactEmbeddingUsagePort['terminal']>[2]){
  const usage=new PgTokenUsageRepository(this.db),row=await this.db.withTenant(orgId,s=>resolveArtifactRequestStart(s,orgId,input.requestId));
  if(!row||row.artifact_operation_id!==operationId||Date.parse(input.endedAt)<row.started_at.getTime())throw new ArtifactEmbeddingOwnershipDenied();
  const {total,prompt,completion,cacheInput,reasoningOutput}=input.usage;
  await usage.record(orgId,{eventId:input.requestId,userId:row.user_id,runId:null,projectId:row.project_id,modelProvider:row.model_provider,modelId:row.model_id,callPurpose:'retrieval-embedding',requestStartedAt:row.started_at.toISOString(),requestEndedAt:input.endedAt,outcome:input.outcome,totalSource:total===undefined?'unknown':'reported',tokensTotal:total??0,promptTokens:prompt??null,completionTokens:completion??null,cacheInputTokens:cacheInput!==undefined&&prompt!==undefined&&cacheInput<=prompt?cacheInput:null,reasoningOutputTokens:reasoningOutput!==undefined&&completion!==undefined&&reasoningOutput<=completion?reasoningOutput:null});
 }
}
