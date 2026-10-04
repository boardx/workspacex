import {PgArtifactEmbeddingAccounting} from '../../src/infrastructure/retrieval/pg-artifact-embedding-accounting';
import {ArtifactEmbeddingOwnershipDenied} from '../../src/application/retrieval/artifact-embedding-accounting';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {VerifiedInputOnlyBoundRegistry} from '../../src/application/agent-run/verified-input-only-bound-registry';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {seedOrg,addOrgMember,addProjectMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {registerEmbeddingModel} from '../../src/infrastructure/retrieval/register-embedding-model';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgArtifactRepository} from '../../src/infrastructure/artifact/pg-artifact-repository';
import {PgIngestionRepository} from '../../src/infrastructure/files/pg-ingestion-repository';
import {PgQuarantineRepository} from '../../src/infrastructure/files/pg-quarantine-repository';
import {resolveObjectPath} from '../../src/infrastructure/storage/object-store-path';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {uploadArtifact} from '../../src/application/files/upload-artifact';
import {runIngestionWorkerTick} from '../../src/application/files/ingestion-worker';
import {IndexArtifactVersion} from '../../src/application/retrieval/index-artifact-version';
import {PgArtifactIndexSource} from '../../src/infrastructure/retrieval/pg-artifact-index-source';
import {PgArtifactIndexWriter} from '../../src/infrastructure/retrieval/pg-artifact-index-writer';
import {StructuralArtifactReviewGate} from '../../src/infrastructure/retrieval/structural-artifact-review-gate';
import {PgArtifactIndexTargets} from '../../src/infrastructure/retrieval/pg-artifact-index-targets';
import {PgOrganizationKnowledgeIndex} from '../../src/infrastructure/retrieval/pg-organization-knowledge-index';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('producer-'+randomUUID()),project='project-'+org;
let db:PgDatabase,root:string,objects:FsObjectStore,artifacts:PgArtifactRepository,outbox:PgIngestionRepository,indexSource:PgArtifactIndexSource,indexer:IndexArtifactVersion,knowledge:PgOrganizationKnowledgeIndex;
const ids={next:()=>randomUUID()},actor={orgId:org,userId:'publisher',threadId:'trusted',projectId:project};
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'wx-index-'));objects=new FsObjectStore(root);artifacts=new PgArtifactRepository(db);outbox=new PgIngestionRepository(db);
 await seedOrg({orgId:org,projectId:project});await addOrgMember(org,'publisher','consultant',null);await addProjectMember(org,project,'publisher','member',null);
 const identity={repo:new PgIdentityRepository(db),ids};indexSource=new PgArtifactIndexSource(db,artifacts,objects,identity);indexer=new IndexArtifactVersion(indexSource,new PgArtifactIndexWriter(db,indexSource));knowledge=new PgOrganizationKnowledgeIndex(db,identity);
});
afterAll(async()=>{await db?.close();await resetOrgs(org);if(root)await rm(root,{recursive:true,force:true});});
async function upload(text:string,filename='source.txt'){
 const result=await uploadArtifact({store:objects,repo:artifacts,ids,quarantine:new PgQuarantineRepository(db),alerts:{raise:async()=>{}}},{orgId:org,projectId:project,agendaSegmentId:null,confidential:false,actorId:'publisher',files:[{filename,bytes:Buffer.from(text)}]});
 const file=result.files[0]!;if(file.status!=='accepted')throw new Error('upload fixture rejected');return file;
}
async function drive(producer=indexer){for(let i=0;i<7;i++){const result=await runIngestionWorkerTick({outbox,artifacts,store:objects,ids,indexer:producer},org,'test-worker');if(!result.claimed)return;}}
it('real upload bytes/outbox → original segments → atomic index → authorized FTS, replay remains idempotent',async()=>{
 const file=await upload('PRODUCERNEEDLE actual uploaded 中文');await drive();
 const pending=await asApp(org,c=>c.query('SELECT step,last_error FROM ingestion_outbox WHERE org_id=$1 AND artifact_version_id=$2',[org,file.versionId]));expect(pending.rows).toEqual([]);
 const found=await knowledge.search(actor,'PRODUCERNEEDLE');expect(found).toHaveLength(1);expect(found[0]!.row.content).toBe('PRODUCERNEEDLE actual uploaded 中文');expect(found[0]!.row.artifactVersionId).toBe(file.versionId);
 await indexer.index({orgId:org,artifactVersionId:file.versionId});
 expect((await knowledge.search(actor,'PRODUCERNEEDLE'))).toHaveLength(1);
 const vectors=await asApp(org,c=>c.query('SELECT * FROM segment_embeddings WHERE org_id=$1',[org]));expect(vectors.rows).toHaveLength(0);
});
it('review gate retains pending indexed text until actual READY transition',async()=>{
 const file=await upload('REVIEWNEEDLE actual review file');
 for(let i=0;i<5;i++)await runIngestionWorkerTick({outbox,artifacts,store:objects,ids,indexer},org,'review-worker',{needsReview:async()=>true});
 expect(await knowledge.search(actor,'REVIEWNEEDLE')).toHaveLength(0);
 const indexed=await asApp(org,c=>c.query('SELECT lifecycle FROM segment_text WHERE org_id=$1 AND artifact_version_id=$2',[org,file.versionId]));expect(indexed.rows).toEqual([{lifecycle:'review-pending'}]);
});
it('registered model vectors persist atomically; unregistered model never commits an index',async()=>{
 const file=await upload('VECTORNEEDLE actual embedding source');
 await registerEmbeddingModel(migrationConfig(),'test-local-vector',org,2);
 const producer=new IndexArtifactVersion(indexSource,new PgArtifactIndexWriter(db,indexSource),{model:'test-local-vector',modelVersion:org,embed:async()=>[0.5,0.25]});
 await drive(producer);
 const vectors=await asApp(org,c=>c.query('SELECT model,model_version,vector_dims(embedding) AS dims FROM segment_embeddings WHERE org_id=$1',[org]));expect(vectors.rows).toEqual([{model:'test-local-vector',model_version:org,dims:2}]);
 await expect(new IndexArtifactVersion(indexSource,new PgArtifactIndexWriter(db,indexSource),{model:'unregistered',modelVersion:'1',embed:async()=>[1,2]}).index({orgId:org,artifactVersionId:file.versionId})).rejects.toThrow('artifact_embedding_model_unregistered');
});

it('actual binary/PDF input is not indexed by the legacy text stand-in',async()=>{
 const file=await upload('%PDF-1.7\nnot a parsed document','blocked.pdf');await drive();
 const rows=await asApp(org,c=>c.query('SELECT segment_id FROM segment_text WHERE org_id=$1 AND artifact_version_id=$2',[org,file.versionId]));expect(rows.rows).toEqual([]);
 const job=await outbox.findByVersion(org,file.versionId);expect(job).not.toBeNull();
 await asApp(org,c=>c.query('DELETE FROM ingestion_outbox WHERE org_id=$1 AND artifact_version_id=$2',[org,file.versionId]));
});
it('corrupt source hash and publisher revocation prevent even text-only index writes',async()=>{
 const file=await upload('FAILNEEDLE source');await drive();
 const version=(await artifacts.findVersion(org,file.versionId))!;
 const path=resolveObjectPath(root,version.objectStorageKey);
 // Deliberate storage corruption, not a bypass of the database's immutable-version guard.
 await writeFile(path,'FAILNEEDLE forged');
 await expect(indexer.index({orgId:org,artifactVersionId:file.versionId})).rejects.toThrow('artifact_index_unavailable');
 await writeFile(path,'FAILNEEDLE source');
 await asApp(org,c=>c.query('DELETE FROM project_memberships WHERE org_id=$1 AND project_id=$2 AND user_id=$3',[org,project,'publisher']));
 await expect(indexer.index({orgId:org,artifactVersionId:file.versionId})).rejects.toThrow('artifact_index_unavailable');
 await addProjectMember(org,project,'publisher','member',null);
});

it('operator registry is replayable, refuses changed dimensions, and runtime cannot register models',async()=>{
 await registerEmbeddingModel(migrationConfig(),'test-local-vector',org,2);
 await expect(registerEmbeddingModel(migrationConfig(),'test-local-vector',org,3)).rejects.toThrow('embedding_model_registration_failed');
 await expect(asApp(org,c=>c.query("INSERT INTO embedding_models(model,model_version,dims) VALUES('forbidden',$1,2)",[org]))).rejects.toThrow();
});

it('deployed maintenance entry invokes the same real producer with normal app privileges',async()=>{
 const file=await upload('CLINEEDLE original source');await drive();
 await asApp(org,c=>c.query('DELETE FROM segment_text WHERE org_id=$1 AND artifact_version_id=$2',[org,file.versionId]));
 const script=fileURLToPath(new URL('../../scripts/index-retrieval-version.ts',import.meta.url));
 await promisify(execFile)(process.execPath,['--import','tsx',script],{env:{...process.env,WORKSPACEX_OBJECT_ROOT:root,RETRIEVAL_INDEX_ORG_ID:org,RETRIEVAL_INDEX_VERSION_ID:file.versionId,KERNEL_EMBEDDING_MODEL_ID:'',KERNEL_EMBEDDING_MODEL_VERSION:''},timeout:20000});
 expect((await knowledge.search(actor,'CLINEEDLE'))[0]?.row.artifactVersionId).toBe(file.versionId);
});

it('active per-version claims are exclusive for the user-triggered replay path',async()=>{
 const file=await upload('BUSYNEEDLE source');
 const claims=await Promise.all([outbox.claimForVersion(org,file.versionId,'one',true),outbox.claimForVersion(org,file.versionId,'two',true)]);
 expect(claims.filter(Boolean)).toHaveLength(1);
 expect(await outbox.claimForVersion(org,file.versionId,'three',true)).toBeNull();
 await asApp(org,c=>c.query("UPDATE ingestion_outbox SET locked_at=now()-interval '6 minutes' WHERE org_id=$1 AND artifact_version_id=$2",[org,file.versionId]));
 expect(await outbox.claimForVersion(org,file.versionId,'recovery',true)).not.toBeNull();
 await asApp(org,c=>c.query('DELETE FROM ingestion_outbox WHERE org_id=$1 AND artifact_version_id=$2',[org,file.versionId]));
});
it('real production user entry applies current file-write permission and drives the existing outbox',async()=>{
 const env={KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_QUIET:'1',KERNEL_ALLOW_TEST_PRINCIPAL:'1',WORKSPACEX_OBJECT_ROOT:root,KERNEL_EMBEDDING_MODEL_ID:'',KERNEL_EMBEDDING_MODEL_VERSION:''};
 const before=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 await addOrgMember(org,'viewer','consultant',null);await addProjectMember(org,project,'viewer','observer',null);await addOrgMember(org,'outsider','consultant',null);
 const file=await upload('HTTPINDEXNEEDLE actual user file');
 const app=await(await import('../../src/main')).createApp();
 try{
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const invoke=(user:string,body:unknown={},tenant:string=org)=>fetch(`${base}/artifact-versions/${file.versionId}/index`,{method:'POST',headers:{'content-type':'application/json','x-kernel-test-principal':`${user}:${tenant}`},body:JSON.stringify(body)});
  expect((await invoke('viewer')).status).toBe(404);expect((await invoke('outsider')).status).toBe(404);
  expect((await invoke('publisher',{},'foreign-org')).status).toBe(404);
  expect((await invoke('publisher',{orgId:'foreign-org'})).status).toBe(400);
  const pii=await upload('PIINEEDLE contact alice@example.com');
  const pending=await fetch(`${base}/artifact-versions/${pii.versionId}/index`,{method:'POST',headers:{'content-type':'application/json','x-kernel-test-principal':`publisher:${org}`},body:'{}'});
  expect(pending.status).toBe(200);expect(await pending.json()).toEqual({artifactVersionId:pii.versionId,status:'review_pending'});
  expect(await knowledge.search(actor,'PIINEEDLE')).toEqual([]);
  const response=await invoke('publisher');expect(response.status).toBe(200);expect(await response.json()).toEqual({artifactVersionId:file.versionId,status:'ready'});
  expect((await knowledge.search(actor,'HTTPINDEXNEEDLE'))[0]?.row.artifactVersionId).toBe(file.versionId);
  await asApp(org,c=>c.query('DELETE FROM project_memberships WHERE org_id=$1 AND project_id=$2 AND user_id=$3',[org,project,'publisher']));
  expect((await invoke('publisher')).status).toBe(404);await addProjectMember(org,project,'publisher','member',null);
 }finally{await app.close();for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

it('structural review refuses unknown version and missing real derived bytes',async()=>{
 const gate=new StructuralArtifactReviewGate(artifacts,objects,new PgArtifactIndexTargets(db),{repo:new PgIdentityRepository(db),ids});
 await expect(gate.needsReview({orgId:org,artifactVersionId:'missing'})).rejects.toThrow('artifact_review_unavailable');
 const file=await upload('REVIEWMISSINGNEEDLE original source');
 // Version-specific replay avoids consuming another artifact's pending human-review job.
 const {replayIngestionRun}=await import('../../src/application/files/ingestion-worker');
 await replayIngestionRun({outbox,artifacts,store:objects,ids,indexer},org,file.versionId,'extract-only');
 const derived=(await artifacts.listDerived(org,file.artifactId)).find(d=>d.derivedFrom===file.versionId)!;
 expect(derived.objectStorageKey).not.toBeNull();await rm(resolveObjectPath(root,derived.objectStorageKey!));
 await expect(gate.needsReview({orgId:org,artifactVersionId:file.versionId})).rejects.toThrow('artifact_review_unavailable');
});


it('real artifact accounting serializes conflicting starts and preserves the original owner after revocation',async()=>{
 vi.stubEnv('KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED','1');vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','0');vi.stubEnv('KERNEL_MODEL_PROVIDER','pg-accounting-provider');vi.stubEnv('KERNEL_EMBEDDING_MODEL_ID','pg-embedding');
 let membershipRemoved=false;
 try{
  const file=await upload('ACCOUNTINGRACENEEDLE original source');
  const {replayIngestionRun}=await import('../../src/application/files/ingestion-worker');
  for(let i=0;i<7;i++){const tick=await replayIngestionRun({outbox,artifacts,store:objects,ids,indexer},org,file.versionId,'accounting-fixture');if(!tick.claimed)break;}
  expect(await outbox.findByVersion(org,file.versionId)).toBeNull();
  const batch=await indexSource.load({orgId:org,artifactVersionId:file.versionId}),accounting=new PgArtifactEmbeddingAccounting(db);
  const first=await accounting.open({orgId:org,artifactVersionId:file.versionId,requestedBy:'publisher'},batch);
  const second=await accounting.open({orgId:org,artifactVersionId:file.versionId,requestedBy:'publisher'},batch);
  const request={requestId:randomUUID(),modelId:'pg-embedding',startedAt:new Date().toISOString()};
  const results=await Promise.allSettled([accounting.start(org,first.operationId,request),accounting.start(org,second.operationId,request)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  const winner=results[0]!.status==='fulfilled'?first:second;
  expect((await asApp(org,c=>c.query('SELECT user_id,run_id,execution_attempt_id,artifact_operation_id FROM model_request_starts WHERE id=$1',[request.requestId]))).rows).toEqual([{user_id:'publisher',run_id:null,execution_attempt_id:null,artifact_operation_id:winner.operationId}]);
  await asApp(org,c=>c.query('DELETE FROM project_memberships WHERE org_id=$1 AND project_id=$2 AND user_id=$3',[org,project,'publisher']));membershipRemoved=true;
  await expect(accounting.start(org,winner.operationId,{...request,requestId:randomUUID()})).rejects.toBeInstanceOf(ArtifactEmbeddingOwnershipDenied);
  await accounting.terminal(org,winner.operationId,{requestId:request.requestId,endedAt:new Date().toISOString(),outcome:'failed',usage:{prompt:4,total:4}});
  expect((await asApp(org,c=>c.query('SELECT user_id,run_id,tokens_prompt,tokens_total FROM token_usage_events WHERE id=$1',[request.requestId]))).rows).toEqual([{user_id:'publisher',run_id:null,tokens_prompt:'4',tokens_total:'4'}]);
 }finally{try{if(membershipRemoved)await addProjectMember(org,project,'publisher','member',null);}finally{vi.unstubAllEnvs();}}
});

it('valid foreign artifact operation cannot acknowledge a globally colliding hidden request ID',async()=>{
 vi.stubEnv('KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED','1');vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','0');vi.stubEnv('KERNEL_MODEL_PROVIDER','pg-accounting-provider');vi.stubEnv('KERNEL_EMBEDDING_MODEL_ID','pg-embedding');
 const foreign=toOrgId('foreign-accounting-'+randomUUID()),foreignProject='project-'+foreign;
 try{
  const file=await upload('ACCOUNTINGCOLLISIONNEEDLE original');
  const {replayIngestionRun}=await import('../../src/application/files/ingestion-worker');
  for(let i=0;i<7;i++){const tick=await replayIngestionRun({outbox,artifacts,store:objects,ids,indexer},org,file.versionId,'collision-worker');if(!tick.claimed)break;}
  expect(await outbox.findByVersion(org,file.versionId)).toBeNull();
  const accounting=new PgArtifactEmbeddingAccounting(db),batch=await indexSource.load({orgId:org,artifactVersionId:file.versionId});
  const original=await accounting.open({orgId:org,artifactVersionId:file.versionId},batch);
  const request={requestId:randomUUID(),modelId:'pg-embedding',startedAt:new Date().toISOString()};await accounting.start(org,original.operationId,request);
  await seedOrg({orgId:foreign,projectId:foreignProject});await addOrgMember(foreign,'foreign-publisher','consultant',null);await addProjectMember(foreign,foreignProject,'foreign-publisher','member',null);
  const result=await uploadArtifact({store:objects,repo:artifacts,ids,quarantine:new PgQuarantineRepository(db),alerts:{raise:async()=>{}}},{orgId:foreign,projectId:foreignProject,agendaSegmentId:null,confidential:false,actorId:'foreign-publisher',files:[{filename:'foreign.txt',bytes:Buffer.from('FOREIGNACCOUNTING original')}]});
  const foreignFile=result.files[0]!;if(foreignFile.status!=='accepted')throw new Error('foreign upload rejected');
  for(let i=0;i<7;i++){const tick=await runIngestionWorkerTick({outbox,artifacts,store:objects,ids,indexer},foreign,'foreign-worker');if(!tick.claimed)break;}
  expect(await outbox.findByVersion(foreign,foreignFile.versionId)).toBeNull();
  const foreignBatch=await indexSource.load({orgId:foreign,artifactVersionId:foreignFile.versionId});
  const other=await accounting.open({orgId:foreign,artifactVersionId:foreignFile.versionId},foreignBatch);
  // Distinct ID proves the foreign operation is valid; the denial below is a global
  // start collision behind RLS, rather than a nonexistent or unauthorized source.
  await accounting.start(foreign,other.operationId,{...request,requestId:randomUUID()});
  await expect(accounting.start(foreign,other.operationId,request)).rejects.toBeInstanceOf(ArtifactEmbeddingOwnershipDenied);
  expect((await asApp(foreign,c=>c.query('SELECT id FROM model_request_starts WHERE id=$1',[request.requestId]))).rows).toEqual([]);
  expect((await asApp(org,c=>c.query('SELECT user_id,artifact_operation_id FROM model_request_starts WHERE id=$1',[request.requestId]))).rows).toEqual([{user_id:'publisher',artifact_operation_id:original.operationId}]);
 }finally{try{await resetOrgs(foreign);}finally{vi.unstubAllEnvs();}}
});

it('real input-only artifact admission serializes per-user budgets and keeps unknown holds and immutable prices',async()=>{
 const quotaOrg=toOrgId('input-only-artifact-'+randomUUID()),quotaProject='project-'+quotaOrg;
 vi.stubEnv('KERNEL_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED','1');vi.stubEnv('KERNEL_AI_PRODUCT_QUOTA_ENABLED','1');
 try{
  await seedOrg({orgId:quotaOrg,projectId:quotaProject});await addOrgMember(quotaOrg,'quota-publisher','consultant',null);await addProjectMember(quotaOrg,quotaProject,'quota-publisher','member',null);
  const uploaded=await uploadArtifact({store:objects,repo:artifacts,ids,quarantine:new PgQuarantineRepository(db),alerts:{raise:async()=>{}}},{orgId:quotaOrg,projectId:quotaProject,agendaSegmentId:null,confidential:false,actorId:'quota-publisher',files:[{filename:'quota.txt',bytes:Buffer.from('INPUTONLY real source')}]});
  const file=uploaded.files[0]!;if(file.status!=='accepted')throw new Error('quota upload rejected');
  const {replayIngestionRun}=await import('../../src/application/files/ingestion-worker');
  for(let i=0;i<7;i++){const tick=await replayIngestionRun({outbox,artifacts,store:objects,ids,indexer},quotaOrg,file.versionId,'input-only-worker');if(!tick.claimed)break;}
  expect(await outbox.findByVersion(quotaOrg,file.versionId)).toBeNull();
  const window={start:new Date(Date.now()-60000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),timezone:'Etc/UTC'};
  const configuration={window,ordinaryTokensPerUser:'2',costMicrosPerUser:'4',currency:'CNY',prices:[{billingMode:'input-only' as const,modelId:'fixture-formal',modelProvider:'fixture-route',runtimeModelId:'fixture-embed',inputMicrosPerMillion:'1000000',cachedInputMicrosPerMillion:'1000000',maxInputTokens:10}],fallbackModelIds:[],maxAttempts:1};
  const priceVersion='input-price-'+randomUUID();
  await asApp(quotaOrg,async c=>{
   await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'ordinary',1,$2)",[quotaOrg,'quota-publisher']);
   await c.query('INSERT INTO organization_ai_policy_changes(id,org_id,version,configuration,price_version,actor_id,reason) VALUES($1,$2,1,$3::jsonb,$4,$5,$6)',[randomUUID(),quotaOrg,JSON.stringify(configuration),priceVersion,'quota-publisher','isolated input-only acceptance fixture']);
   await c.query('INSERT INTO organization_ai_policies(org_id,version,configuration,price_version,updated_by) VALUES($1,1,$2::jsonb,$3,$4)',[quotaOrg,JSON.stringify(configuration),priceVersion,'quota-publisher']);
  });
  const registry=new VerifiedInputOnlyBoundRegistry([{binding:{billingMode:'input-only',modelId:'fixture-formal',modelProvider:'fixture-route',runtimeModelId:'fixture-embed',contextWindow:100,capabilityTags:['embedding'],noBilledOutputVerified:true,accountingComplete:true},requestPath:'/v1/embeddings',implementation:'test-measurer',version:'1',artifactSha256:'a'.repeat(64),source:'verified-upper-bound',verifyDeploymentBinding:async()=>true,measureSerializedBody:async()=>2}]);
  const pool={listForOrg:async()=>[{row:{modelId:'fixture-formal',kind:'closed-api',shape:'single',status:'已启用',complianceAttrs:[],members:[],contextWindow:100,capabilityTags:['embedding']}}]};
  const accounting=new PgArtifactEmbeddingAccounting(db,{provider:'fixture-route',primaryModelId:id=>registry.formalModelId('fixture-route',id),dependencies:()=>({currentCandidates:()=>registry.currentCandidates(pool as never,String(quotaOrg)),measure:request=>registry.measure(request)})});
  const batch=await indexSource.load({orgId:quotaOrg,artifactVersionId:file.versionId});
  const first=await accounting.open({orgId:quotaOrg,artifactVersionId:file.versionId},batch),second=await accounting.open({orgId:quotaOrg,artifactVersionId:file.versionId},batch);
  const serializedBody=JSON.stringify({model:'fixture-embed',input:[batch.segments[0]!.content]}),requestPath='/v1/embeddings';
  const request=(operationId:string)=>{const requestId=randomUUID();return {billingMode:'input-only' as const,requestId,modelId:'fixture-embed',startedAt:new Date().toISOString(),serializedBody,requestPath,logicalCallId:JSON.stringify([operationId,'retrieval-embedding',requestId,createHash('sha256').update(serializedBody).digest('hex'),requestPath])};};
  // Actual source proof precedes quota/reservation: valid operation authority alone
  // cannot classify unrelated or transformed model inputs as non-confidential.
  const expectedHashes=batch.segments.map(segment=>createHash('sha256').update(segment.content).digest('hex'));
  expect((await asApp(quotaOrg,c=>c.query('SELECT input_hashes FROM artifact_embedding_operations WHERE id=$1',[first.operationId]))).rows).toEqual([{input_hashes:expectedHashes}]);
  for(const body of [JSON.stringify({model:'fixture-embed',input:['unrelated private content']}),JSON.stringify({model:'fixture-embed',input:[[23,45]]}),JSON.stringify({model:'fixture-embed',input:[batch.segments[0]!.content],private:'extra source'})]){
   const denied={...request(first.operationId),serializedBody:body};denied.logicalCallId=JSON.stringify([first.operationId,'retrieval-embedding',denied.requestId,createHash('sha256').update(body).digest('hex'),requestPath]);
   await expect(accounting.admit(quotaOrg,first.operationId,denied)).rejects.toThrow('AI_ARTIFACT_WHOLE_INPUT_UNPROVEN');
   expect((await asApp(quotaOrg,c=>c.query('SELECT id FROM ai_request_reservations WHERE id=$1',[denied.requestId]))).rows).toEqual([]);
   expect((await asApp(quotaOrg,c=>c.query('SELECT id FROM model_request_starts WHERE id=$1',[denied.requestId]))).rows).toEqual([]);
  }
  const legacyId=randomUUID();
  await asApp(quotaOrg,c=>c.query('INSERT INTO artifact_embedding_operations(id,org_id,user_id,artifact_id,artifact_version_id,project_id,content_hash,ingestion_job_id,ingestion_attempt) SELECT $1,org_id,user_id,artifact_id,artifact_version_id,project_id,content_hash,ingestion_job_id,ingestion_attempt FROM artifact_embedding_operations WHERE id=$2',[legacyId,first.operationId]));
  await expect(accounting.admit(quotaOrg,legacyId,request(legacyId))).rejects.toThrow('AI_ARTIFACT_WHOLE_INPUT_UNPROVEN');
  expect((await asApp(quotaOrg,c=>c.query('SELECT id FROM ai_request_reservations WHERE org_id=$1',[quotaOrg]))).rows).toEqual([]);
  expect((await asApp(quotaOrg,c=>c.query('SELECT id FROM model_request_starts WHERE org_id=$1',[quotaOrg]))).rows).toEqual([]);
  await expect(asApp(quotaOrg,c=>c.query('UPDATE artifact_embedding_operations SET input_hashes=$2::jsonb WHERE id=$1',[first.operationId,'[]']))).rejects.toThrow();
  expect((await asApp(quotaOrg,c=>c.query('SELECT input_hashes FROM artifact_embedding_operations WHERE id=$1',[first.operationId]))).rows).toEqual([{input_hashes:expectedHashes}]);
  const a=request(first.operationId),b=request(second.operationId),results=await Promise.allSettled([accounting.admit(quotaOrg,first.operationId,a),accounting.admit(quotaOrg,second.operationId,b)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  const winner=results[0]!.status==='fulfilled'?{ref:first,request:a}:{ref:second,request:b};
  const starts=await asApp(quotaOrg,c=>c.query('SELECT id,user_id,run_id,execution_attempt_id FROM model_request_starts WHERE org_id=$1',[quotaOrg]));expect(starts.rows).toEqual([{id:winner.request.requestId,user_id:'quota-publisher',run_id:null,execution_attempt_id:null}]);
  await accounting.terminal(quotaOrg,winner.ref.operationId,{requestId:winner.request.requestId,endedAt:new Date().toISOString(),outcome:'failed',usage:{}});
  const third=await accounting.open({orgId:quotaOrg,artifactVersionId:file.versionId},batch);await expect(accounting.admit(quotaOrg,third.operationId,request(third.operationId))).rejects.toThrow();
  expect((await asApp(quotaOrg,c=>c.query('SELECT state FROM ai_request_reservations WHERE id=$1',[winner.request.requestId]))).rows).toEqual([{state:'held'}]);
  // Entitlement exemption does not rewrite the user's original finite cost window.
  await asApp(quotaOrg,c=>c.query("UPDATE organization_plans SET plan='enterprise' WHERE org_id=$1",[quotaOrg]));
  const enterprise=await accounting.open({orgId:quotaOrg,artifactVersionId:file.versionId},batch),paid=request(enterprise.operationId);await accounting.admit(quotaOrg,enterprise.operationId,paid);
  const excess=await accounting.open({orgId:quotaOrg,artifactVersionId:file.versionId},batch),denied=request(excess.operationId);await expect(accounting.admit(quotaOrg,excess.operationId,denied)).rejects.toThrow('COST_LIMIT_REACHED');
  expect((await asApp(quotaOrg,c=>c.query('SELECT id FROM model_request_starts WHERE id=$1',[denied.requestId]))).rows).toEqual([]);
  expect((await asApp(quotaOrg,c=>c.query('SELECT id FROM ai_request_reservations WHERE id=$1',[denied.requestId]))).rows).toEqual([]);
  expect((await asApp(quotaOrg,c=>c.query('SELECT token_limit,cost_limit_micros FROM ai_budget_windows WHERE org_id=$1',[quotaOrg]))).rows).toEqual([{token_limit:'2',cost_limit_micros:'4'}]);
  const replacement={...configuration,prices:configuration.prices.map(price=>({...price,inputMicrosPerMillion:'2000000',cachedInputMicrosPerMillion:'2000000'}))};
  // Adversarial current-row fixture: public audited configuration normally rejects overlapping reset.
  await asApp(quotaOrg,c=>c.query('UPDATE organization_ai_policies SET configuration=$2::jsonb WHERE org_id=$1',[quotaOrg,JSON.stringify(replacement)]));
  await accounting.terminal(quotaOrg,enterprise.operationId,{requestId:paid.requestId,endedAt:new Date().toISOString(),outcome:'succeeded',usage:{prompt:2,total:2}});
  expect((await asApp(quotaOrg,c=>c.query('SELECT tokens_total,tokens_prompt,tokens_completion,cost_micros,currency,price_version,user_id FROM token_usage_events WHERE id=$1',[paid.requestId]))).rows).toEqual([{tokens_total:'2',tokens_prompt:'2',tokens_completion:null,cost_micros:'2',currency:'CNY',price_version:priceVersion,user_id:'quota-publisher'}]);
  expect((await asApp(quotaOrg,c=>c.query('SELECT state,settled_tokens,settled_cost_micros FROM ai_request_reservations WHERE id=$1',[paid.requestId]))).rows).toEqual([{state:'settled',settled_tokens:'2',settled_cost_micros:'2'}]);
  expect((await asApp(org,c=>c.query('SELECT id FROM token_usage_events WHERE id=$1',[paid.requestId]))).rows).toEqual([]);
 }finally{try{await resetOrgs(quotaOrg);}finally{vi.unstubAllEnvs();}}
});
