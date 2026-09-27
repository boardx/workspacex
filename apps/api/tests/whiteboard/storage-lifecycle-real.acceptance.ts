/** Real PG + filesystem acceptance. Run only on the main session's isolated test DB. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, readObjects, type WhiteboardCommand } from '@repo/whiteboard-core';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { PgWhiteboardRecoveryAdapter } from '../../src/infrastructure/whiteboard/pg-whiteboard-recovery';
import { WhiteboardRecoveryService } from '../../src/application/whiteboard/recovery-service';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';
import { PgWhiteboardCommentStore } from '../../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import { FsObjectStore } from '../../src/infrastructure/storage/fs-object-store';
import { toOrgId } from '../../src/domain/org-id';
import type { DatabasePort } from '../../src/application/ports/database.port';
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg, addOrgMember } from '../support/db';
const orgId=toOrgId('wb-storage-lifecycle-real'), owner={orgId,userId:'wb-storage-owner'};
let db:PgDatabase, fs:FsObjectStore, root:string, store:PgWhiteboardCollaborationStore;
const makeStore=(database:DatabasePort=db)=>new PgWhiteboardCollaborationStore(database,new WorkerWhiteboardUpdateValidator(),120,fs);
const note=(id:string,text='idea'):WhiteboardCommand=>({type:'create',object:{id,schemaVersion:1,kind:'sticky',text,style:{},parentId:null,orderKey:id,geometry:{x:0,y:0,width:100,height:100,rotation:0}}});
const board=()=>new PgWhiteboardRepository(db).create(owner,{name:'Storage acceptance',requestId:randomUUID()});
const write=(id:string,commands:WhiteboardCommand[],epoch=1)=>store.writeCommands(owner,id,{epoch,requestId:randomUUID(),commands});
async function canonical(id:string){const fresh=new PgDatabase(appConfig());try{const loaded=await makeStore(fresh).load(owner,id),doc=createWhiteboardDocument();try{Y.applyUpdate(doc,loaded.update);return{epoch:loaded.epoch,seq:loaded.seq,objects:readObjects(doc)};}finally{doc.destroy();}}finally{await fresh.close();}}
beforeAll(async()=>{
  if(!process.env.WORKSPACEX_ISOLATION_ID || !/^wsx_[a-f0-9]{20}$/.test(process.env.WORKSPACEX_DB??'') || process.env.PGDATABASE!==process.env.WORKSPACEX_DB || !['127.0.0.1','localhost','::1'].includes(process.env.PGHOST??'')) throw new Error('ISOLATED_LOCAL_STORAGE_ACCEPTANCE_REQUIRED');
  ensureDatabase();await migrateOnce();await resetOrgs(orgId);await seedOrg({orgId,projectId:'wb-storage-project'});await addOrgMember(orgId,owner.userId,'consultant',null);
  root=await mkdtemp(join(tmpdir(),'wb-storage-acceptance-'));fs=new FsObjectStore(root);db=new PgDatabase(appConfig());store=makeStore();
});
afterAll(async()=>{await db?.close();if(root){await resetOrgs(orgId);await rm(root,{recursive:true,force:true});}});
it('migrates actual legacy PG bodies, clears bytes, and is idempotent across a fresh connection',async()=>{
  const b=await board();await write(b.id,[note('legacy')]);const before=await canonical(b.id);
  await db.withTenant(orgId,async s=>{
    const docs=await s.query<{object_key:string}>('SELECT object_key FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[orgId,b.id]);
    const bytes=await fs.get(docs.rows[0]!.object_key);expect(bytes).not.toBeNull();
    await s.query('UPDATE whiteboard_documents SET snapshot=$3,object_key=NULL,content_hash=NULL,byte_size=NULL,manifest_version=NULL WHERE org_id=$1 AND board_id=$2',[orgId,b.id,Buffer.from(bytes!)]);
    const updates=await s.query<{update_object_key:string;seq:string}>('SELECT update_object_key,seq::text FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2',[orgId,b.id]);
    for(const u of updates.rows)await s.query('UPDATE whiteboard_updates SET update=$4,update_object_key=NULL,update_hash=NULL,update_size=NULL WHERE org_id=$1 AND board_id=$2 AND seq=$3',[orgId,b.id,u.seq,Buffer.from((await fs.get(u.update_object_key))!)]);
  });
  await store.load(owner,b.id);expect(await store.backfillLegacyBoard(owner,b.id)).toEqual({migrated:1,remaining:0});expect(await store.backfillLegacyBoard(owner,b.id)).toEqual({migrated:0,remaining:0});
  expect(await canonical(b.id)).toEqual(before);
  const migrated=await db.withTenant(orgId,s=>s.query<{body_null:boolean}>('SELECT snapshot IS NULL AND object_key IS NOT NULL body_null FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[orgId,b.id]));expect(migrated.rows[0]!.body_null).toBe(true);
  const bodies=await db.withTenant(orgId,s=>s.query<{n:string}>('SELECT count(*)::text n FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND (update IS NOT NULL OR update_object_key IS NULL)',[orgId,b.id]));expect(bodies.rows[0]!.n).toBe('0');
});
it('rolls back real PG writes after object publication without returning an ACK',async()=>{
  const b=await board();await write(b.id,[note('kept')]);const before=await canonical(b.id);
  const failing:DatabasePort={withTenant:(org,fn)=>db.withTenant(org,async s=>{await fn(s);throw new Error('INJECTED_BEFORE_COMMIT');}),withoutTenant:fn=>db.withoutTenant(fn),close:async()=>{}};
  await expect(makeStore(failing).writeCommands(owner,b.id,{epoch:1,requestId:randomUUID(),commands:[note('must-not-commit')]})).rejects.toThrow('INJECTED_BEFORE_COMMIT');
  expect(await canonical(b.id)).toEqual(before);await write(b.id,[note('after-rollback')]);expect((await canonical(b.id)).seq).toBe(before.seq+1);
});
it('measures metadata independently of body size and restores a real checkpoint into a writable epoch',async()=>{
  const samples:Array<{textBytes:number;pgRowBytes:number;objectBytes:number}>=[];
  for(const length of [100,10000]){
    const b=await board();await write(b.id,[note('sized','x'.repeat(length))]);
    const result=await db.withTenant(orgId,s=>s.query<{body_null:boolean;row_bytes:number;byte_size:string;object_key:string}>(`SELECT snapshot IS NULL body_null,pg_column_size(d) row_bytes,byte_size::text,object_key FROM whiteboard_documents d WHERE org_id=$1 AND board_id=$2`,[orgId,b.id]));
    const row=result.rows[0]!;expect(row.body_null).toBe(true);expect((await fs.get(row.object_key))!.byteLength).toBe(Number(row.byte_size));
    const updates=await db.withTenant(orgId,s=>s.query<{body_null:boolean;row_bytes:number}>('SELECT update IS NULL body_null,pg_column_size(u) row_bytes FROM whiteboard_updates u WHERE org_id=$1 AND board_id=$2',[orgId,b.id]));expect(updates.rows).toHaveLength(1);expect(updates.rows[0]!.body_null).toBe(true);
    samples.push({textBytes:length,pgRowBytes:row.row_bytes+updates.rows[0]!.row_bytes,objectBytes:Number(row.byte_size)});
  }
  expect(samples[1]!.objectBytes-samples[0]!.objectBytes).toBeGreaterThan(9000);expect(Math.abs(samples[1]!.pgRowBytes-samples[0]!.pgRowBytes)).toBeLessThan(128);
  console.info('BOARD_STORAGE_GROWTH',JSON.stringify(samples));
  const b=await board();await write(b.id,[note('recover-me')]);const before=await canonical(b.id),adapter=new PgWhiteboardRecoveryAdapter(db,store,fs),recovery=new WhiteboardRecoveryService(adapter,adapter,fs);
  const checkpoint=await recovery.createCheckpoint(owner,b.id,randomUUID());await write(b.id,[note('later')]);
  const restored=await recovery.restore(owner,b.id,checkpoint.manifest.checkpointId,randomUUID(),{epoch:1,seq:2});expect(restored.epoch).toBe(2);
  const current=await canonical(b.id);expect(current.objects).toEqual(before.objects);expect(current.seq).toBe(0);
  await write(b.id,[note('after-restore')],2);expect((await canonical(b.id)).objects.map(o=>o.id).sort()).toEqual(['after-restore','recover-me']);
});

it('marks and physically purges a real orphan through PG fences while retaining live roots',async()=>{
  const { WhiteboardObjectGarbageCollector,WhiteboardObjectSweeper }=await import('../../src/application/whiteboard/object-retention');
  const { PgWhiteboardObjectRetentionRepository,PgWhiteboardObjectSweepRepository }=await import('../../src/infrastructure/whiteboard/pg-object-retention');
  const { FsPhysicalPurge }=await import('../../src/infrastructure/storage/fs-physical-purge');
  const b=await board();await write(b.id,[note('gc-root')]);
  const tenant=createHash('sha256').update(orgId).digest('hex').slice(0,32),key=`whiteboards/tenants/${tenant}/boards/${b.id}/orphan.yjs`;
  await fs.putOnce(key,new Uint8Array([1,2,3]),'application/vnd.yjs-update');
  // Historical orphan fixture: production grace remains one day, no wall-clock SLA claim.
  const old=new Date(Date.now()-3*86400000);await utimes(join(root,key),old,old);
  const roots=new PgWhiteboardObjectRetentionRepository(db),before=await roots.roots(orgId),gc=new WhiteboardObjectGarbageCollector(roots,fs);
  expect((await gc.collect(orgId,tenant,randomUUID())).marked).toBeGreaterThanOrEqual(1);
  expect(await fs.get(key)).not.toBeNull();
  await db.withTenant(orgId,s=>s.query(`UPDATE whiteboard_object_tombstones SET marked_at=now()-interval '2 days' WHERE org_id=$1 AND object_key=$2`,[orgId,key]));
  expect((await gc.collect(orgId,tenant,randomUUID())).swept).toBeGreaterThanOrEqual(1);
  const sweeper=new WhiteboardObjectSweeper(new PgWhiteboardObjectSweepRepository(db),fs,new FsPhysicalPurge(root));
  expect(await sweeper.run(orgId)).toContainEqual(expect.objectContaining({status:'deleted'}));expect(await fs.get(key)).toBeNull();
  for(const item of before)expect(await fs.get(item.key)).not.toBeNull();
  const receipt=await db.withTenant(orgId,s=>s.query<{status:string}>('SELECT status FROM whiteboard_object_purge_receipts WHERE org_id=$1 AND object_key=$2',[orgId,key]));expect(receipt.rows).toEqual([{status:'deleted'}]);
  expect((await canonical(b.id)).objects.map(o=>o.id)).toEqual(['gc-root']);
});

it('restores a joint metadata/body backup after source removal using independent archive bytes',async()=>{
  const { BoardBackupService }=await import('../../src/application/whiteboard/board-backup');
  const { PgBoardBackupRepository }=await import('../../src/infrastructure/whiteboard/pg-board-backup');
  const archiveRoot=await mkdtemp(join(tmpdir(),'wb-independent-backup-'));
  try{
    const b=await board();await write(b.id,[note('backed-up','Survives primary loss')]);const before=await canonical(b.id);
    const comments=new PgWhiteboardCommentStore(db,new WorkerWhiteboardUpdateValidator(),undefined,store,fs);
    const threadId=randomUUID();await comments.dispatch(owner,b.id,{type:'create-comment',requestId:randomUUID(),threadId,commentId:randomUUID(),objectId:'backed-up',worldPosition:null,body:'Restorable comment body',mentions:[],expectedRevision:0});
    const viewer={orgId,userId:'wb-backup-viewer'};await addOrgMember(orgId,viewer.userId,'consultant',null);expect(await new PgWhiteboardRepository(db).putMember(owner,b.id,{userId:viewer.userId,role:'viewer'})).toBe(true);
    const archive=new FsObjectStore(archiveRoot),repository=new PgBoardBackupRepository(db,store,comments),service=new BoardBackupService(repository,fs,archive),backupId=randomUUID();
    const result=await service.backup(owner,b.id,backupId);expect(result.source).toEqual({epoch:1,seq:1});
    const captured=await repository.read(owner,backupId),key=captured.manifest.snapshot.key;
    await db.withTenant(orgId,s=>s.query('DELETE FROM whiteboards WHERE org_id=$1 AND id=$2',[orgId,b.id]));
    const pinned=await db.withTenant(orgId,s=>s.query<{rooted:boolean}>('SELECT whiteboard_object_is_rooted($1,$2) rooted',[orgId,key]));expect(pinned.rows[0]!.rooted).toBe(true);
    await rm(join(root,key));for(const thread of captured.manifest.comments)await rm(join(root,thread.blob.key));expect(await fs.get(key)).toBeNull();
    const target=randomUUID();expect(await service.restore(owner,backupId,target)).toEqual({boardId:target,replayed:false});expect((await canonical(target)).objects).toEqual(before.objects);
    const fresh=new PgDatabase(appConfig());try{const live=makeStore(fresh),restoredComments=await new PgWhiteboardCommentStore(fresh,new WorkerWhiteboardUpdateValidator(),undefined,live,fs).list(viewer,target);expect(restoredComments[0]!.comments[0]!.body).toBe('Restorable comment body');expect(restoredComments[0]!.boardId).toBe(target);const rows=await fresh.withTenant(orgId,s=>s.query<{payload:unknown}>('SELECT payload FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2',[orgId,target]));expect(JSON.stringify(rows.rows)).not.toContain('Restorable comment body');}finally{await fresh.close();}
    expect(await service.restore(owner,backupId,target)).toEqual({boardId:target,replayed:true});
    const sourceManifest=await db.withTenant(orgId,s=>s.query<{null_body:boolean}>('SELECT snapshot IS NULL null_body FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[orgId,target]));expect(sourceManifest.rows[0]!.null_body).toBe(true);
    await write(target,[note('editable-after-disaster')]);expect((await canonical(target)).seq).toBe(1);
    const archiveKey=`board-backups/${(await import('../../src/application/whiteboard/board-backup')).backupTenant(orgId)}/${backupId}/blobs/${captured.manifest.snapshot.hash}`;
    await rm(join(archiveRoot,archiveKey));const rejectedTarget=randomUUID();await expect(service.restore(owner,backupId,rejectedTarget)).rejects.toThrow('BACKUP_INTEGRITY_FAILED');
    const absent=await db.withTenant(orgId,s=>s.query('SELECT id FROM whiteboards WHERE org_id=$1 AND id=$2',[orgId,rejectedTarget]));expect(absent.rows).toHaveLength(0);
  }finally{await rm(archiveRoot,{recursive:true,force:true});}
});
