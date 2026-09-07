import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {beforeAll,afterAll,it,expect} from 'vitest';
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
