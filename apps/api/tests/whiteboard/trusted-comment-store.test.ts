import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgWhiteboardCommentStore } from '../../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import { WhiteboardCollaborationError,type WhiteboardUpdateValidator } from '../../src/application/whiteboard/collaboration-ports';
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
  let role='owner',savedRequest:{hash:string;response:unknown}|null=null;const threads:unknown[]=[],events:unknown[]=[];
  const session={query:async(sql:string,params:any[]=[])=>{
    if(sql.includes('SELECT owner_id,archived FROM whiteboards'))return{rows:[{owner_id:'owner',archived:false}]};
    if(sql.includes('SELECT role FROM whiteboard_members'))return{rows:[{role}]};
    if(sql.includes('SELECT request_hash,response'))return{rows:savedRequest?[{request_hash:savedRequest.hash,response:savedRequest.response}]:[]};
    if(sql.includes('SELECT snapshot FROM whiteboard_documents'))return{rows:[{snapshot:Buffer.from([0,0])}]};
    if(sql.includes('SELECT om.user_id FROM org_memberships'))return{rows:[{user_id:'owner'},{user_id:'mentioned'}]};
    if(sql.includes('SELECT payload FROM whiteboard_comment_threads'))return{rows:threads.map(payload=>({payload}))};
    if(sql.startsWith('INSERT INTO whiteboard_comment_threads')){threads.splice(0,threads.length,JSON.parse(params[6]));return{rows:[]};}
    if(sql.startsWith('INSERT INTO whiteboard_collaboration_events')){events.push(JSON.parse(params[5]));return{rows:[]};}
    if(sql.startsWith('INSERT INTO whiteboard_comment_requests')){savedRequest={hash:params[4],response:JSON.parse(params[5])};return{rows:[]};}
    throw new Error(`unexpected SQL ${sql}`);
  }} as unknown as TenantSession;
  const db={withTenant:async(_org:string,work:(s:TenantSession)=>Promise<unknown>)=>work(session)} as unknown as DatabasePort;
  const validator={objectIds:async()=>['note']} as unknown as WhiteboardUpdateValidator;
  const store=new PgWhiteboardCommentStore(db,validator,()=>new Date('2026-09-26T00:00:00.000Z'));
  const command={type:'create-comment' as const,requestId,threadId,commentId,objectId:'note',worldPosition:null,body:'trusted',mentions:[{userId:'mentioned'}],expectedRevision:0 as const};
  const accepted=await store.dispatch(principal,boardId,command);expect(accepted.threads[0]?.comments[0]?.authorId).toBe('owner');expect(events).toEqual([expect.objectContaining({type:'CommentCreated',actorId:'owner'})]);
  const replay=await store.dispatch(principal,boardId,command);expect(replay.replayed).toBe(true);expect(events).toHaveLength(1);
  role='commenter';savedRequest=null;const world={...command,requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:null,worldPosition:{x:42,y:-12}};const commented=await store.dispatch({...principal,userId:'commenter'},boardId,world);expect(commented.threads[0]).toMatchObject({objectId:null,worldPosition:{x:42,y:-12}});
  role='viewer';await expect(store.dispatch({...principal,userId:'viewer'},boardId,{...command,requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID()})).rejects.toEqual(expect.objectContaining<Partial<WhiteboardCollaborationError>>({code:'FORBIDDEN'}));
});

// The lock waiter starts while the old role exists. Only a new statement after
// lock acquisition may observe the role committed by the preceding transaction.
for(const operation of ['list','new-command','replay'] as const)for(const roleAfter of [null,'viewer'] as const){
  it(`checks fresh membership after lock wait for ${operation}, role=${roleAfter}`,async()=>{
    let release!:()=>void,entered!:()=>void;
    const locked=new Promise<void>(resolve=>{entered=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const sqls:string[]=[];let role:string|null='commenter';
    const session={query:async(sql:string)=>{
      sqls.push(sql);
      if(sql.includes('FROM whiteboards')){
        expect(sql).not.toContain('JOIN');expect(sql).toContain('FOR UPDATE');
        entered();await gate;return{rows:[{owner_id:'owner',archived:false}]};
      }
      if(sql.includes('SELECT role FROM whiteboard_members'))return{rows:role?[{role}]:[]};
      if(sql.includes('SELECT payload FROM whiteboard_comment_threads'))return{rows:[]};
      throw new Error('Unauthorized content or replay SQL reached');
    }} as unknown as TenantSession;
    const db={withTenant:async(_org:string,work:(s:TenantSession)=>Promise<unknown>)=>work(session)} as unknown as DatabasePort;
    const store=new PgWhiteboardCommentStore(db,{} as WhiteboardUpdateValidator);
    const principal={orgId:toOrgId('fresh-comment-acl'),userId:'member'},boardId=randomUUID();
    const command={type:'create-comment' as const,requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:null,worldPosition:{x:1,y:2},body:'not published',mentions:[],expectedRevision:0 as const};
    // Replay has an existing receipt in the real-PG producer. Here any receipt
    // query is forbidden before the newly committed ACL has been checked.
    const pending=operation==='list'?store.list(principal,boardId):store.dispatch(principal,boardId,command);
    const result=pending.then(value=>({value}),error=>({error}));
    await locked;expect(sqls).toHaveLength(1);role=roleAfter;release();
    const outcome=await result;
    if(operation==='list'&&roleAfter==='viewer')expect(outcome).toEqual({value:[]});
    else expect(outcome).toMatchObject({error:{code:roleAfter===null?'NOT_FOUND':'FORBIDDEN'}});
    expect(sqls[1]).toContain('SELECT role FROM whiteboard_members');
    expect(sqls.every(sql=>!sql.includes('comment_requests')&&!sql.startsWith('INSERT'))).toBe(true);
  });
}

import { PgWhiteboardRecoveryAdapter } from '../../src/infrastructure/whiteboard/pg-whiteboard-recovery';
import type { WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import type { WhiteboardCheckpointManifest, WhiteboardCollaborationEvent } from '@repo/contracts/whiteboard-collaboration';

for(const operation of ['head','getCheckpoint','findCheckpointRequest','findRestore','recoveryCandidates','updatesBetween','saveCheckpoint','commitRestore'] as const){
  it(`recovery ${operation} rejects removal committed while waiting for the board lock`,async()=>{
    let release!:()=>void,entered!:()=>void;
    const enteredLock=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    let role:string|null='editor';const sqls:string[]=[];
    const session={query:async(sql:string)=>{
      sqls.push(sql);
      if(sql.includes('FROM whiteboards')){expect(sql).not.toContain('JOIN');expect(sql).toContain('FOR UPDATE');entered();await gate;return{rows:[{owner_id:'owner',archived:false}]};}
      if(sql.includes('SELECT role FROM whiteboard_members'))return{rows:role?[{role}]:[]};
      throw new Error('Recovery content reached after revocation');
    }} as unknown as TenantSession;
    const db={withTenant:async(_org:string,work:(s:TenantSession)=>Promise<unknown>)=>work(session)} as unknown as DatabasePort;
    const adapter=new PgWhiteboardRecoveryAdapter(db,{} as WhiteboardCollaborationStore);
    const p={orgId:toOrgId('recovery-fresh-acl'),userId:'editor'},boardId=randomUUID(),id=randomUUID();
    const manifest={boardId} as WhiteboardCheckpointManifest,event={} as WhiteboardCollaborationEvent;
    const invoke=()=>{
      switch(operation){
        case 'head':return adapter.head(p,boardId);
        case 'getCheckpoint':return adapter.getCheckpoint(p,boardId,id);
        case 'findCheckpointRequest':return adapter.findCheckpointRequest(p,boardId,id);
        case 'findRestore':return adapter.findRestore(p,boardId,id);
        case 'recoveryCandidates':return adapter.recoveryCandidates(p,boardId,1,2);
        case 'updatesBetween':return adapter.updatesBetween(p,boardId,1,0,2);
        case 'saveCheckpoint':return adapter.saveCheckpoint(p,manifest,id,event);
        case 'commitRestore':return adapter.commitRestore(p,{boardId,checkpoint:manifest,snapshot:new Uint8Array([0,0]),newEpoch:2,expectedEpoch:1,expectedSeq:0,requestId:id,event,auditEvents:[]});
      }
    };
    const result=invoke().then(value=>({value}),error=>({error}));
    await enteredLock;expect(sqls).toHaveLength(1);role=null;release();
    expect(await result).toMatchObject({error:{code:'NOT_FOUND'}});expect(sqls).toHaveLength(2);
  });
}
for(const role of ['viewer','commenter','editor','owner'])for(const archived of [true,false]){
  it(`checkpoint final publication gates role=${role}, archived=${archived} before replay or insertion`,async()=>{
    const sqls:string[]=[];
    const session={query:async(sql:string)=>{sqls.push(sql);
      if(sql.includes('FROM whiteboards'))return{rows:[{owner_id:'owner',archived}]};
      if(sql.includes('SELECT role FROM whiteboard_members'))return{rows:[{role}]};
      if(sql.includes('SELECT manifest'))return{rows:[]};
      if(sql.startsWith('INSERT INTO'))return{rows:[]};
      throw new Error(sql);
    }} as unknown as TenantSession;
    const db={withTenant:async(_org:string,work:(s:TenantSession)=>Promise<unknown>)=>work(session)} as unknown as DatabasePort;
    const adapter=new PgWhiteboardRecoveryAdapter(db,{} as WhiteboardCollaborationStore);
    const p={orgId:toOrgId('checkpoint-final-acl'),userId:role==='owner'?'owner':'member'};
    const manifest={boardId:randomUUID(),checkpointId:randomUUID()} as WhiteboardCheckpointManifest;
    const pending=adapter.saveCheckpoint(p,manifest,randomUUID(),{eventId:randomUUID(),type:'CheckpointCreated'} as WhiteboardCollaborationEvent);
    if(archived||!['owner','editor'].includes(role)){
      await expect(pending).rejects.toMatchObject({code:'FORBIDDEN'});
      expect(sqls.some(sql=>sql.includes('whiteboard_checkpoints')||sql.startsWith('INSERT'))).toBe(false);
    }else{await expect(pending).resolves.toMatchObject({replayed:false});expect(sqls.filter(sql=>sql.startsWith('INSERT'))).toHaveLength(2);}
  });
}

for (const excluded of ['removed-from-org','different-board-member']) {
  it(`rejects ${excluded} at final mention validation before writing`, async () => {
    const boardId=randomUUID(), principal={orgId:toOrgId('mention-final-acl'),userId:'owner'};
    const writes:string[]=[];
    const session={query:async(sql:string,params:unknown[]=[])=>{
      if(sql.includes('SELECT owner_id,archived'))return{rows:[{owner_id:'owner',archived:false}]};
      if(sql.includes('SELECT request_hash,response'))return{rows:[]};
      if(sql.includes('SELECT snapshot'))return{rows:[{snapshot:Buffer.from([0,0])}]};
      if(sql.includes('SELECT om.user_id')){
        expect(params).toEqual([principal.orgId,boardId]);
        expect(sql).toContain('om.org_id=$1');expect(sql).toContain('m.board_id=$2 AND m.user_id=om.user_id');
        expect(sql).toContain('b.id=$2 AND b.owner_id=om.user_id');expect(sql).toContain('FOR SHARE OF om');
        return{rows:[{user_id:'owner'}]};
      }
      if(sql.includes('SELECT payload'))return{rows:[]};
      if(sql.startsWith('INSERT'))writes.push(sql);
      throw new Error('Unexpected write');
    }} as unknown as TenantSession;
    const db={withTenant:async(_org:unknown,work:(session:TenantSession)=>Promise<unknown>)=>work(session)} as unknown as DatabasePort;
    const store=new PgWhiteboardCommentStore(db,{objectIds:async()=>['note']} as unknown as WhiteboardUpdateValidator);
    await expect(store.dispatch(principal,boardId,{type:'create-comment',requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:'note',worldPosition:null,body:'restricted',mentions:[{userId:excluded}],expectedRevision:0})).rejects.toMatchObject({code:'INVALID_MENTION'});
    expect(writes).toEqual([]);
  });
}
