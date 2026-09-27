import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PgWhiteboardOperationUndoStore} from '../../src/infrastructure/whiteboard/pg-operation-undo-store';
const p={orgId:'tenant-a',userId:'user-a'} as any,board='board-a';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const bytes=new Uint8Array([0,0]);
const reference={epoch:1,seq:0,hash:hash(bytes),bytes:2,comments:[],key:`whiteboards/tenants/${hash(p.orgId).slice(0,32)}/boards/${board}/epochs/1/snapshots/0-${hash(bytes)}.yjs`};
describe('operation Undo reference boundary',()=>{
 it('reads only exact tenant board immutable before-image with verified bytes',async()=>{
  const get=vi.fn(async()=>bytes),store=new PgWhiteboardOperationUndoStore({} as any,{get,putOnce:vi.fn()});
  expect(await store.readBefore(p,board,reference)).toEqual(bytes);
  await expect(store.readBefore({...p,orgId:'foreign'},board,reference)).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
  await expect(store.readBefore(p,'foreign',reference)).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
  expect(get).toHaveBeenCalledTimes(1);
  get.mockResolvedValue(new Uint8Array([1,1]));await expect(store.readBefore(p,board,reference)).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
 });
 it('comment restore must match archived revision and affect exactly one row',async()=>{
  const store=new PgWhiteboardOperationUndoStore({} as any,{} as any),query=vi.fn(async(_sql:string,_args:unknown[])=>({rows:[]})),session={query} as any,value={...reference,comments:[{id:'comment',status:'open',revision:4}]};
  await expect(store.checkComments(session,p,board,value)).rejects.toMatchObject({code:'STALE_REVISION'});
  await expect(store.restoreComments(session,p,board,value)).rejects.toMatchObject({code:'STALE_REVISION'});
  expect(query.mock.calls[1]?.[1]).toEqual([p.orgId,board,'comment','open',5]);
 });
 it('pins narrow tenant metadata and prior fresh authorization; mutations break the guard',()=>{
  const source=readFileSync('src/infrastructure/whiteboard/pg-operation-undo-store.ts','utf8'),service=readFileSync('src/application/whiteboard/operation-service.ts','utf8');
  const guard=(text:string)=>{
   expect(text).not.toContain('withoutTenant');
   const tables=[...text.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(whiteboard_\w+)/g)].map(m=>m[1]);
   expect(new Set(tables)).toEqual(new Set(['whiteboard_documents','whiteboard_comment_threads','whiteboard_asset_refs','whiteboard_operation_undo','whiteboard_operations']));
   expect(text).toContain('u.org_id=$1 AND u.board_id=$2 AND u.operation_id=$3');
   expect(text).toContain('await this.collaboration.loadInTransaction(session,p,boardId)');
   expect(text).toContain("AND revision=$5 RETURNING id");
   expect(text).not.toMatch(/SELECT\s+(?:\*|payload|snapshot|update_bytes)/i);
  };guard(source);
  for(const mutated of [source.replace('u.org_id=$1 AND ',' '),source.replace('await this.collaboration.loadInTransaction(session,p,boardId)',''),source.replace('RETURNING id',''),source+' SELECT * FROM whiteboard_secrets'])expect(()=>guard(mutated)).toThrow();
  expect(service).toContain('stored.ownerUserId!==principal.userId');expect(service).toContain('registered.delegatedBy!==principal.userId');
 });
});
it('keeps Undo metadata append-only and tenant-frozen without inline object content',()=>{
 const sql=readFileSync('migrations/20260927234000_whiteboard_operation_undo.sql','utf8');
 expect(sql).toContain('FORCE ROW LEVEL SECURITY');expect(sql).toContain('GRANT SELECT,INSERT');expect(sql).toContain('kernel_apply_org_freeze_policies()');expect(sql).toContain("whiteboard_guard_object_root('object_key')");expect(sql).not.toMatch(/\bbytea\b|GRANT[^;]*UPDATE/i);
});

it.each(['checkpoints','restores','recovered'])('captures restored %s content as an epoch-bound immutable Undo image',async kind=>{
 const id='00000000-0000-4000-8000-000000000001', prefix=reference.key.split('/epochs/')[0];
 const key=kind==='recovered'?`${prefix}/epochs/1/recovered/${id}-${reference.hash}.yjs`:`${prefix}/${kind}/${id}-${reference.hash}.yjs`;
 const blobs=new Map<string,Uint8Array>([[key,bytes]]),get=vi.fn(async(k:string)=>blobs.get(k)??null),putOnce=vi.fn(async(k:string,b:Uint8Array)=>{blobs.set(k,b);});
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('FROM whiteboard_documents')?[{epoch:1,seq:'0',object_key:key,content_hash:reference.hash,byte_size:'2'}]:[]}));
 const store=new PgWhiteboardOperationUndoStore({loadInTransaction:async()=>({epoch:1,seq:0,update:bytes})} as any,{get,putOnce} as any);
 const captured=await store.capture({query} as any,p,board);
 expect(captured.key).toBe(reference.key);
 expect(await store.readBefore(p,board,captured)).toEqual(bytes);
 expect(putOnce).toHaveBeenCalledTimes(1);
});

it.each(['cross-board','arbitrary-key','epoch','hash','size','write-failure','corrupt-readback'])('fails closed before publishing Undo metadata: %s',async failure=>{
 const prefix=reference.key.split('/epochs/')[0],id='00000000-0000-4000-8000-000000000001';
 let key=`${prefix}/checkpoints/${id}-${reference.hash}.yjs`;
 if(failure==='cross-board')key=key.replace('/board-a/','/board-b/');
 if(failure==='arbitrary-key')key=`${prefix}/assets/${reference.hash}`;
 if(failure==='epoch')key=`${prefix}/epochs/2/recovered/${id}-${reference.hash}.yjs`;
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('FROM whiteboard_documents')?[{epoch:1,seq:'0',object_key:key,content_hash:failure==='hash'?'a'.repeat(64):reference.hash,byte_size:failure==='size'?'3':'2'}]:[]}));
 const putOnce=vi.fn(async()=>{if(failure==='write-failure')throw new Error('offline');});
 const store=new PgWhiteboardOperationUndoStore({loadInTransaction:async()=>({epoch:1,seq:0,update:bytes})} as any,{putOnce,get:async()=>failure==='corrupt-readback'?new Uint8Array([1,1]):bytes});
 await expect(store.capture({query} as any,p,board)).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
 expect(query.mock.calls.some(([sql])=>/INSERT|UPDATE/.test(sql))).toBe(false);
 if(!['write-failure','corrupt-readback'].includes(failure))expect(putOnce).not.toHaveBeenCalled();
});

it('pins the normalized immutable blob when publishing an Undo receipt',async()=>{
 const query=vi.fn(async(_sql:string,_params:unknown[])=>({rows:[]})),store=new PgWhiteboardOperationUndoStore({} as any,{} as any);
 await store.record({query} as any,p,{boardId:board,operationId:'operation'} as any,reference);
 expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO whiteboard_asset_refs');
 expect(query.mock.calls[0]?.[1]).toEqual([p.orgId,board,reference.key,reference.hash,reference.bytes]);
 expect(query.mock.calls[1]?.[0]).toContain('INSERT INTO whiteboard_operation_undo');
});
