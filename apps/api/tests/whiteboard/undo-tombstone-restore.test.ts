import { describe,expect,it } from 'vitest';
import { WhiteboardUndo,createWhiteboardDocument,executeCommands,readObjects } from '@repo/whiteboard-core';

const note=(id:string)=>({id,schemaVersion:1 as const,kind:'sticky' as const,geometry:{x:0,y:0,width:10,height:10,rotation:0},text:id,style:{},parentId:null,orderKey:id});

describe('authenticated tombstone restore semantics',()=>{
  it('undoes deletion with the original id and keeps connector references continuous',()=>{
    const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:note('target')},{type:'create',object:note('peer')},{type:'create',object:{...note('edge'),kind:'connector',connector:{from:'target',to:'peer',semanticRelation:'references'}}}],{});
    const undo=new WhiteboardUndo(doc);undo.execute([{type:'delete',id:'target'}]);expect(readObjects(doc).some(item=>item.id==='target')).toBe(false);
    expect(undo.undo('delete-receipt')).toBe('undone');expect(readObjects(doc).find(item=>item.id==='target')?.id).toBe('target');
    expect(readObjects(doc).find(item=>item.id==='edge')?.connector).toMatchObject({from:'target',to:'peer'});
    undo.destroy();doc.destroy();
  });
});

import * as Y from 'yjs';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';
import { prepareWhiteboardUpdate } from '@repo/whiteboard-core';
it('real validator worker restores only the exact authoritative deletion proof and rejects raw clearing',async()=>{
 const validator=new WorkerWhiteboardUpdateValidator(),doc=createWhiteboardDocument();
 executeCommands(doc,[{type:'create',object:note('target')},{type:'create',object:note('peer')},{type:'create',object:{...note('edge'),kind:'connector',connector:{from:'target',to:'peer'}}}],{});
 const deletion=await validator.commands(Y.encodeStateAsUpdate(doc),[{type:'delete',id:'target'}]);
 expect(deletion.deletions?.map(p=>p.id).sort()).toEqual(['edge','target']);
 const restored=await validator.restoreDeletion(deletion.snapshot,deletion.deletions!);
 const result=createWhiteboardDocument();Y.applyUpdate(result,restored.snapshot);expect(readObjects(result).map(o=>o.id).sort()).toEqual(['edge','peer','target']);
 const authority=createWhiteboardDocument();Y.applyUpdate(authority,deletion.snapshot);
 expect(()=>prepareWhiteboardUpdate(authority,restored.update)).toThrow('TOMBSTONE_CHANGED');
 for(const proof of [deletion.deletions!.map(p=>({...p,digest:'wrong'})),deletion.deletions!.map(p=>({...p,tombstone:{...p.tombstone,clock:p.tombstone.clock+1}}))])await expect(validator.restoreDeletion(deletion.snapshot,proof)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 const changed=createWhiteboardDocument();Y.applyUpdate(changed,deletion.snapshot);
 changed.getMap<Y.Map<unknown>>('objects').get('target')!.set('geometry',{...note('target').geometry,x:99});
 await expect(validator.restoreDeletion(Y.encodeStateAsUpdate(changed),deletion.deletions!)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 const missingPeer=await validator.commands(deletion.snapshot,[{type:'delete',id:'peer'}]);
 await expect(validator.restoreDeletion(missingPeer.snapshot,deletion.deletions!)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 changed.destroy();doc.destroy();result.destroy();authority.destroy();
});

import {randomUUID} from 'node:crypto';
import {PgWhiteboardCollaborationStore} from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import {toOrgId} from '../../src/domain/org-id';
import type {DatabasePort,TenantSession} from '../../src/application/ports/database.port';
import type {WhiteboardUpdateValidator} from '../../src/application/whiteboard/collaboration-ports';
function restoreFixture(){
 const principal={orgId:toOrgId('undo-proof'),userId:'owner'},boardId=randomUUID(),input={epoch:1,updateId:randomUUID(),gestureId:'undo',deleteGestureId:'delete',objectIds:['note']};
 const receipt={proof:[{id:'note',digest:'digest',tombstone:{client:1,clock:2}}],comments:[{id:randomUUID(),status:'resolved',revision:2}],restored_update_id:null as string|null};
 const state={owner:'owner',role:'viewer',archived:false,epoch:1,receipt:receipt as typeof receipt|null,commentRevision:3,commentStatus:'object-deleted',replay:null as null|{seq:string;request_hash:string;update:Buffer},committed:false};
 const writes:string[]=[];const params:unknown[][]=[];
 const session:TenantSession={async query<R>(sql:string,args:readonly unknown[]=[]){
  params.push([...args]);if(/^(INSERT INTO whiteboard_updates|UPDATE whiteboard_documents|UPDATE whiteboard_comment_threads|UPDATE whiteboard_deletion_receipts|INSERT INTO whiteboard_collaboration_events)/.test(sql))writes.push(sql);
  let rows:unknown[]=[];
  if(sql.startsWith('SELECT owner_id'))rows=[{owner_id:state.owner,archived:state.archived}];
  else if(sql.startsWith('SELECT role'))rows=[{role:state.role}];
  else if(sql.startsWith('SELECT epoch'))rows=[{epoch:state.epoch,seq:'4',snapshot:Buffer.from([0,0])}];
  else if(sql.startsWith('SELECT proof')){expect(args).toEqual([principal.orgId,boardId,input.epoch,principal.userId,input.deleteGestureId]);rows=state.receipt?[state.receipt]:[];}
  else if(sql.startsWith('SELECT status,revision'))rows=[{status:state.commentStatus,revision:state.commentRevision}];
  else if(sql.startsWith('SELECT seq,request_hash'))rows=state.replay?[state.replay]:[];
  else if(sql.startsWith('SELECT count'))rows=[{count:'0'}];
  return{rows:rows as R[]};
 }};
 const validator:WhiteboardUpdateValidator={objects:async()=>[],objectIds:async()=>['note'],diff:async s=>s,validate:async()=>{throw new Error('raw validator must not restore')},commands:async()=>{throw new Error('proof required')},restoreDeletion:async()=>({snapshot:new Uint8Array([0,0]),update:new Uint8Array([0,0])})};
 const db:DatabasePort={withTenant:async(_org,run)=>{try{const result=await run(session);state.committed=true;return result;}catch(e){writes.length=0;throw e;}},withoutTenant:async()=>{throw new Error('tenant required')},close:async()=>{}};
 return{principal,boardId,input,receipt,state,writes,params,validator,store:new PgWhiteboardCollaborationStore(db,validator)};
}
it('authorized receipt restore commits original-object update, prior comment status, audit and consumed marker atomically',async()=>{
 const f=restoreFixture(),result=await f.store.restoreDeletion(f.principal,f.boardId,f.input);
 expect(f.state.committed).toBe(true);expect(result).toMatchObject({gestureId:'undo',seq:5,replayed:false});expect(result).not.toHaveProperty('durability');
 expect(f.writes.some(q=>q.startsWith('UPDATE whiteboard_comment_threads'))).toBe(true);expect(f.params).toContainEqual([f.principal.orgId,f.boardId,f.receipt.comments[0]!.id,'resolved']);
 expect(f.writes.some(q=>q.startsWith('UPDATE whiteboard_deletion_receipts'))).toBe(true);expect(f.writes.some(q=>q.startsWith('INSERT INTO whiteboard_collaboration_events'))).toBe(true);
});
it.each(['foreign-actor','viewer','archived','epoch','ids','consumed','comment-changed','proof-changed'] as const)('rejects %s restoration with zero committed writes',async reason=>{
 const f=restoreFixture();
 if(reason==='foreign-actor')f.state.receipt=null;
 if(reason==='viewer'){f.state.owner='other';f.state.role='viewer';}
 if(reason==='archived')f.state.archived=true;
 if(reason==='epoch')f.state.epoch=2;
 if(reason==='ids')f.input.objectIds=['unrelated'];
 if(reason==='consumed')f.receipt.restored_update_id=randomUUID();
 if(reason==='comment-changed')f.state.commentRevision=4;
 if(reason==='proof-changed')f.validator.restoreDeletion=async()=>{throw new Error('RESTORE_CONFLICT')};
 await expect(f.store.restoreDeletion(f.principal,f.boardId,f.input)).rejects.toThrow();expect(f.state.committed).toBe(false);expect(f.writes).toEqual([]);
});

it('identical restore replay returns the first ACK with no repeated writes; changed payload is rejected',async()=>{
 const f=restoreFixture();await f.store.restoreDeletion(f.principal,f.boardId,f.input);
 const written=f.params.find(args=>args[5]===f.input.updateId&&typeof args[6]==='string'&&args[6].length===64)!;
 f.state.replay={seq:'5',request_hash:written[6] as string,update:Buffer.from([0,0])};f.receipt.restored_update_id=f.input.updateId;f.writes.length=0;
 expect(await f.store.restoreDeletion(f.principal,f.boardId,f.input)).toMatchObject({replayed:true,seq:5,gestureId:'undo'});expect(f.writes).toEqual([]);
 await expect(f.store.restoreDeletion(f.principal,f.boardId,{...f.input,gestureId:'changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});expect(f.writes).toEqual([]);
});
