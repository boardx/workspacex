/** Explicit local isolation drill; only the main session/operator runs this Docker/PG path. */
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import * as Y from 'yjs';
import { createWhiteboardDocument, readObjects, validateDocument } from '@repo/whiteboard-core';
import { backupStarterDatabase,restoreStarterDatabase } from '../../../packages/cloud-deploy/src/starter-backup';
import { PgDatabase } from '../src/infrastructure/db/pg-database';
import { appConfig,migrationConfig } from '../src/infrastructure/db/pg-config';
import { FsObjectStore } from '../src/infrastructure/storage/fs-object-store';
import { PgWhiteboardCollaborationStore } from '../src/infrastructure/whiteboard/pg-collaboration-store';
import { PgWhiteboardCommentStore } from '../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import { WorkerWhiteboardUpdateValidator } from '../src/infrastructure/whiteboard/update-validator';
import { PgBoardBackupRepository } from '../src/infrastructure/whiteboard/pg-board-backup';
import { BoardBackupService,BoardBackupError,backupHash,backupTenant,boardRestoreRefs,boardBackupBlobs } from '../src/application/whiteboard/board-backup';
import { toOrgId } from '../src/domain/org-id';
import {jointDrillDiagnostic,type JointDrillStage} from './board-joint-drill-diagnostics';
let stage:JointDrillStage='preflight';
async function main(){
  const env=process.env;
  if(env.BOARD_JOINT_DRILL!=='1'||!env.WORKSPACEX_ISOLATION_ID||!/^wsx_[a-f0-9]{20}$/.test(env.WORKSPACEX_DB??'')||env.PGDATABASE!==env.WORKSPACEX_DB||!['localhost','127.0.0.1','::1'].includes(env.PGHOST??'')||env.WORKSPACEX_DEPLOY_PROFILE)throw new BoardBackupError('ISOLATED_LOCAL_DRILL_REQUIRED');
  const [org,actor,boardId]=process.argv.slice(2);if(process.argv.length!==5)throw new BoardBackupError('INVALID_ARGUMENT');
  const p={orgId:toOrgId(z.string().min(1).parse(org)),userId:z.string().min(1).parse(actor)};z.string().uuid().parse(boardId);
  stage='prepare-directory';
  const directory=resolve(z.string().min(1).parse(env.BOARD_DRILL_DIRECTORY));await mkdir(directory,{mode:0o700}); // EEXIST is deliberate: never reuse a drill directory.
  const primaryRoot=await realpath(z.string().min(1).parse(env.BOARD_OBJECT_ROOT));
  const rel=relative(primaryRoot,await realpath(directory));if(rel===''||(!rel.startsWith('..')&&!isAbsolute(rel)))throw new BoardBackupError('INDEPENDENT_DRILL_DIRECTORY_REQUIRED');
  if(((await stat(directory)).mode&0o077)!==0)throw new BoardBackupError('PRIVATE_DRILL_DIRECTORY_REQUIRED');
  const archiveRoot=join(directory,'archive'),targetRoot=join(directory,'restored-objects');await mkdir(archiveRoot,{mode:0o700});await mkdir(targetRoot,{mode:0o700});
  const sourceConfig=appConfig(),admin=migrationConfig(),container=z.string().min(1).parse(env.STARTER_POSTGRES_CONTAINER),targetDatabase=`wsx_drill_${randomUUID().replaceAll('-','').slice(0,20)}`;
  const sourceDb=new PgDatabase(sourceConfig),primary=new FsObjectStore(primaryRoot),archive=new FsObjectStore(archiveRoot),backupId=randomUUID(),restoreId=randomUUID();
  let sourceRecord:Awaited<ReturnType<PgBoardBackupRepository['read']>>;
  try{
    const collaboration=new PgWhiteboardCollaborationStore(sourceDb,undefined,120,primary),repository=new PgBoardBackupRepository(sourceDb,collaboration,new PgWhiteboardCommentStore(sourceDb,new WorkerWhiteboardUpdateValidator(),undefined,collaboration,primary)),service=new BoardBackupService(repository,primary,archive);
    stage='capture-board';await service.backup(p,boardId!,backupId);stage='read-backup-root';sourceRecord=await repository.read(p,backupId);
  }finally{await sourceDb.close();}
  // pg_dump starts AFTER verified/pins commit. Immutable backup record is the trusted
  // root, even if the source Board receives later edits during the PG snapshot.
  stage='postgres-backup';
  const pgManifest=await backupStarterDatabase({container,database:sourceConfig.database,user:admin.user,password:admin.password},join(directory,'postgres'));
  stage='postgres-restore';
  await restoreStarterDatabase({container,database:targetDatabase,user:admin.user,password:admin.password},join(directory,'postgres'));
  const targetDb=new PgDatabase({...sourceConfig,database:targetDatabase}),targetObjects=new FsObjectStore(targetRoot);
  try{
    stage='verify-restored-root';
    const collaboration=new PgWhiteboardCollaborationStore(targetDb,undefined,120,targetObjects),repository=new PgBoardBackupRepository(targetDb,collaboration,new PgWhiteboardCommentStore(targetDb,new WorkerWhiteboardUpdateValidator(),undefined,collaboration,targetObjects)),service=new BoardBackupService(repository,targetObjects,archive),record=await repository.read(p,backupId);
    if(record.status!=='verified'||record.manifestHash!==sourceRecord!.manifestHash||JSON.stringify(record.manifest)!==JSON.stringify(sourceRecord!.manifest))throw new BoardBackupError('PG_RESTORE_POINT_MISMATCH');
    stage='restore-board';await service.restoreSourceFiles(p,backupId);await service.restore(p,backupId,restoreId);
  }finally{await targetDb.close();}
  const fresh=new PgDatabase({...sourceConfig,database:targetDatabase});try{
    stage='verify-canonical';
    const state=await new PgWhiteboardCollaborationStore(fresh,undefined,120,targetObjects).load(p,restoreId),doc=createWhiteboardDocument();let count:number,canonicalHash:string;
    try{Y.applyUpdate(doc,state.update);validateDocument(doc);count=readObjects(doc).length;canonicalHash=backupHash(JSON.stringify(readObjects(doc)));}finally{doc.destroy();}
    const sourceSnapshot=await archive.get(`board-backups/${backupTenant(p.orgId)}/${backupId}/blobs/${sourceRecord!.manifest.snapshot.hash}`),expected=createWhiteboardDocument();
    try{if(!sourceSnapshot||backupHash(sourceSnapshot)!==sourceRecord!.manifest.snapshot.hash)throw new BoardBackupError('BACKUP_INTEGRITY_FAILED');Y.applyUpdate(expected,sourceSnapshot);validateDocument(expected);if(backupHash(JSON.stringify(readObjects(expected)))!==canonicalHash!)throw new BoardBackupError('RESTORED_CANONICAL_MISMATCH');}finally{expected.destroy();}
    stage='verify-blobs';
    const refs=boardRestoreRefs(sourceRecord!.manifest,restoreId);for(const ref of [...refs.images.map(i=>i.blob),...refs.comments.map(c=>c.blob),...boardBackupBlobs(sourceRecord!.manifest)]){const bytes=await targetObjects.get(ref.key),head=await targetObjects.head(ref.key);if(!bytes||!head||bytes.byteLength!==ref.bytes||head.sizeBytes!==ref.bytes||head.mime!==ref.mime||backupHash(bytes)!==ref.hash)throw new BoardBackupError('RESTORED_BLOB_MISMATCH');}
    stage='verify-comments';
    const commentStore=new PgWhiteboardCommentStore(fresh,new WorkerWhiteboardUpdateValidator(),undefined,new PgWhiteboardCollaborationStore(fresh,undefined,120,targetObjects),targetObjects),threads=await commentStore.list(p,restoreId);
    if(threads.length!==refs.comments.filter(c=>c.status!=='object-deleted').length||threads.some(t=>t.boardId!==restoreId))throw new BoardBackupError('RESTORED_COMMENT_MISMATCH');
    stage='verify-pg-metadata';
    const metadata=await fresh.withTenant(p.orgId,s=>s.query<{body_null:boolean}>('SELECT snapshot IS NULL body_null FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[p.orgId,restoreId]));if(metadata.rows[0]?.body_null!==true)throw new BoardBackupError('PG_BODY_REGRESSION');
    const report={version:1,sourceDatabase:sourceConfig.database,targetDatabase,boardId:restoreId,backupId,manifestHash:sourceRecord!.manifestHash,pgDumpHash:pgManifest.sha256,sourceRevision:sourceRecord!.manifest.revision,restored:{epoch:state.epoch,seq:state.seq,objectCount:count,canonicalStateHash:canonicalHash!,imageCount:refs.images.length,commentThreadCount:refs.comments.length,sourceHistoryBlobCount:sourceRecord!.manifest.sourceHistory?.length??0},archiveRoot,targetRoot,pgBodyNull:true,executedAt:new Date().toISOString(),scope:'selected-board-from-restored-pg-and-independent-archive',cleanup:'Target DB and drill directory retained for main-session inspection; no source deletion performed.'};
    stage='publish-evidence';
    await writeFile(join(directory,'evidence.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(report)+'\n');
  }finally{await fresh.close();}
}
void main().catch(error=>{process.stderr.write(JSON.stringify(jointDrillDiagnostic(stage,error))+'\n');process.exitCode=1;});
