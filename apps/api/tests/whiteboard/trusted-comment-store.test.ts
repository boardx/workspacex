import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgWhiteboardCommentStore } from '../../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import { WhiteboardCollaborationError,type WhiteboardCollaborationStore,type WhiteboardUpdateValidator } from '../../src/application/whiteboard/collaboration-ports';
import type { DatabasePort,TenantSession } from '../../src/application/ports/database.port';
import { toOrgId } from '../../src/domain/org-id';
import { decideWhiteboardAccess } from '../../src/domain/whiteboard/access-decision';

it('uses an explicit private-board ACL decision for every disclosed tenant row',()=>{
  expect(decideWhiteboardAccess({decisionId:'owner-write',role:'owner',action:'write'})).toMatchObject({allowed:true});
  expect(decideWhiteboardAccess({decisionId:'editor-write',role:'editor',action:'write'})).toMatchObject({allowed:true});
  expect(decideWhiteboardAccess({decisionId:'commenter-comment',role:'commenter',action:'comment'})).toMatchObject({allowed:true});
  expect(decideWhiteboardAccess({decisionId:'commenter-write',role:'commenter',action:'write'})).toMatchObject({allowed:false});
  expect(decideWhiteboardAccess({decisionId:'viewer-write',role:'viewer',action:'write'})).toMatchObject({allowed:false,reasonCode:'PROJECT_ROLE_INSUFFICIENT'});
  expect(decideWhiteboardAccess({decisionId:'outsider-read',role:null,action:'read'})).toMatchObject({allowed:false,reasonCode:'NO_ORG_MEMBERSHIP'});
});

it('binds the authenticated actor, audits once, replays idempotently and keeps viewers read-only',async()=>{
  const boardId=randomUUID(),threadId=randomUUID(),commentId=randomUUID(),requestId=randomUUID(),principal={orgId:toOrgId('trusted-comments'),userId:'owner'};
  let role='owner',savedRequest:{request_id:string;hash:string;response:unknown;response_object_key:string;response_hash:string;response_bytes:number}|null=null;const threads:any[]=[],events:unknown[]=[];
  const session={query:async(sql:string,params:any[]=[])=>{
    if(sql.includes('CASE WHEN b.owner_id'))return{rows:[{owner_id:'owner',archived:false,role}]};
    if(sql.includes('SELECT request_hash,'))return{rows:savedRequest&&savedRequest.request_id===params[3]?[{...savedRequest,request_hash:savedRequest.hash}]:[]};
    if(sql.includes('response_object_key IS NULL'))return{rows:[]};
    if(sql.includes('body_object_key IS NULL'))return{rows:[]};
    if(sql.includes('SELECT snapshot,object_key FROM whiteboard_documents'))return{rows:[{snapshot:Buffer.from([0,0])}]};
    if(sql.includes('SELECT user_id FROM whiteboard_members'))return{rows:[{user_id:'owner'},{user_id:'mentioned'}]};
    if(sql.includes('FROM whiteboard_comment_threads')){if(!sql.startsWith('INSERT'))return{rows:threads};}
    if(sql.startsWith('INSERT INTO whiteboard_comment_threads')){threads.splice(0,threads.length,{id:params[2],object_id:params[3],status:params[4],revision:params[5],payload:JSON.parse(params[6]),body_object_key:params[7],body_hash:params[8],body_bytes:params[9]});return{rows:[]};}
    if(sql.startsWith('INSERT INTO whiteboard_collaboration_events')){events.push(JSON.parse(params[5]));return{rows:[]};}
    if(sql.startsWith('INSERT INTO whiteboard_comment_requests')){savedRequest={request_id:params[3],hash:params[4],response:null,response_object_key:params[5],response_hash:params[6],response_bytes:params[7]};return{rows:[]};}
    throw new Error(`unexpected SQL ${sql}`);
  }} as unknown as TenantSession;
  const db={withTenant:async(_org:string,work:(s:TenantSession)=>Promise<unknown>)=>work(session)} as unknown as DatabasePort;
  const validator={objectIds:async(bytes:Uint8Array)=>{expect(bytes).toEqual(new Uint8Array([9,8]));return ['note'];}} as unknown as WhiteboardUpdateValidator;
  let loaded=0;const collaboration={loadInTransaction:async(current:TenantSession,p:typeof principal,id:string)=>{expect(current).toBe(session);expect(p.orgId).toBe(principal.orgId);expect(id).toBe(boardId);loaded++;return{epoch:1,seq:2,role:'owner',archived:false,update:new Uint8Array([9,8])};}} as unknown as WhiteboardCollaborationStore;
  const blobs=new Map<string,Uint8Array>();const objects={putOnce:async(key:string,bytes:Uint8Array)=>{blobs.set(key,bytes);},get:async(key:string)=>blobs.get(key)??null,head:async(key:string)=>blobs.has(key)?{sizeBytes:blobs.get(key)!.length,mime:'application/json'}:null};
  const store=new PgWhiteboardCommentStore(db,validator,()=>new Date('2026-09-26T00:00:00.000Z'),collaboration,objects);
  const command={type:'create-comment' as const,requestId,threadId,commentId,objectId:'note',worldPosition:null,body:'trusted',mentions:[{userId:'mentioned'}],expectedRevision:0 as const};
  const accepted=await store.dispatch(principal,boardId,command);expect(accepted.threads[0]?.comments[0]?.authorId).toBe('owner');expect(events).toEqual([expect.objectContaining({type:'CommentCreated',actorId:'owner'})]);
  const replay=await store.dispatch(principal,boardId,command);expect(replay.replayed).toBe(true);expect(events).toHaveLength(1);expect(loaded).toBe(1);
  const resolved=await store.dispatch(principal,boardId,{type:'resolve',requestId:randomUUID(),threadId,resolved:true,expectedRevision:1});expect(resolved.threads[0]).toMatchObject({status:'resolved',revision:2,comments:[{body:'trusted'}]});
  await expect(store.dispatch(principal,boardId,{type:'reply',requestId:randomUUID(),threadId,commentId:randomUUID(),body:'stale',mentions:[],expectedRevision:1})).rejects.toMatchObject({code:'COMMENT_CONFLICT'});
  await store.dispatch(principal,boardId,{type:'resolve',requestId:randomUUID(),threadId,resolved:false,expectedRevision:2});
  await expect(store.dispatch(principal,boardId,{type:'reply',requestId:randomUUID(),threadId,commentId:randomUUID(),body:'invalid mention',mentions:[{userId:'outsider'}],expectedRevision:3})).rejects.toMatchObject({code:'INVALID_MENTION'});
  role='commenter';savedRequest=null;const world={...command,requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:null,worldPosition:{x:42,y:-12}};const commented=await store.dispatch({...principal,userId:'commenter'},boardId,world);expect(commented.threads[0]).toMatchObject({objectId:null,worldPosition:{x:42,y:-12}});
  role='viewer';await expect(store.dispatch({...principal,userId:'viewer'},boardId,{...command,requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID()})).rejects.toEqual(expect.objectContaining<Partial<WhiteboardCollaborationError>>({code:'FORBIDDEN'}));
});
