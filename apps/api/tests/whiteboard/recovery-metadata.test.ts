import { randomUUID } from 'node:crypto';
import { describe,expect,it,vi } from 'vitest';
import type { DatabasePort,TenantSession } from '../../src/application/ports/database.port';
import { PgWhiteboardRecoveryMetadata } from '../../src/infrastructure/whiteboard/pg-recovery-metadata';
import { toOrgId } from '../../src/domain/org-id';
import type { WhiteboardCheckpointManifest,WhiteboardCollaborationEvent } from '@repo/contracts/whiteboard-collaboration';
const p={orgId:toOrgId('recovery-metadata-org'),userId:'owner'},boardId='20000000-0000-4000-8000-000000000001';
function fixture(){let checkpoint:WhiteboardCheckpointManifest|null=null,head={epoch:2,seq:7},receipt:{request_hash:string;new_epoch:number}|null=null;const queries:{sql:string;params:readonly unknown[]}[]=[];const session:TenantSession={async query<R>(sql:string,params:readonly unknown[]=[]){queries.push({sql,params});let rows:unknown[]=[];if(sql.startsWith('SELECT owner_id'))rows=[{owner_id:p.userId,archived:false}];else if(sql.includes('FROM whiteboard_checkpoints'))rows=checkpoint?[{checkpoint_id:checkpoint.checkpointId,board_id:checkpoint.boardId,version:1,epoch:checkpoint.epoch,seq:String(checkpoint.seq),object_key:checkpoint.objectKey,content_hash:checkpoint.contentHash,byte_size:String(checkpoint.byteSize),created_by:checkpoint.createdBy,created_at:checkpoint.createdAt}]:[];else if(sql.startsWith('INSERT INTO whiteboard_checkpoints'))checkpoint={checkpointId:String(params[2]),boardId:String(params[1]),version:1,epoch:Number(params[4]),seq:Number(params[5]),objectKey:String(params[6]),contentHash:String(params[7]),byteSize:Number(params[8]),createdBy:String(params[9]),createdAt:String(params[10])};else if(sql.startsWith('SELECT request_hash'))rows=receipt?[receipt]:[];else if(sql.startsWith('SELECT epoch,seq::text FROM whiteboard_documents'))rows=[{epoch:head.epoch,seq:String(head.seq)}];else if(sql.startsWith('UPDATE whiteboard_documents'))head={epoch:Number(params[2]),seq:0};else if(sql.startsWith('INSERT INTO whiteboard_restore_receipts'))receipt={request_hash:String(params[3]),new_epoch:Number(params[6])};return{rows:rows as R[]};}};const db:DatabasePort={withTenant:async(_org,fn)=>fn(session),withoutTenant:async()=>{throw new Error('no')},close:async()=>{}};return{repo:new PgWhiteboardRecoveryMetadata(db),queries,get head(){return head}};}
const manifest=(id=randomUUID()):WhiteboardCheckpointManifest=>({checkpointId:id,boardId,version:1,epoch:2,seq:7,objectKey:`whiteboards/tenants/abc/boards/${boardId}/checkpoints/${id}.yjs`,contentHash:`sha256:${'a'.repeat(64)}`,byteSize:12,createdBy:p.userId,createdAt:'2026-09-26T00:00:00.000Z'});
describe('PostgreSQL recovery metadata adapter',()=>{
  it('stores only immutable checkpoint metadata and replays exact checkpoint ids',async()=>{const f=fixture(),value=manifest();const first=await f.repo.saveCheckpoint(p,value,value.checkpointId),second=await f.repo.saveCheckpoint(p,value,value.checkpointId);expect(first.replayed).toBe(false);expect(second.replayed).toBe(true);const insert=f.queries.find(query=>query.sql.startsWith('INSERT INTO whiteboard_checkpoints'))!;expect(insert.params).not.toContainEqual(expect.any(Uint8Array));expect(insert.sql).not.toContain('snapshot');});
  it('publishes a restore manifest by CAS and replays before testing the changed head',async()=>{const f=fixture(),checkpoint=manifest();await f.repo.saveCheckpoint(p,checkpoint,checkpoint.checkpointId);const requestId=randomUUID(),event:WhiteboardCollaborationEvent={type:'BoardRestored',eventId:requestId,operationId:requestId,boardId,checkpointId:checkpoint.checkpointId,previousEpoch:2,epoch:3,actorId:p.userId,occurredAt:'2026-09-26T00:01:00.000Z'};const input={boardId,checkpoint,snapshot:new Uint8Array([0,0]),auditEvents:[],newEpoch:3,expectedEpoch:2,expectedSeq:7,requestId,event};expect(await f.repo.commitRestore(p,input)).toEqual({epoch:3,seq:0,replayed:false,auditEvents:[]});expect(f.head).toEqual({epoch:3,seq:0});expect(await f.repo.commitRestore(p,input)).toEqual({epoch:3,seq:0,replayed:true,auditEvents:[]});const update=f.queries.find(query=>query.sql.startsWith('UPDATE whiteboard_documents'))!;expect(update.sql).toContain('snapshot=NULL');expect(update.params).not.toContainEqual(expect.any(Uint8Array));});
  it('unions project access in the same tenant session without granting project editors owner-only restore',async()=>{
    const projectMember={orgId:p.orgId,userId:'project-member'},queries:string[]=[];
    let checkpoint:WhiteboardCheckpointManifest|null=null;
    const session:TenantSession={async query<R>(sql:string,params:readonly unknown[]=[]){queries.push(sql);let rows:unknown[]=[];
      if(sql.startsWith('SELECT owner_id'))rows=[{owner_id:'board-owner',archived:false}];
      else if(sql.startsWith('SELECT role FROM whiteboard_members'))rows=[];
      else if(sql.startsWith('SELECT epoch,seq::text FROM whiteboard_documents'))rows=[{epoch:2,seq:'7'}];
      else if(sql.includes('FROM whiteboard_checkpoints'))rows=checkpoint?[{checkpoint_id:checkpoint.checkpointId,board_id:checkpoint.boardId,version:1,epoch:checkpoint.epoch,seq:String(checkpoint.seq),object_key:checkpoint.objectKey,content_hash:checkpoint.contentHash,byte_size:String(checkpoint.byteSize),created_by:checkpoint.createdBy,created_at:checkpoint.createdAt}]:[];
      else if(sql.startsWith('INSERT INTO whiteboard_checkpoints'))checkpoint={checkpointId:String(params[2]),boardId:String(params[1]),version:1,epoch:Number(params[4]),seq:Number(params[5]),objectKey:String(params[6]),contentHash:String(params[7]),byteSize:Number(params[8]),createdBy:String(params[9]),createdAt:String(params[10])};
      return{rows:rows as R[]};}};
    const db:DatabasePort={withTenant:async(_org,fn)=>fn(session),withoutTenant:async()=>{throw new Error('no')},close:async()=>{}};
    const roleIn=vi.fn(async(received:TenantSession)=>{expect(received).toBe(session);return 'editor' as const;});
    const repo=new PgWhiteboardRecoveryMetadata(db,undefined,{roleIn});
    await expect(repo.head(projectMember,boardId)).resolves.toMatchObject({role:'editor',epoch:2,seq:7});
    const checkpointValue={...manifest(),createdBy:projectMember.userId};
    await expect(repo.saveCheckpoint(projectMember,checkpointValue,checkpointValue.checkpointId)).resolves.toMatchObject({replayed:false});
    const restoreId=randomUUID(),event={type:'BoardRestored',eventId:restoreId,operationId:restoreId,boardId,checkpointId:checkpointValue.checkpointId,previousEpoch:2,epoch:3,actorId:projectMember.userId,occurredAt:'2026-09-26T00:02:00.000Z'} as const;
    await expect(repo.commitRestore(projectMember,{boardId,checkpoint:checkpointValue,snapshot:new Uint8Array([1]),auditEvents:[],newEpoch:3,expectedEpoch:2,expectedSeq:7,requestId:restoreId,event})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(roleIn).toHaveBeenCalledTimes(3);
    expect(queries.some(sql=>sql.startsWith('UPDATE whiteboard_documents'))).toBe(false);
  });
});

for(const operation of ['head','getCheckpoint','findCheckpointRequest','findRestore','recoveryCandidates','updatesBetween','saveCheckpoint','commitRestore'] as const){
  it(`recovery ${operation} rejects removal committed while waiting for the board lock`,async()=>{
    let release!:()=>void,entered!:()=>void;
    const enteredLock=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    let role:string|null='editor';const sqls:string[]=[];
    const session={query:async(sql:string)=>{
      sqls.push(sql);
      if(sql.includes('FROM whiteboards')){expect(sql).not.toContain('JOIN');expect(sql).toContain(operation==='saveCheckpoint'||operation==='commitRestore'?'FOR UPDATE':'FOR SHARE');entered();await gate;return{rows:[{owner_id:'owner',archived:false}]};}
      if(sql.includes('SELECT role FROM whiteboard_members'))return{rows:role?[{role}]:[]};
      throw new Error('Recovery content reached after revocation');
    }} as unknown as TenantSession;
    const db={withTenant:async(_org:string,work:(s:TenantSession)=>Promise<unknown>)=>work(session)} as unknown as DatabasePort;
    const adapter=new PgWhiteboardRecoveryMetadata(db);
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
        case 'saveCheckpoint':return adapter.saveCheckpoint(p,manifest,id);
        case 'commitRestore':return adapter.commitRestore(p,{boardId,checkpoint:manifest,snapshot:new Uint8Array([0,0]),newEpoch:2,expectedEpoch:1,expectedSeq:0,requestId:id,event,auditEvents:[]});
      }
    };
    const result=invoke().then(value=>({value}),error=>({error}));
    await enteredLock;expect(sqls).toHaveLength(1);role=null;release();
    expect(await result).toMatchObject({error:{code:'NOT_FOUND'}});expect(sqls).toHaveLength(2);
  });
}
for(const role of ['viewer','commenter','editor','owner'])for(const archived of [true,false]){
  if(!archived&&['owner','editor'].includes(role))continue;
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
    const adapter=new PgWhiteboardRecoveryMetadata(db);
    const p={orgId:toOrgId('checkpoint-final-acl'),userId:role==='owner'?'owner':'member'};
    const manifest={boardId:randomUUID(),checkpointId:randomUUID()} as WhiteboardCheckpointManifest;
    const pending=adapter.saveCheckpoint(p,manifest,randomUUID());
    if(archived||!['owner','editor'].includes(role)){
      await expect(pending).rejects.toMatchObject({code:'FORBIDDEN'});
      expect(sqls.some(sql=>sql.includes('whiteboard_checkpoints')||sql.startsWith('INSERT'))).toBe(false);
    }else{await expect(pending).resolves.toMatchObject({replayed:false});expect(sqls.filter(sql=>sql.startsWith('INSERT'))).toHaveLength(2);}
  });
}
