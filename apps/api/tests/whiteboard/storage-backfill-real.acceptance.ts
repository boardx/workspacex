/** Main-session only: real isolated PG + immutable filesystem migration across tenants. */
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {beforeAll,afterAll,it,expect} from 'vitest';
import * as Y from 'yjs';
import {createWhiteboardDocument,readObjects} from '@repo/whiteboard-core';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {PgWhiteboardRepository} from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import {PgWhiteboardCollaborationStore} from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import {PgWhiteboardCommentStore} from '../../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import {PgStorageBackfill} from '../../src/infrastructure/whiteboard/pg-storage-backfill';
import {WorkerWhiteboardUpdateValidator} from '../../src/infrastructure/whiteboard/update-validator';
import {runStorageBackfill,legacyBodyCount,type BackfillScope} from '../../src/application/whiteboard/storage-backfill';
import {toOrgId} from '../../src/domain/org-id';
import {ensureDatabase,migrateOnce,resetOrgs,seedOrg,addOrgMember} from '../support/db';
let initialized=false;
const orgs=[toOrgId('backfill-real-one'),toOrgId('backfill-real-two')];let db:PgDatabase,files:FsObjectStore,root:string,collab:PgWhiteboardCollaborationStore,comments:PgWhiteboardCommentStore,port:PgStorageBackfill;
const fixtures:Array<{orgId:typeof orgs[number];boardId:string;archived:boolean;objects:unknown}> = [];
beforeAll(async()=>{
 if(!process.env.WORKSPACEX_ISOLATION_ID||!/^wsx_[a-f0-9]{20}$/.test(process.env.WORKSPACEX_DB??'')||process.env.PGDATABASE!==process.env.WORKSPACEX_DB||!['localhost','127.0.0.1','::1'].includes(process.env.PGHOST??'')||process.env.WORKSPACEX_DEPLOY_PROFILE)throw Error('ISOLATED_LOCAL_BACKFILL_ACCEPTANCE_REQUIRED');
 initialized=true;ensureDatabase();await migrateOnce();for(const orgId of orgs){await resetOrgs(orgId);await seedOrg({orgId,projectId:`${orgId}-project`});await addOrgMember(orgId,'owner','consultant',null);await addOrgMember(orgId,'operator','admin',null);await addOrgMember(orgId,'viewer','consultant',null);}
 root=await mkdtemp(join(tmpdir(),'backfill-real-'));files=new FsObjectStore(root);db=new PgDatabase(appConfig());const validator=new WorkerWhiteboardUpdateValidator();collab=new PgWhiteboardCollaborationStore(db,validator,120,files);comments=new PgWhiteboardCommentStore(db,validator,undefined,collab,files);port=new PgStorageBackfill(db,collab,comments);
 for(const [index,orgId] of [orgs[0]!,orgs[0]!,orgs[1]!].entries()){
  const p={orgId,userId:'owner'},b=await new PgWhiteboardRepository(db).create(p,{requestId:randomUUID(),name:'Backfill acceptance'});
  await collab.writeCommands(p,b.id,{epoch:1,requestId:randomUUID(),commands:[{type:'create',object:{id:'note',schemaVersion:1,kind:'sticky',text:'Synthetic note body',parentId:null,orderKey:'a',geometry:{x:0,y:0,width:180,height:180,rotation:0},style:{}}}]});
  await comments.dispatch(p,b.id,{type:'create-comment',requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:'note',worldPosition:null,body:'Synthetic comment body',mentions:[],expectedRevision:0});
  const doc=createWhiteboardDocument();Y.applyUpdate(doc,(await collab.load(p,b.id)).update);const objects=readObjects(doc);doc.destroy();
  const admin=new PgDatabase(migrationConfig());try{await admin.withTenant(orgId,async s=>{
   const snapshots=await s.query<{object_key:string}>('SELECT object_key FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[orgId,b.id]);
   await s.query('UPDATE whiteboard_documents SET snapshot=$3,object_key=NULL,content_hash=NULL,byte_size=NULL,manifest_version=NULL WHERE org_id=$1 AND board_id=$2',[orgId,b.id,Buffer.from((await files.get(snapshots.rows[0]!.object_key))!)]);
   const updates=await s.query<{seq:string;update_object_key:string}>('SELECT seq::text,update_object_key FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2',[orgId,b.id]);
   for(const row of updates.rows)await s.query('UPDATE whiteboard_updates SET update=$4,update_object_key=NULL,update_hash=NULL,update_size=NULL WHERE org_id=$1 AND board_id=$2 AND seq=$3',[orgId,b.id,row.seq,Buffer.from((await files.get(row.update_object_key))!)]);
   const threads=await s.query<{id:string;payload:any;body_object_key:string}>('SELECT id,payload,body_object_key FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2',[orgId,b.id]);
   for(const row of threads.rows){const body=JSON.parse(Buffer.from((await files.get(row.body_object_key))!).toString());const payload={...row.payload,comments:row.payload.comments.map((comment:{id:string})=>({...comment,body:body.bodies[comment.id]}))};await s.query('UPDATE whiteboard_comment_threads SET payload=$4::jsonb,body_object_key=NULL,body_hash=NULL,body_bytes=NULL WHERE org_id=$1 AND board_id=$2 AND id=$3',[orgId,b.id,row.id,JSON.stringify(payload)]);}
   const requests=await s.query<{actor_id:string;request_id:string;response_object_key:string}>('SELECT actor_id,request_id,response_object_key FROM whiteboard_comment_requests WHERE org_id=$1 AND board_id=$2',[orgId,b.id]);
   for(const row of requests.rows)await s.query('UPDATE whiteboard_comment_requests SET response=$5::jsonb,response_object_key=NULL,response_hash=NULL,response_bytes=NULL WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4',[orgId,b.id,row.actor_id,row.request_id,Buffer.from((await files.get(row.response_object_key))!).toString()]);
   if(index===1)await s.query('UPDATE whiteboards SET archived=true WHERE org_id=$1 AND id=$2',[orgId,b.id]);
  });}finally{await admin.close();}fixtures.push({orgId,boardId:b.id,archived:index===1,objects});
 }
});
afterAll(async()=>{await db?.close();if(initialized)for(const org of orgs)await resetOrgs(org);if(root)await rm(root,{recursive:true,force:true});});
it('dry-runs without mutation, resumes bounded batches across tenants/archives, and preserves canonical data',async()=>{
 const scope:BackfillScope=orgs.map(orgId=>({orgId,actorId:'operator',allBoards:true}));
 const dry=await runStorageBackfill(port,scope,{});expect(dry.mode).toBe('dry-run');expect(dry.boards).toHaveLength(3);expect(dry.boards.every(board=>legacyBodyCount(board.remaining)===4)).toBe(true);
 for(const fixture of fixtures)expect(legacyBodyCount((await port.inspect({orgId:fixture.orgId,userId:'owner'},fixture.boardId)).remaining)).toBe(4);
 let cursor:string|undefined;let total=0,batches=0;
 do{const result=await runStorageBackfill(port,scope,{execute:true,cursor,rowLimit:1,boardLimit:2,delayMs:0});expect(result.failures).toEqual([]);expect(result.boards.reduce((sum,board)=>sum+board.migrated,0)).toBeLessThanOrEqual(1);total+=result.boards.reduce((sum,board)=>sum+board.migrated,0);cursor=result.cursor??undefined;if(++batches>20)throw Error('BACKFILL_DID_NOT_CONVERGE');}while(cursor);
 expect(total).toBe(12);expect((await runStorageBackfill(port,scope,{execute:true,delayMs:0})).boards.every(board=>board.migrated===0)).toBe(true);
 const fresh=new PgDatabase(appConfig());try{const store=new PgWhiteboardCollaborationStore(fresh,new WorkerWhiteboardUpdateValidator(),120,files);for(const fixture of fixtures){
  const p={orgId:fixture.orgId,userId:'owner'},loaded=await store.load(p,fixture.boardId),doc=createWhiteboardDocument();Y.applyUpdate(doc,loaded.update);expect(readObjects(doc)).toEqual(fixture.objects);doc.destroy();expect(loaded.archived).toBe(fixture.archived);expect(loaded.seq).toBe(1);
  const rows=await fresh.withTenant(p.orgId,s=>s.query<{payload:unknown;body_object_key:string}>('SELECT payload,body_object_key FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2',[p.orgId,fixture.boardId]));expect(JSON.stringify(rows.rows[0]!.payload)).not.toContain('Synthetic comment body');expect(Buffer.from((await files.get(rows.rows[0]!.body_object_key))!).toString()).toContain('Synthetic comment body');
  if(fixture.archived)await expect(comments.list(p,fixture.boardId)).rejects.toMatchObject({code:'ARCHIVED'});
 }}finally{await fresh.close();}
 const foreign=await runStorageBackfill(port,[{orgId:orgs[0]!,actorId:'operator',boardIds:[fixtures[2]!.boardId]}],{execute:true});expect(foreign.failures).toMatchObject([{code:'NOT_FOUND'}]);
 const denied=await runStorageBackfill(port,[{orgId:orgs[0]!,actorId:'viewer',boardIds:[fixtures[0]!.boardId]}],{execute:true});expect(denied.failures).toMatchObject([{code:'NOT_FOUND'}]);
 console.info('BOARD_BACKFILL_ACCEPTANCE',JSON.stringify({tenants:2,boards:3,migratedRows:total,batches,archivedPreserved:true,freshCanonicalEqual:true}));
});
