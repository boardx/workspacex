import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {WhiteboardCommentService} from '@repo/whiteboard-core';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {CommentBodyStorage,CommentThreadMetadataSchema,commentObjectPrefix} from '../../src/infrastructure/whiteboard/comment-body-storage';
import {PgWhiteboardCommentStore} from '../../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import type {DatabasePort,TenantSession} from '../../src/application/ports/database.port';
import type {WhiteboardUpdateValidator} from '../../src/application/whiteboard/collaboration-ports';
import {toOrgId} from '../../src/domain/org-id';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'comment-bodies-'));roots.push(directory);
 const objects=new FsObjectStore(directory),p={orgId:toOrgId('comment-files'),userId:'owner'},boardId=randomUUID();
 const service=new WhiteboardCommentService(boardId,{objectExists:()=>true,isMentionable:()=>true,now:()=>new Date('2026-09-27T00:00:00Z'),uuid:randomUUID});
 const command={type:'create-comment' as const,requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:'note',worldPosition:null,body:'中文 private body',mentions:[{userId:'peer'}],expectedRevision:0 as const};
 const accepted=service.dispatch({actorId:p.userId,role:'owner'},command),thread=accepted.threads[0]!;
 let allowed=true,failCommit=false;
 const rows:any[]=[{id:thread.id,object_id:thread.objectId,status:thread.status,revision:thread.revision,payload:structuredClone(thread),body_object_key:null,body_hash:null,body_bytes:null}];
 const requests:any[]=[{actor_id:p.userId,request_id:command.requestId,request_hash:'unused',response:structuredClone(accepted),response_object_key:null,response_hash:null,response_bytes:null}];
 const queries:Array<{sql:string;params:readonly unknown[]}>=[];
 const session:TenantSession={async query<R>(sql:string,params:readonly unknown[]=[]){queries.push({sql,params});let result:unknown[]=[];
  if(sql.includes('CASE WHEN b.owner_id'))result=allowed?[{owner_id:p.userId,archived:false,role:'owner'}]:[];
  else if(sql.includes('FROM whiteboard_comment_threads'))result=rows.filter(row=>!sql.includes('body_object_key IS NULL')||!row.body_object_key);
  else if(sql.includes('FROM whiteboard_comment_requests'))result=requests.filter(row=>!sql.includes('response_object_key IS NULL')||!row.response_object_key);
  else if(sql.startsWith('UPDATE whiteboard_comment_threads')){const row=rows.find(row=>row.id===params[2]);Object.assign(row,{payload:JSON.parse(String(params[3])),body_object_key:params[4],body_hash:params[5],body_bytes:params[6]});}
  else if(sql.startsWith('UPDATE whiteboard_comment_requests'))Object.assign(requests[0],{response:null,response_object_key:params[4],response_hash:params[5],response_bytes:params[6]});
  else if(sql.startsWith('INSERT INTO whiteboard_comment_threads'))rows.push({id:params[2],object_id:params[3],status:params[4],revision:params[5],payload:JSON.parse(String(params[6])),body_object_key:params[7],body_hash:params[8],body_bytes:params[9]});
  else throw new Error(sql);
  return{rows:structuredClone(result) as R[]};
 }};
 const db:DatabasePort={withTenant:async(org,fn)=>{expect(org).toBe(p.orgId);const prior=structuredClone({rows,requests});try{const result=await fn(session);if(failCommit)throw new Error('commit failed');return result;}catch(error){rows.splice(0,rows.length,...prior.rows);requests.splice(0,requests.length,...prior.requests);throw error;}},withoutTenant:async()=>{throw new Error('unscoped');},close:async()=>{}};
 const store=new PgWhiteboardCommentStore(db,{} as WhiteboardUpdateValidator,undefined,undefined,objects);
 return{objects,p,boardId,thread,accepted,rows,requests,queries,session,db,store,deny:()=>{allowed=false;},failCommit:()=>{failCommit=true;}};
}
it('moves real legacy thread bodies and replay receipts into verified files without duplicate PG payloads',async()=>{
 const f=await fixture(),listed=await f.store.list(f.p,f.boardId);expect(listed).toEqual([f.thread]);
 expect(f.rows[0].payload.comments[0].body).toBeUndefined();expect(f.requests[0].response).toBeNull();
 expect(JSON.stringify(f.rows)+JSON.stringify(f.requests)).not.toContain('中文 private body');
 const body=await f.objects.get(f.rows[0].body_object_key);expect(Buffer.from(body!).toString()).toContain('中文 private body');
 expect(JSON.parse(Buffer.from(body!).toString())).not.toHaveProperty('boardId');
 expect(await f.store.list(f.p,f.boardId)).toEqual([f.thread]);
 const descriptor=(await f.store.captureBackupInTransaction(f.session,f.p,f.boardId))[0]!;expect(descriptor).toMatchObject({id:f.thread.id,revision:1,blob:{mime:'application/json'}});
});
it('denies fresh revoked ACL before reading stored bodies',async()=>{
 const f=await fixture();await f.store.list(f.p,f.boardId);f.deny();f.queries.length=0;
 await expect(f.store.list(f.p,f.boardId)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(f.queries).toHaveLength(1);
});
it('keeps legacy data intact when PG commit fails after blob verification',async()=>{
 const f=await fixture();f.failCommit();await expect(f.store.list(f.p,f.boardId)).rejects.toThrow('commit failed');
 expect(f.rows[0].payload).toEqual(f.thread);expect(f.rows[0].body_object_key).toBeNull();expect(f.requests[0].response).toEqual(f.accepted);
});
it('rejects corrupt/missing files and cross-board pointers without falling back to legacy text',async()=>{
 const f=await fixture(),storage=new CommentBodyStorage(f.objects),saved=await storage.split(f.p,f.boardId,f.thread);
 await expect(storage.hydrate(f.p,randomUUID(),saved.metadata,saved.blob)).rejects.toMatchObject({code:'INTEGRITY_FAILED'});
 await expect(storage.hydrate(f.p,f.boardId,saved.metadata,{...saved.blob,hash:'0'.repeat(64)})).rejects.toMatchObject({code:'INTEGRITY_FAILED'});
 const bad=new CommentBodyStorage({putOnce:f.objects.putOnce.bind(f.objects),head:f.objects.head.bind(f.objects),get:async()=>new Uint8Array([1])});
 await expect(bad.write(f.p,f.boardId,'comment-bodies',{version:1,bodies:{}})).rejects.toMatchObject({code:'INTEGRITY_FAILED'});
 expect(()=>CommentThreadMetadataSchema.parse(f.thread)).toThrow();
});
it('restores verified body bytes to another board and only publishes bodyless metadata',async()=>{
 const f=await fixture();const descriptors=await f.store.captureBackupInTransaction(f.session,f.p,f.boardId),target=randomUUID();
 for(const descriptor of descriptors){const bytes=await f.objects.get(descriptor.blob.key);descriptor.blob.key=`${commentObjectPrefix(f.p,target)}/comment-bodies/${descriptor.blob.hash}.json`;await f.objects.putOnce(descriptor.blob.key,bytes!,descriptor.blob.mime);}
 f.rows.splice(0);await f.store.restoreBackupInTransaction(f.session,f.p,target,descriptors);
 expect(f.rows[0].payload.boardId).toBe(target);expect(f.rows[0].payload.comments[0].boardId).toBe(target);expect(f.rows[0].payload.comments[0]).not.toHaveProperty('body');
 const storage=new CommentBodyStorage(f.objects);expect((await storage.hydrate(f.p,target,f.rows[0].payload,descriptors[0]!.blob)).comments[0]?.body).toBe('中文 private body');
});
it('pins both comment roots in GC and rejects simultaneous legacy response plus pointer',async()=>{
 const sql=await readFile(new URL('../../migrations/20260927205000_whiteboard_comment_bodies.sql',import.meta.url),'utf8');
 expect(sql).toContain("whiteboard_guard_object_root('body_object_key')");expect(sql).toContain("whiteboard_guard_object_root('response_object_key')");
 expect(sql).toContain("UNION SELECT body_object_key,'comment-body'");expect(sql).toContain("UNION SELECT response_object_key,'comment-response'");expect(sql).toContain('response IS NULL');expect(sql).toContain("NOT jsonb_path_exists(payload,'$.comments[*].body')");
});

it('never publishes a legacy pointer when ObjectStore readback fails',async()=>{
 const f=await fixture(),bad={putOnce:f.objects.putOnce.bind(f.objects),head:f.objects.head.bind(f.objects),get:async()=>new Uint8Array([1])};
 const store=new PgWhiteboardCommentStore(f.db,{} as WhiteboardUpdateValidator,undefined,undefined,bad);
 await expect(store.list(f.p,f.boardId)).rejects.toMatchObject({code:'INTEGRITY_FAILED'});
 expect(f.rows[0].payload).toEqual(f.thread);expect(f.queries.some(query=>query.sql.startsWith('UPDATE whiteboard_comment'))).toBe(false);
});
