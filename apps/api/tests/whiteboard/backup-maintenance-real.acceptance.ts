/** Main-session only: real isolated PostgreSQL and independent filesystem archive. */
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import * as Y from 'yjs';
import {createWhiteboardDocument,readObjects,type WhiteboardCommand} from '@repo/whiteboard-core';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {resolveObjectPath} from '../../src/infrastructure/storage/object-store-path';
import {FsPhysicalPurge} from '../../src/infrastructure/storage/fs-physical-purge';
import {PgWhiteboardRepository} from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import {PgWhiteboardCollaborationStore} from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import {PgWhiteboardCommentStore} from '../../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import {PgBoardBackupRepository} from '../../src/infrastructure/whiteboard/pg-board-backup';
import {PgBackupMaintenance} from '../../src/infrastructure/whiteboard/pg-backup-maintenance';
import {WorkerWhiteboardUpdateValidator} from '../../src/infrastructure/whiteboard/update-validator';
import {BoardBackupService,backupHash,backupTenant,boardRestoreRefs} from '../../src/application/whiteboard/board-backup';
import {BackupMaintenanceService,type BackupMaintenancePort} from '../../src/application/whiteboard/backup-maintenance';
import {WhiteboardObjectGarbageCollector,WhiteboardObjectSweeper} from '../../src/application/whiteboard/object-retention';
import {PgWhiteboardObjectRetentionRepository,PgWhiteboardObjectSweepRepository} from '../../src/infrastructure/whiteboard/pg-object-retention';
import {toOrgId} from '../../src/domain/org-id';
import {assertLocalMaintenanceAcceptance} from '../support/board-maintenance-isolation';
import {ensureDatabase,migrateOnce,resetOrgs,seedOrg,addOrgMember} from '../support/db';
const orgId=toOrgId('board-maintenance-real'),foreignOrg=toOrgId('board-maintenance-foreign'),owner={orgId,userId:'maintenance-owner'};
let initialized=false,db:PgDatabase,admin:PgDatabase,root:string,archiveRoot:string,files:FsObjectStore,archive:FsObjectStore,collab:PgWhiteboardCollaborationStore,comments:PgWhiteboardCommentStore,backups:PgBoardBackupRepository,backup:BoardBackupService,repository:PgBackupMaintenance;
const makeService=(port:BackupMaintenancePort=repository)=>new BackupMaintenanceService(port,files,archive);
const note=(id:string):WhiteboardCommand=>({type:'create',object:{id,schemaVersion:1,kind:'sticky',text:`Synthetic ${id}`,parentId:null,orderKey:id,style:{},geometry:{x:0,y:0,width:160,height:160,rotation:0}}});
const write=(id:string,objectId:string)=>collab.writeCommands(owner,id,{epoch:1,requestId:randomUUID(),commands:[note(objectId)]});
const age=(backupId:string)=>admin.withTenant(orgId,s=>s.query("UPDATE whiteboard_backups SET created_at=now()-interval '31 days' WHERE org_id=$1 AND backup_id=$2",[orgId,backupId]));
const release=(backupId:string)=>({action:'release-pins' as const,backupId,requestId:randomUUID(),retentionDays:30});
const rooted=async(key:string)=>(await db.withTenant(orgId,s=>s.query<{rooted:boolean}>('SELECT whiteboard_object_is_rooted($1,$2) rooted',[orgId,key]))).rows[0]!.rooted;
async function fresh(boardId:string){const next=new PgDatabase(appConfig());try{const loaded=await new PgWhiteboardCollaborationStore(next,new WorkerWhiteboardUpdateValidator(),120,files).load(owner,boardId),doc=createWhiteboardDocument();try{Y.applyUpdate(doc,loaded.update);return{epoch:loaded.epoch,seq:loaded.seq,objects:readObjects(doc)};}finally{doc.destroy();}}finally{await next.close();}}
async function fixture(withComment=false){const board=await new PgWhiteboardRepository(db).create(owner,{requestId:randomUUID(),name:'Synthetic maintenance board'});await write(board.id,'initial');if(withComment)await comments.dispatch(owner,board.id,{type:'create-comment',requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:'initial',worldPosition:null,body:'Synthetic retained comment',mentions:[],expectedRevision:0});const id=randomUUID();await backup.backup(owner,board.id,id);return{board,backupId:id,record:await backups.read(owner,id)};}
beforeAll(async()=>{
 assertLocalMaintenanceAcceptance();
 ensureDatabase();await migrateOnce();initialized=true;for(const org of [orgId,foreignOrg]){await resetOrgs(org);await seedOrg({orgId:org,projectId:`${org}-project`});await addOrgMember(org,owner.userId,'consultant',null);await addOrgMember(org,'maintenance-admin','admin',null);await addOrgMember(org,'maintenance-viewer','consultant',null);}
 root=await mkdtemp(join(tmpdir(),'board-maint-primary-'));archiveRoot=await mkdtemp(join(tmpdir(),'board-maint-archive-'));files=new FsObjectStore(root);archive=new FsObjectStore(archiveRoot);db=new PgDatabase(appConfig());admin=new PgDatabase(migrationConfig());const validator=new WorkerWhiteboardUpdateValidator();collab=new PgWhiteboardCollaborationStore(db,validator,120,files);comments=new PgWhiteboardCommentStore(db,validator,undefined,collab,files);backups=new PgBoardBackupRepository(db,collab,comments);backup=new BoardBackupService(backups,files,archive);repository=new PgBackupMaintenance(db);
});
afterAll(async()=>{await db?.close();await admin?.close();if(initialized)for(const org of [orgId,foreignOrg])await resetOrgs(org);if(root)await rm(root,{recursive:true,force:true});if(archiveRoot)await rm(archiveRoot,{recursive:true,force:true});});
it('requires retention, verified archive, owner/admin scope and fresh authorization even for replay',async()=>{
 const f=await fixture(),request=release(f.backupId),service=makeService();
 await expect(service.run(owner,request,true)).rejects.toMatchObject({code:'RETENTION_NOT_ELAPSED'});await age(f.backupId);
 await expect(service.run({orgId,userId:'maintenance-viewer'},request,true)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(service.run({orgId:foreignOrg,userId:owner.userId},request,true)).rejects.toMatchObject({code:'NOT_FOUND'});
 const before=await repository.inspect(owner,request);expect(await service.run(owner,request)).toMatchObject({mode:'dry-run',activePins:before.activePins});expect((await repository.inspect(owner,request)).activePins).toBe(before.activePins);
 const result=await service.run(owner,request,true);expect(result).toMatchObject({releasedPins:before.activePins,replayed:false});expect(await service.run(owner,request,true)).toMatchObject({replayed:true});
 await admin.withTenant(orgId,s=>s.query('DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2',[orgId,owner.userId]));try{await expect(service.run(owner,request,true)).rejects.toMatchObject({code:'NOT_FOUND'});}finally{await addOrgMember(orgId,owner.userId,'consultant',null);}
 const another=await fixture();await age(another.backupId);await expect(service.run({orgId,userId:'maintenance-admin'},release(another.backupId),true)).resolves.toMatchObject({mode:'execute'});
});
it('keeps live comments, updates, documents and Undo asset roots; releases only chosen backup pins before physical GC',async()=>{
 const f=await fixture(true),other=randomUUID();await backup.backup(owner,f.board.id,other);await age(f.backupId);await age(other);await write(f.board.id,'newer');
 const oldKey=f.record.manifest.snapshot.key,commentKey=f.record.manifest.comments[0]!.blob.key;
 // Generic operation Undo uses this exact active asset-root family; maintenance never releases it.
 const undoKey=`whiteboards/tenants/${backupTenant(orgId)}/boards/${f.board.id}/operation-undo/retained.yjs`,undoBytes=new Uint8Array([0,0]);await files.putOnce(undoKey,undoBytes,'application/vnd.yjs-update');
 await db.withTenant(orgId,s=>s.query("INSERT INTO whiteboard_asset_refs(org_id,board_id,object_key,content_hash,byte_size,state,activated_at) VALUES($1,$2,$3,$4,$5,'active',now())",[orgId,f.board.id,undoKey,backupHash(undoBytes),undoBytes.length]));
 await makeService().run(owner,release(f.backupId),true);expect(await rooted(oldKey)).toBe(true);await makeService().run(owner,release(other),true);expect(await rooted(oldKey)).toBe(false);expect(await rooted(commentKey)).toBe(true);expect(await rooted(undoKey)).toBe(true);
 const roots=new PgWhiteboardObjectRetentionRepository(db),live=await roots.roots(orgId),gc=new WhiteboardObjectGarbageCollector(roots,files),old=new Date(Date.now()-3*86400000);await utimes(resolveObjectPath(root,oldKey),old,old);
 await gc.collect(orgId,backupTenant(orgId),randomUUID());await db.withTenant(orgId,s=>s.query("UPDATE whiteboard_object_tombstones SET marked_at=now()-interval '2 days' WHERE org_id=$1 AND object_key=$2",[orgId,oldKey]));await gc.collect(orgId,backupTenant(orgId),randomUUID());
 await new WhiteboardObjectSweeper(new PgWhiteboardObjectSweepRepository(db),files,new FsPhysicalPurge(root)).run(orgId);expect(await files.get(oldKey)).toBeNull();for(const ref of live)expect(await files.get(ref.key)).not.toBeNull();expect((await fresh(f.board.id)).objects).toHaveLength(2);
 const restoredId=randomUUID();await backup.restore(owner,f.backupId,restoredId);expect((await fresh(restoredId)).objects).toHaveLength(1);await makeService().run(owner,release(f.backupId),true);expect((await fresh(restoredId)).objects).toHaveLength(1);
 console.info('BOARD_MAINTENANCE_GC',JSON.stringify({sharedBackupRetained:true,liveRootsPreserved:true,undoAssetRootPreserved:true,physicalOrphanDeleted:true,archiveRestoreAfterRelease:true}));
});
it('rejects corrupted archive and a restore started after inspection',async()=>{
 const f=await fixture();await age(f.backupId);const request=release(f.backupId),key=`board-backups/${backupTenant(orgId)}/${f.backupId}/blobs/${f.record.manifest.snapshot.hash}`;
 const saved=(await archive.get(key))!;await writeFile(resolveObjectPath(archiveRoot,key),new Uint8Array(saved.length));await expect(makeService().run(owner,request,true)).rejects.toMatchObject({code:'BACKUP_INTEGRITY_FAILED'});expect((await repository.inspect(owner,request)).activePins).toBeGreaterThan(0);await writeFile(resolveObjectPath(archiveRoot,key),saved);
 const restoreId=randomUUID(),refs=boardRestoreRefs(f.record.manifest,restoreId),race:BackupMaintenancePort={inspect:(...args)=>repository.inspect(...args),recover:(...args)=>repository.recover(...args),release:async(...args)=>{await backups.prepareRestore(owner,f.record.manifest,restoreId,refs);return repository.release(...args);}};
 await expect(makeService(race).run(owner,request,true)).rejects.toMatchObject({code:'RESTORE_IN_PROGRESS'});expect((await repository.inspect(owner,request)).activePins).toBeGreaterThan(0);
});
it('recovers missing FS snapshot without PG body bytes or logical revision changes and rejects newer edits at commit',async()=>{
 const f=await fixture(),before=await fresh(f.board.id),request={action:'recover-manifest' as const,backupId:f.backupId,requestId:randomUUID(),boardId:f.board.id,expectedEpoch:before.epoch,expectedSeq:before.seq,targetVersion:1};
 await rm(resolveObjectPath(root,f.record.manifest.snapshot.key));await makeService().run(owner,request);expect(await files.get(f.record.manifest.snapshot.key)).toBeNull();
 expect(await makeService().run(owner,request,true)).toMatchObject({mode:'execute',releasedPins:0});expect(await fresh(f.board.id)).toEqual(before);
 const rows=await db.withTenant(orgId,s=>s.query<{inline:boolean;object_key:string}>('SELECT snapshot IS NOT NULL AS inline,object_key FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[orgId,f.board.id]));expect(rows.rows[0]!.inline).toBe(false);expect(rows.rows[0]!.object_key).toContain('/recovered/');
 const g=await fixture(),raceRequest={...request,backupId:g.backupId,boardId:g.board.id,requestId:randomUUID()},race:BackupMaintenancePort={inspect:(...args)=>repository.inspect(...args),release:(...args)=>repository.release(...args),recover:async(...args)=>{await write(g.board.id,'concurrent');return repository.recover(...args);}};
 await expect(makeService(race).run(owner,raceRequest,true)).rejects.toMatchObject({code:'CURRENT_CONTENT_CHANGED'});expect((await fresh(g.board.id)).objects.map(o=>o.id).sort()).toEqual(['concurrent','initial']);
 console.info('BOARD_MAINTENANCE_RECOVERY',JSON.stringify({freshClientEqual:true,pgBodyNull:true,concurrentEditProtected:true}));
});
