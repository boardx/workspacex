import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DatabasePort, QueryResult, TenantSession } from '../../src/application/ports/database.port';
import { toOrgId } from '../../src/domain/org-id';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';

const principal={orgId:toOrgId('lifecycle-cas-org'),userId:'owner'};
const boardId='9fe596a7-34bb-4fc5-8782-42fa6c4f3c98';
const now=new Date('2026-09-26T00:00:00.000Z');

class LifecycleDb implements DatabasePort,TenantSession {
  private turn: Promise<void>=Promise.resolve();
  private board={id:boardId,name:'Board',owner_id:principal.userId,role:'owner',archived:false,lifecycle_revision:0,
    tags_revision:0,tag_ids:[] as string[],created_at:now,updated_at:now};
  private receipt:{requestId:string;requestHash:string;boardId:string}|null=null;
  deleted=false;

  async withTenant<T>(_orgId: typeof principal.orgId, fn: (session: TenantSession) => Promise<T>): Promise<T> {
    let release!:()=>void; const previous=this.turn;
    this.turn=new Promise<void>(resolve=>{release=resolve;}); await previous;
    try{return await fn(this);}finally{release();}
  }
  async withoutTenant<T>(_fn:(session:TenantSession)=>Promise<T>):Promise<T>{throw new Error('forbidden');}
  async close():Promise<void>{}
  async query<R=Record<string,unknown>>(sql:string,params:readonly unknown[]=[]):Promise<QueryResult<R>>{
    if(sql.startsWith('SELECT archived,tags_revision,lifecycle_revision')) return this.rows(this.deleted?[]:[this.board]);
    if(sql.startsWith('UPDATE whiteboards SET name=')){
      const [, , , name, archived, tagsChanged, lifecycleChanged]=params;
      if(name!==null)this.board.name=String(name);
      if(archived!==null)this.board.archived=Boolean(archived);
      if(tagsChanged)this.board.tags_revision+=1;
      if(lifecycleChanged)this.board.lifecycle_revision+=1;
      return this.rows([]);
    }
    if(sql.startsWith('SELECT b.id,b.name')) return this.rows(this.deleted?[]:[this.board]);
    if(sql.startsWith('SELECT request_hash,board_id FROM whiteboard_delete_receipts')){
      const requestId=String(params[2]);
      return this.rows(this.receipt?.requestId===requestId?[{request_hash:this.receipt.requestHash,board_id:this.receipt.boardId}]:[]);
    }
    if(sql.startsWith('SELECT archived,lifecycle_revision FROM whiteboards')) return this.rows(this.deleted?[]:[this.board]);
    if(sql.startsWith('INSERT INTO whiteboard_delete_receipts')){
      this.receipt={requestId:String(params[2]),requestHash:String(params[3]),boardId:String(params[4])}; return this.rows([]);
    }
    if(sql.startsWith('DELETE FROM whiteboards')){this.deleted=true;return this.rows([]);}
    throw new Error(`unexpected SQL: ${sql}`);
  }
  private rows<R>(rows:unknown[]):QueryResult<R>{return {rows:rows as R[]};}
}

describe('whiteboard lifecycle CAS without PostgreSQL',()=>{
  it('allows only one concurrent transition from the same revision',async()=>{
    const db=new LifecycleDb(),repo=new PgWhiteboardRepository(db);
    const attempts=await Promise.allSettled([
      repo.update(principal,boardId,{archived:true,expectedLifecycleRevision:0}),
      repo.update(principal,boardId,{archived:true,expectedLifecycleRevision:0}),
    ]);
    expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const rejected=attempts.find(result=>result.status==='rejected') as PromiseRejectedResult;
    expect(rejected.reason).toEqual(expect.objectContaining({code:'REVISION_CONFLICT'}));
  });

  it('rejects a delete confirmed before restore and re-archive, then replays the current receipt',async()=>{
    const db=new LifecycleDb(),repo=new PgWhiteboardRepository(db);
    const first=await repo.update(principal,boardId,{archived:true,expectedLifecycleRevision:0});
    const stale={requestId:randomUUID(),confirmation:'PERMANENTLY_DELETE' as const,expectedLifecycleRevision:first!.lifecycleRevision};
    const restored=await repo.update(principal,boardId,{archived:false,expectedLifecycleRevision:first!.lifecycleRevision});
    const current=await repo.update(principal,boardId,{archived:true,expectedLifecycleRevision:restored!.lifecycleRevision});
    await expect(repo.permanentlyDelete(principal,boardId,stale)).rejects.toEqual(expect.objectContaining({code:'REVISION_CONFLICT'}));
    expect(db.deleted).toBe(false);
    const input={...stale,requestId:randomUUID(),expectedLifecycleRevision:current!.lifecycleRevision};
    const receipt=await repo.permanentlyDelete(principal,boardId,input);
    expect(receipt).toEqual({requestId:input.requestId,boardId,deleted:true});
    expect(await repo.permanentlyDelete(principal,boardId,input)).toEqual(receipt);
  });
});
