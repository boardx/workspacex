/** Main-session only, real PostgreSQL + FsObjectStore acceptance. No simulated SQL.
 * This is a synthetic storage fixture, NOT evidence of real model inference. */
import { randomUUID,createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir,readFile,writeFile,stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import * as Y from 'yjs';
import { WhiteboardAIProposal } from '@repo/contracts/whiteboard-operation';
import { readObjects,createWhiteboardDocument } from '@repo/whiteboard-core';
import { PgDatabase } from '../src/infrastructure/db/pg-database';
import { appConfig,migrationConfig } from '../src/infrastructure/db/pg-config';
import { FsObjectStore } from '../src/infrastructure/storage/fs-object-store';
import { PgWhiteboardRepository } from '../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardCollaborationStore } from '../src/infrastructure/whiteboard/pg-collaboration-store';
import { WorkerWhiteboardUpdateValidator } from '../src/infrastructure/whiteboard/update-validator';
import { PgWhiteboardOperationRepository } from '../src/infrastructure/whiteboard/pg-operation-repository';
import { PgWhiteboardOperationUndoStore } from '../src/infrastructure/whiteboard/pg-operation-undo-store';
import { PgWhiteboardProposalRepository } from '../src/infrastructure/whiteboard/pg-proposal-repository';
import { WhiteboardOperationService } from '../src/application/whiteboard/operation-service';
import { WhiteboardProposalService } from '../src/application/whiteboard/proposal-service';
import { toOrgId } from '../src/domain/org-id';
import type { Principal } from '../src/domain/principal';
import { assertProposalDatabaseBinding,requireNotFound,assertProposalStorageDrill,assertRestoredDatabase,requireEvidence,proposalDrillFailure } from './board-proposal-storage-drill-guards';
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const textBefore='SYNTHETIC_ORIGINAL_PROPOSAL_TEXT',textAfter='SYNTHETIC_AI_PROPOSAL_TEXT',textFinal='SYNTHETIC_GENERIC_OPERATION_TEXT';
let stage='preflight';
function services(db:PgDatabase,objects:FsObjectStore){
 const validator=new WorkerWhiteboardUpdateValidator(),collaboration=new PgWhiteboardCollaborationStore(db,validator,120,objects),audit=new PgWhiteboardOperationRepository(),undoStore=new PgWhiteboardOperationUndoStore(collaboration,objects),operations=new WhiteboardOperationService(db,collaboration,audit,undefined,objects,validator,undoStore),repository=new PgWhiteboardProposalRepository(objects),proposals=new WhiteboardProposalService(db,collaboration,audit,repository,operations);
 return{collaboration,audit,undoStore,operations,repository,proposals};
}
async function canonicalText(store:PgWhiteboardCollaborationStore,p:Principal,boardId:string){
 const state=await store.load(p,boardId),doc=createWhiteboardDocument();
 try{Y.applyUpdate(doc,state.update);return{revision:{epoch:state.epoch,seq:state.seq},text:readObjects(doc).find(o=>o.id==='storage-drill-note')?.text};}finally{doc.destroy();}
}
async function proposalReferences(db:PgDatabase,objects:FsObjectStore,p:Principal,boardId:string){
 const result=await db.withTenant(p.orgId,s=>s.query<{proposal_id:string;empty:boolean;object_key:string;content_hash:string;byte_size:string}>(`SELECT proposal_id,payload='{}'::jsonb AS empty,object_key,content_hash,byte_size::text FROM whiteboard_ai_proposals WHERE org_id=$1 AND board_id=$2 ORDER BY proposal_id`,[p.orgId,boardId]));
 requireEvidence(result.rows.length>=3,'MISSING_PROPOSALS');
 for(const row of result.rows){
  requireEvidence(row.empty&&row.object_key&&/^[a-f0-9]{64}$/.test(row.content_hash),'PG_BODY_REGRESSION');
  const [bytes,head]=await Promise.all([objects.get(row.object_key),objects.head(row.object_key)]);
  requireEvidence(bytes&&head&&bytes.length===Number(row.byte_size)&&head.sizeBytes===bytes.length&&head.mime==='application/json'&&hash(bytes)===row.content_hash,'PROPOSAL_BLOB_MISMATCH');
 }
 return result.rows.map(row=>({proposalId:row.proposal_id,key:row.object_key,hash:row.content_hash,bytes:Number(row.byte_size)}));
}
async function main(){
 assertProposalStorageDrill(process.env);
 const apiDir=resolve(__dirname,'..'),jointScript=join(apiDir,'scripts/board-joint-recovery-drill.ts');
 requireEvidence(existsSync(jointScript),'R8_JOINT_RECOVERY_REQUIRED');
 const directory=resolve(process.env.BOARD_PROPOSAL_DRILL_DIRECTORY!);await mkdir(directory,{mode:0o700});
 requireEvidence(((await stat(directory)).mode&0o077)===0,'PRIVATE_DRILL_DIRECTORY_REQUIRED');
 const primaryRoot=join(directory,'primary'),jointRoot=join(directory,'joint');await mkdir(primaryRoot,{mode:0o700});
 stage='verify-database-binding';
 const container=execFileSync('docker',['compose','-f',join(apiDir,'docker-compose.dev.yml'),'-p',process.env.COMPOSE_PROJECT_NAME!,'ps','-q','postgres'],{encoding:'utf8'}).trim();
 requireEvidence(/^[a-f0-9]{12,64}$/.test(container),'CONTAINER_OWNERSHIP_MISMATCH');
 // Select only non-secret inspect fields; never collect container environment.
 const inspected=JSON.parse(execFileSync('docker',['inspect','--format','{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"ports":{{json (index .NetworkSettings.Ports "5432/tcp")}}}',container],{encoding:'utf8'}));
 assertProposalDatabaseBinding(process.env,resolve(apiDir,'../..'),{...inspected,id:container,ports:inspected.ports??[]},[appConfig(),migrationConfig()]);
 // Import official helpers only after container/connection verification succeeds.
 const {ensureDatabase,migrateOnce,seedOrg,addOrgMember}=await import('../tests/support/db');
 stage='migrate-fixture';ensureDatabase();
 await migrateOnce();
 const orgId=toOrgId(`proposal-drill-${randomUUID()}`),owner=`proposal-owner-${randomUUID()}`,actorId=`storage-fixture-agent-${randomUUID()}`,p={orgId,userId:owner};
 await seedOrg({orgId,projectId:`proposal-project-${randomUUID()}`});await addOrgMember(orgId,owner,'consultant',null);
 const db=new PgDatabase(appConfig()),admin=new PgDatabase(migrationConfig()),objects=new FsObjectStore(primaryRoot);
 let boardId='',proposalId='',genericOperationId='',genericRevision={epoch:1,seq:0},confirmedDigest='',beforeHash='',references:Awaited<ReturnType<typeof proposalReferences>>=[];
 try{
  const s=services(db,objects);stage='create-fixture';
  boardId=(await new PgWhiteboardRepository(db).create(p,{requestId:randomUUID(),name:'Synthetic proposal storage acceptance'})).id;
  await admin.withTenant(orgId,t=>t.query(`INSERT INTO whiteboard_actor_identities(org_id,actor_id,kind,delegated_by,scopes,model_snapshot,skill_snapshot) VALUES($1,$2,'ai',$3,ARRAY['board:read','board:write'],'storage-fixture/no-model','storage-fixture/skill')`,[orgId,actorId,owner]));
  await s.collaboration.writeCommands(p,boardId,{epoch:1,requestId:randomUUID(),commands:[{type:'create',object:{id:'storage-drill-note',schemaVersion:1,kind:'sticky',text:textBefore,parentId:null,orderKey:'a',geometry:{x:0,y:0,width:180,height:180,rotation:0},style:{}}}]});
  const confirm=async()=>{
   const current=await canonicalText(s.collaboration,p,boardId),id=randomUUID();
   await s.proposals.create(p,boardId,{proposalId:id,actorId,baseRevision:current.revision,action:{type:'generate',commands:[{type:'text',id:'storage-drill-note',index:0,deleteCount:current.text!.length,insert:textAfter}]},provenance:{source:'ai-proposal',model:'storage-fixture/no-model',skill:'storage-fixture/skill'}});
   const result=await s.proposals.confirmWithUndo(p,boardId,id,{requestId:randomUUID(),expectedRevision:current.revision});
   requireEvidence((await canonicalText(s.collaboration,p,boardId)).text===textAfter,'CONFIRMATION_NOT_APPLIED');
   return{id,result};
  };
  stage='proposal-confirm-undo';const first=await confirm();
  await s.proposals.undo(p,boardId,first.id,{requestId:randomUUID(),expectedRevision:first.result.revision});
  requireEvidence((await canonicalText(s.collaboration,p,boardId)).text===textBefore,'PROPOSAL_UNDO_NOT_APPLIED');
  const confirmed=await confirm();proposalId=confirmed.id;
  const saved=await s.proposals.read(p,boardId,proposalId);confirmedDigest=hash(JSON.stringify(saved));
  requireEvidence(saved.undoReceipt?.commands.some(c=>c.type==='text'&&c.insert===textBefore),'UNDO_TEXT_NOT_RETAINED');
  stage='generic-operation';
  const generic=await s.operations.execute(p,boardId,{apiVersion:'2026-09-01',requestId:randomUUID(),boardId,expectedRevision:confirmed.result.revision,actor:{kind:'human',actorId:owner,orgId,role:'owner',scopes:['board:write'],delegatedBy:null},commands:[{type:'text',id:'storage-drill-note',index:0,deleteCount:textAfter.length,insert:textFinal}],provenance:{source:'human'}});
  genericOperationId=generic.operationId;genericRevision=generic.revision;
  const prior=await db.withTenant(orgId,t=>s.undoStore.get(t,p,boardId,genericOperationId));requireEvidence(prior,'MISSING_GENERIC_UNDO');
  beforeHash=hash(await s.undoStore.readBefore(p,boardId,prior.before));
  requireEvidence((await canonicalText(s.collaboration,p,boardId)).text===textFinal,'GENERIC_OPERATION_NOT_APPLIED');
  stage='seed-legacy';
  const legacy=WhiteboardAIProposal.parse({...saved,proposalId:randomUUID()});
  // Fixture-only historical row: restore the exact catalog constraint before COMMIT.
  // The isolated owner role performs DDL; no runtime grants or product checks change.
  await admin.withTenant(orgId,async t=>{
   const constraint=await t.query<{definition:string}>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='whiteboard_ai_proposals'::regclass AND conname='whiteboard_proposal_body_ref'`);
   requireEvidence(constraint.rows.length===1,'BODY_CONSTRAINT_MISSING');
   await t.query('ALTER TABLE whiteboard_ai_proposals DROP CONSTRAINT whiteboard_proposal_body_ref');
   await t.query(`INSERT INTO whiteboard_ai_proposals(org_id,board_id,proposal_id,owner_user_id,actor_id,request_hash,status,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,[orgId,boardId,legacy.proposalId,owner,actorId,'a'.repeat(64),legacy.status,JSON.stringify(legacy),legacy.expiresAt]);
   await t.query(`ALTER TABLE whiteboard_ai_proposals ADD CONSTRAINT whiteboard_proposal_body_ref ${constraint.rows[0]!.definition.replace(/\s+NOT VALID$/i,'')} NOT VALID`);
  });
  stage='legacy-rollback';let rollbackObserved=false,rolledBackKey='';
  try{await db.withTenant(orgId,async t=>{
   requireEvidence(await s.audit.lockHead(t,p,boardId),'BOARD_ACCESS_LOST');
   const migrated=await s.repository.lock(t,p,boardId,legacy.proposalId);requireEvidence(migrated,'LEGACY_NOT_LOADED');
   const row=await t.query<{empty:boolean;object_key:string}>(`SELECT object_key,payload='{}'::jsonb AS empty FROM whiteboard_ai_proposals WHERE org_id=$1 AND board_id=$2 AND proposal_id=$3`,[orgId,boardId,legacy.proposalId]);requireEvidence(row.rows[0]?.empty,'LEGACY_NOT_MIGRATED_IN_TRANSACTION');rolledBackKey=row.rows[0]!.object_key;
   throw Error('INTENTIONAL_MIGRATION_ROLLBACK');
  });}catch(error){if(error instanceof Error&&error.message==='INTENTIONAL_MIGRATION_ROLLBACK')rollbackObserved=true;else throw error;}
  requireEvidence(rollbackObserved,'ROLLBACK_NOT_OBSERVED');
  const retained=await db.withTenant(orgId,t=>t.query<{payload:unknown;object_key:string|null}>(`SELECT payload,object_key FROM whiteboard_ai_proposals WHERE org_id=$1 AND board_id=$2 AND proposal_id=$3`,[orgId,boardId,legacy.proposalId]));
  requireEvidence(retained.rows[0]?.object_key===null&&hash(JSON.stringify(WhiteboardAIProposal.parse(retained.rows[0].payload)))===hash(JSON.stringify(legacy)),'LEGACY_ROLLBACK_LOST_BODY');
  const rolledBackRoots=await db.withTenant(orgId,t=>t.query<{count:string}>(`SELECT count(*)::text AS count FROM whiteboard_asset_refs WHERE org_id=$1 AND board_id=$2 AND object_key=$3`,[orgId,boardId,rolledBackKey]));
  requireEvidence(rolledBackKey&&rolledBackRoots.rows[0]?.count==='0'&&await objects.get(rolledBackKey),'LEGACY_ROOT_ROLLBACK_FAILED');
  stage='legacy-retry';requireEvidence(hash(JSON.stringify(await s.proposals.read(p,boardId,legacy.proposalId)))===hash(JSON.stringify(legacy)),'LEGACY_RETRY_CHANGED_BODY');
  references=await proposalReferences(db,objects,p,boardId);
  stage='reject-plaintext-writer';let oldWriterRejected=false;
  try{await db.withTenant(orgId,t=>t.query(`INSERT INTO whiteboard_ai_proposals(org_id,board_id,proposal_id,owner_user_id,actor_id,request_hash,status,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,'preview',$7::jsonb,$8)`,[orgId,boardId,randomUUID(),owner,actorId,'b'.repeat(64),JSON.stringify(legacy),legacy.expiresAt]));}
  catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='23514')oldWriterRejected=true;else throw error;}
  requireEvidence(oldWriterRejected,'PLAINTEXT_WRITER_NOT_REJECTED');
 }finally{await db.close();await admin.close();}
 stage='joint-pg-fs-recovery';
 execFileSync('pnpm',['exec','tsx',jointScript,orgId,owner,boardId],{cwd:apiDir,env:{...process.env,BOARD_JOINT_DRILL:'1',STARTER_POSTGRES_CONTAINER:container,BOARD_OBJECT_ROOT:primaryRoot,BOARD_DRILL_DIRECTORY:jointRoot},stdio:'inherit',timeout:300000});
 const joint=JSON.parse(await readFile(join(jointRoot,'evidence.json'),'utf8')) as {targetDatabase:unknown;boardId:string;targetRoot:string;manifestHash:string;pgDumpHash:string;restored:{sourceHistoryBlobCount:number}};
 assertRestoredDatabase(joint.targetDatabase);requireEvidence(joint.restored.sourceHistoryBlobCount>0,'EMPTY_SOURCE_HISTORY');
 requireEvidence(resolve(joint.targetRoot)===join(jointRoot,'restored-objects'),'INVALID_RESTORED_OBJECT_ROOT');
 const restoredDb=new PgDatabase({...appConfig(),database:joint.targetDatabase}),restoredObjects=new FsObjectStore(joint.targetRoot);
 try{
  stage='verify-restored-proposal';const s=services(restoredDb,restoredObjects);
  const hydrated=await s.proposals.read(p,boardId,proposalId);requireEvidence(hash(JSON.stringify(hydrated))===confirmedDigest,'RESTORED_PROPOSAL_CHANGED');
  const restoredRefs=await proposalReferences(restoredDb,restoredObjects,p,boardId);requireEvidence(JSON.stringify(restoredRefs)===JSON.stringify(references),'RESTORED_PROPOSAL_REFS_CHANGED');
  const undo=await restoredDb.withTenant(orgId,t=>s.undoStore.get(t,p,boardId,genericOperationId));requireEvidence(undo,'RESTORED_UNDO_MISSING');
  requireEvidence(hash(await s.undoStore.readBefore(p,boardId,undo.before))===beforeHash,'RESTORED_UNDO_BEFORE_CHANGED');
  stage='verify-restored-undo';await s.operations.undo(p,boardId,genericOperationId,{expectedRevision:genericRevision});
  requireEvidence((await canonicalText(s.collaboration,p,boardId)).text===textAfter,'RESTORED_GENERIC_UNDO_NOT_APPLIED');
  stage='verify-new-board-isolation';
  const counts=await restoredDb.withTenant(orgId,t=>t.query<{proposals:string;undos:string;operations:string}>(`SELECT (SELECT count(*)::text FROM whiteboard_ai_proposals WHERE org_id=$1 AND board_id=$2) AS proposals,(SELECT count(*)::text FROM whiteboard_operation_undo WHERE org_id=$1 AND board_id=$2) AS undos,(SELECT count(*)::text FROM whiteboard_operations WHERE org_id=$1 AND board_id=$2) AS operations`,[orgId,joint.boardId]));
  requireEvidence(counts.rows[0]?.proposals==='0'&&counts.rows[0]?.undos==='0'&&counts.rows[0]?.operations==='0','OLD_AI_AUTHORITY_COPIED');
  requireEvidence((await canonicalText(s.collaboration,p,joint.boardId)).text===textFinal,'NEW_BOARD_CONTENT_CHANGED');
  stage='verify-portable-isolation';
  // R8 modules are resolved at runtime so this producer can be reviewed on R9
  // before the companion branch is integrated. They are real product adapters.
  const [{PortableBoardService},{PgPortableBoard},{PgBoardImageAssets},{WhiteboardImageAssets},{SharpBoardImageVerifier}]=await Promise.all([
   import(join(apiDir,'src/application/whiteboard/portable-board.ts')),
   import(join(apiDir,'src/infrastructure/whiteboard/pg-portable-board.ts')),
   import(join(apiDir,'src/infrastructure/whiteboard/pg-image-assets.ts')),
   import(join(apiDir,'src/application/whiteboard/image-assets.ts')),
   import(join(apiDir,'src/infrastructure/whiteboard/image-verifier.ts')),
  ]);
  const boards=new PgWhiteboardRepository(restoredDb),images=new PgBoardImageAssets(restoredDb),verifier=new SharpBoardImageVerifier();
  const portable=new PortableBoardService(boards,s.collaboration,new WorkerWhiteboardUpdateValidator(),new WhiteboardImageAssets(boards,images,restoredObjects,verifier),verifier,new PgPortableBoard(restoredDb,s.collaboration,restoredObjects,images));
  const bundle=await portable.export(p,boardId),portableBoard=(await boards.create(p,{requestId:randomUUID(),name:'Synthetic portable authority isolation'})).id;
  await portable.import(p,portableBoard,{requestId:randomUUID(),expectedEpoch:1,file:{sizeBytes:bundle.sizeBytes,sha256:bundle.sha256,contentBase64:bundle.contentBase64}});
  const portableCounts=await restoredDb.withTenant(orgId,t=>t.query<{proposals:string;undos:string;operations:string}>(`SELECT (SELECT count(*)::text FROM whiteboard_ai_proposals WHERE org_id=$1 AND board_id=$2) AS proposals,(SELECT count(*)::text FROM whiteboard_operation_undo WHERE org_id=$1 AND board_id=$2) AS undos,(SELECT count(*)::text FROM whiteboard_operations WHERE org_id=$1 AND board_id=$2) AS operations`,[orgId,portableBoard]));
  requireEvidence(portableCounts.rows[0]?.proposals==='0'&&portableCounts.rows[0]?.undos==='0'&&portableCounts.rows[0]?.operations==='0','PORTABLE_AI_AUTHORITY_COPIED');
  const portableState=await s.collaboration.load(p,portableBoard),portableDoc=createWhiteboardDocument();
  try{Y.applyUpdate(portableDoc,portableState.update);requireEvidence(readObjects(portableDoc).length===1&&readObjects(portableDoc)[0]?.text===textAfter,'PORTABLE_CONTENT_CHANGED');}finally{portableDoc.destroy();}
  stage='verify-portable-old-authority-rejected';
  const portableRevision={epoch:portableState.epoch,seq:portableState.seq};
  await requireNotFound(()=>s.proposals.read(p,portableBoard,proposalId));
  await requireNotFound(()=>s.proposals.undo(p,portableBoard,proposalId,{requestId:randomUUID(),expectedRevision:portableRevision}));
  await requireNotFound(()=>s.operations.undo(p,portableBoard,genericOperationId,{expectedRevision:portableRevision}));
  const unchanged=await s.collaboration.load(p,portableBoard);
  requireEvidence(unchanged.epoch===portableState.epoch&&unchanged.seq===portableState.seq&&hash(unchanged.update)===hash(portableState.update),'PORTABLE_REJECTED_AUTHORITY_MUTATED_CONTENT');
  const evidence={version:1,status:'passed',executedAt:new Date().toISOString(),scope:'synthetic-storage-fixture-not-model-inference',orgId,sourceBoardId:boardId,newBoardId:joint.boardId,portableBoardId:portableBoard,proposalId,genericOperationId,proposalCount:references.length,sourceHistoryBlobCount:joint.restored.sourceHistoryBlobCount,proposalDigest:confirmedDigest,undoBeforeHash:beforeHash,manifestHash:joint.manifestHash,pgDumpHash:joint.pgDumpHash,checks:{pgPayloadEmpty:true,verifiedProposalFiles:true,legacyRollbackObserved:true,legacyRootRolledBack:true,legacyRetryMigrated:true,plaintextWriterRejected:true,proposalUndoApplied:true,restoredProposalReadable:true,restoredUndoApplied:true,newBoardOldAuthorityRows:counts.rows[0],portableOldAuthorityRows:portableCounts.rows[0],portableOldAuthorityRequestsRejected:true},cleanup:'Isolated source/target DB and private drill directory retained for root inspection.'};
  await writeFile(join(directory,'proposal-storage-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await restoredDb.close();}
}
void main().catch(error=>{process.stderr.write(JSON.stringify(proposalDrillFailure(stage,error))+'\n');process.exitCode=1;});
