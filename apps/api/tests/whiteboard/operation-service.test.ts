import {randomUUID} from 'node:crypto';
import type {WhiteboardOperationUndoStore,StoredOperationUndo} from '../../src/application/whiteboard/operation-undo-ports';
import { describe, expect, it } from 'vitest';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { WhiteboardOperationError, WhiteboardOperationService } from '../../src/application/whiteboard/operation-service';
import type { WhiteboardOperationAuditRepository } from '../../src/application/whiteboard/operation-ports';
import { toOrgId } from '../../src/domain/org-id';
import { readFileSync } from 'node:fs';

export const boardId='00000000-0000-4000-8000-000000000001',requestId='00000000-0000-4000-8000-000000000002';
export const principal={orgId:toOrgId('org-1'),userId:'user-1'};
const actor={kind:'ai',actorId:'agent-1',orgId:'org-1',role:'editor',scopes:['board:read','board:write'],delegatedBy:'user-1'};
const object={id:'n1',schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:100,height:100,rotation:0},text:'idea',style:{},parentId:null,orderKey:''};
export const request={apiVersion:'2026-09-01',requestId,boardId,expectedRevision:{epoch:1,seq:0},actor,commands:[{type:'create',object}],provenance:{source:'ai-proposal',model:'gpt',skill:'cluster',inputObjectIds:[]}};

class Session implements TenantSession{
  operations=new Map<string,{request_hash:string;receipt:unknown}>();events:unknown[]=[];queries:string[]=[];
  async query<R>(sql:string,params:readonly unknown[]=[]){this.queries.push(sql);
    if(sql.startsWith('SELECT request_hash')){const value=this.operations.get(String(params[2]));return{rows:(value?[value]:[]) as R[]};}
    if(sql.includes('SELECT d.epoch'))return{rows:[{epoch:1,seq:'0',actor_role:'editor'}] as R[]};
    if(sql.startsWith('INSERT INTO whiteboard_operations')){this.operations.set(String(params[2]),{request_hash:String(params[3]),receipt:JSON.parse(String(params[7]))});return{rows:[]};}
    if(sql.startsWith('INSERT INTO whiteboard_operation_events')){this.events.push(JSON.parse(String(params[6])));return{rows:[]};}
    if(sql.startsWith('SELECT 1 FROM whiteboards'))return{rows:[{one:1}] as R[]};
    if(sql.startsWith('SELECT payload'))return{rows:this.events.map(payload=>({payload,revision_seq:'1'})) as R[]};
    throw new Error(`unexpected SQL ${sql}`);
  }
}
export function fixture(){const session=new Session();const db:DatabasePort={withTenant:async(_org,fn)=>fn(session),withoutTenant:async fn=>fn(session),close:async()=>{}};
  const collaboration={writeCommandsInTransaction:async()=>({durability:'pending' as const,epoch:1,seq:1,updateId:requestId,replayed:false,update:new Uint8Array([1])})} as unknown as WhiteboardCollaborationStore;
  const audit:WhiteboardOperationAuditRepository={
    replay:async(_s,_p,_b,id)=>{session.queries.push('audit.replay');const value=session.operations.get(id);return value?{requestHash:value.request_hash,receipt:value.receipt as never}:null;},
    lockHead:async()=>{session.queries.push('audit.lockHead');return{epoch:1,seq:0,actorRole:'editor'};},
    append:async(_s,_p,input)=>{session.queries.push('audit.append.operation');session.operations.set(input.receipt.requestId,{request_hash:input.requestHash,receipt:input.receipt});session.queries.push('audit.append.event');session.events.push(input.event);},
    canRead:async()=>true,events:async()=>session.events as never[],
    resolveActor:async()=>({actorId:'agent-1',kind:'ai',delegatedBy:'user-1',scopes:['board:read','board:write'],model:'gpt',skill:'cluster'}),canReadArtifact:async()=>true,readArtifactSource:async()=>null,issueArtifactLayoutBinding:async()=>{},
  };
  audit.lockRuntimeActor=async(s,p,id)=>{const actor=await audit.resolveActor(s,p,id);return actor?{actor,agentVersionId:'v1',model:actor.model!,skillVersionIds:[actor.skill!]}:null;};
  const undoRecords=new Map<string,StoredOperationUndo>();
  const undoStore:WhiteboardOperationUndoStore={capture:async()=>({epoch:1,seq:0,key:'before',hash:'digest',bytes:2,comments:[]}),record:async(_s,p,receipt,before)=>{undoRecords.set(receipt.operationId,{ownerUserId:p.userId,undoId:randomUUID(),receipt,before});},get:async(_s,_p,_b,id)=>undoRecords.get(id)??null,readBefore:async()=>new Uint8Array([0,0]),checkComments:async()=>{},restoreComments:async()=>{}};
  collaboration.compensateInTransaction=async()=>({durability:'pending',epoch:1,seq:2,updateId:randomUUID(),gestureId:'undo',replayed:false,update:new Uint8Array([0,0])});
  return{session,audit,collaboration,undoStore,undoRecords,service:new WhiteboardOperationService(db,collaboration,audit,()=>new Date('2026-09-26T00:00:00.000Z'),undefined,undefined,undoStore)};}

describe('versioned Board operation API application service',()=>{
  it('ships tenant-forced append-only audit/event storage',()=>{const sql=readFileSync(new URL('../../migrations/20260926163000_whiteboard_operation_api.sql',import.meta.url),'utf8');expect(sql).toContain('FORCE ROW LEVEL SECURITY');expect(sql).toContain('GRANT SELECT,INSERT');expect(sql).not.toContain('GRANT SELECT, INSERT, UPDATE, DELETE');expect(sql).toContain('kernel_apply_org_freeze_policies');});
  it('binds delegated identity and atomically records collaboration receipt, audit and event',async()=>{const{service,session}=fixture();const receipt=await service.execute(principal,boardId,request);
    expect(receipt).toMatchObject({boardId,replayed:false,revision:{epoch:1,seq:1},events:[{type:'AIOrganized',actor:{kind:'ai'},objectIds:['n1']}]});
    expect(session.queries.indexOf('audit.append.operation')).toBeLessThan(session.queries.indexOf('audit.append.event'));
  });
  it('returns a replay after a fresh access check without a second mutation and rejects payload reuse',async()=>{const{service,session}=fixture();await service.execute(principal,boardId,request);const count=session.queries.length;
    expect((await service.execute(principal,boardId,request)).replayed).toBe(true);expect(session.queries.slice(count)).toEqual(['audit.lockHead','audit.replay']);
    await expect(service.execute(principal,boardId,{...request,commands:[{type:'create',object:{...object,text:'changed'}}]})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('fails closed for impersonation and stale revisions',async()=>{const{service}=fixture();
    await expect(service.execute(principal,boardId,{...request,actor:{...actor,delegatedBy:'other'}})).rejects.toBeInstanceOf(WhiteboardOperationError);
    expect((await service.execute(principal,boardId,{...request,actor:{...actor,role:'owner',scopes:[]}})).events[0]?.actor).toMatchObject({role:'editor',scopes:['board:read','board:write']});
    await expect(service.execute(principal,boardId,{...request,requestId:'00000000-0000-4000-8000-000000000003',expectedRevision:{epoch:1,seq:9}})).rejects.toMatchObject({code:'STALE_REVISION'});
  });
  it('serves ordered event subscriptions from an explicit cursor',async()=>{const{service}=fixture();await service.execute(principal,boardId,request);const page=await service.events(principal,boardId,{afterSeq:0,limit:10});expect(page.events).toHaveLength(1);expect(page.nextSeq).toBe(1);});
});
