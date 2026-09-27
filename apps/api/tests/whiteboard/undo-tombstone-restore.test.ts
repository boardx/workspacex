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
 expect(deletion.objectIds).toEqual(['peer']);
 expect([...restored.objectIds].sort()).toEqual(['edge','peer','target']);
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

import {createHash,randomUUID} from 'node:crypto';
import {PgWhiteboardCollaborationStore} from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import {toOrgId} from '../../src/domain/org-id';
import type {DatabasePort,TenantSession} from '../../src/application/ports/database.port';
import type {WhiteboardUpdateValidator} from '../../src/application/whiteboard/collaboration-ports';
function restoreFixture(){
 const principal={orgId:toOrgId('undo-proof'),userId:'owner'},boardId=randomUUID(),input={epoch:1,updateId:randomUUID(),gestureId:'undo',deleteGestureId:'delete',objectIds:['note']};
 const receipt={proof:[{id:'note',digest:'digest',tombstone:{client:1,clock:2}}],comments:[{id:randomUUID(),status:'resolved',revision:2}],restored_update_id:null as string|null};
 const state={owner:'owner',role:'viewer',archived:false,epoch:1,receipt:receipt as typeof receipt|null,commentRevision:3,commentStatus:'object-deleted',replay:null as null|{seq:string;request_hash:string;update:Buffer|null;update_object_key:string;update_hash:string;update_size:string},committed:false};
 const initialHash=createHash('sha256').update(new Uint8Array([0,0])).digest('hex'),initialKey=`whiteboards/tenants/${createHash('sha256').update(principal.orgId).digest('hex').slice(0,32)}/boards/${boardId}/epochs/1/snapshots/4-${initialHash}.yjs`;
 const blobs=new Map<string,Uint8Array>([[initialKey,new Uint8Array([0,0])]]);
 const objects={putOnce:async(key:string,value:Uint8Array)=>{blobs.set(key,new Uint8Array(value));},get:async(key:string)=>blobs.get(key)??null,head:async(key:string)=>blobs.has(key)?{sizeBytes:blobs.get(key)!.byteLength,mime:'application/vnd.yjs-update'}:null};
 const writes:string[]=[];const params:unknown[][]=[];
 const session:TenantSession={async query<R>(sql:string,args:readonly unknown[]=[]){
  params.push([...args]);if(/^(INSERT INTO whiteboard_updates|UPDATE whiteboard_documents|UPDATE whiteboard_comment_threads|UPDATE whiteboard_deletion_receipts|INSERT INTO whiteboard_collaboration_events|INSERT INTO whiteboard_deletion_receipts)/.test(sql))writes.push(sql);
  let rows:unknown[]=[];
  if(sql.startsWith('SELECT owner_id'))rows=[{owner_id:state.owner,archived:state.archived}];
  else if(sql.startsWith('SELECT role'))rows=[{role:state.role}];
  else if(sql.startsWith('SELECT epoch'))rows=[{epoch:state.epoch,seq:'4',snapshot:null,object_key:initialKey,content_hash:initialHash,byte_size:'2'}];
  else if(sql.startsWith('SELECT proof')){expect(args).toEqual([principal.orgId,boardId,input.epoch,principal.userId,input.deleteGestureId]);rows=state.receipt?[state.receipt]:[];}
  else if(sql.startsWith('SELECT status,revision'))rows=[{status:state.commentStatus,revision:state.commentRevision}];
  else if(sql.startsWith('SELECT seq,request_hash'))rows=state.replay?[state.replay]:[];
  else if(sql.startsWith('SELECT count'))rows=[{count:'0'}];
  else if(sql.startsWith('INSERT INTO whiteboard_deletion_receipts'))rows=[{delete_update_id:args[5]}];
  return{rows:rows as R[]};
 }};
 const validator:WhiteboardUpdateValidator={objects:async()=>[],objectIds:async()=>['note'],diff:async s=>s,validate:async()=>{throw new Error('raw validator must not restore')},commands:async()=>{throw new Error('proof required')},restoreDeletion:async()=>({objectIds:['note'],snapshot:new Uint8Array([0,0]),update:new Uint8Array([0,0])})};
 const db:DatabasePort={withTenant:async(_org,run)=>{try{const result=await run(session);state.committed=true;return result;}catch(e){writes.length=0;throw e;}},withoutTenant:async()=>{throw new Error('tenant required')},close:async()=>{}};
 return{principal,boardId,input,receipt,state,writes,params,validator,store:new PgWhiteboardCollaborationStore(db,validator,120,objects)};
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
 f.state.replay={seq:'5',request_hash:written[6] as string,update:null,update_object_key:written[7] as string,update_hash:written[8] as string,update_size:String(written[9])};f.receipt.restored_update_id=f.input.updateId;f.writes.length=0;
 expect(await f.store.restoreDeletion(f.principal,f.boardId,f.input)).toMatchObject({replayed:true,seq:5,gestureId:'undo'});expect(f.writes).toEqual([]);
 await expect(f.store.restoreDeletion(f.principal,f.boardId,{...f.input,gestureId:'changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});expect(f.writes).toEqual([]);
});

it('atomically compensates mixed deletion, text, parent and creation with before/after CAS and original IDs',async()=>{
 const validator=new WorkerWhiteboardUpdateValidator(),doc=createWhiteboardDocument();
 executeCommands(doc,[{type:'create',object:{...note('panel'),kind:'frame'}},{type:'create',object:note('target')},{type:'create',object:note('peer')}],{});
 const base=Y.encodeStateAsUpdate(doc);
 const {WhiteboardCommandOrigin}=await import('@repo/whiteboard-core');
 const undo=new WhiteboardUndo(doc,new WhiteboardCommandOrigin('board','client','mixed-delete','op','tx'));
 let delta:Uint8Array=new Uint8Array(),intent:unknown;
 doc.on('update',(update:Uint8Array,origin:unknown)=>{delta=update;intent=(origin as {restoreDeletion?:unknown})?.restoreDeletion;});
 undo.execute([{type:'delete',id:'target'},{type:'text',id:'peer',index:0,deleteCount:4,insert:'changed'},{type:'parent',id:'peer',parentId:'panel',orderKey:'peer'},{type:'create',object:note('created')}]);
 const deletion=await validator.validate(base,delta);
 expect(deletion.deletionChanges?.map(change=>change.id).sort()).toEqual(['created','peer','target']);
 expect(undo.undo('mixed-undo')).toBe('undone');
 expect(intent).toMatchObject({deleteGestureId:'mixed-delete',objectIds:['target'],includeInverse:true});
 const inverse=delta;
 await expect(validator.restoreDeletion(deletion.snapshot,deletion.deletions!,deletion.deletionChanges)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 const restored=await validator.restoreDeletion(deletion.snapshot,deletion.deletions!,deletion.deletionChanges,inverse);
 const restoredDoc=createWhiteboardDocument();Y.applyUpdate(restoredDoc,restored.snapshot);
 expect(readObjects(restoredDoc).map(o=>o.id).sort()).toEqual(['panel','peer','target']);
 expect(readObjects(restoredDoc).find(o=>o.id==='peer')).toMatchObject({text:'peer',parentId:null});
 expect(restored.deletions?.map(proof=>proof.id)).toEqual(['created']);
 expect(undo.redo('mixed-redo')).toBe(true);
 expect(intent).toMatchObject({deleteGestureId:'mixed-undo',objectIds:['created'],includeInverse:true});
 const redone=await validator.restoreDeletion(restored.snapshot,restored.deletions!,restored.deletionChanges,delta);
 const redoneDoc=createWhiteboardDocument();Y.applyUpdate(redoneDoc,redone.snapshot);
 expect(readObjects(redoneDoc).map(o=>o.id).sort()).toEqual(['created','panel','peer']);
 expect(readObjects(redoneDoc).find(o=>o.id==='peer')).toMatchObject({text:'changed',parentId:'panel'});
 expect(undo.undo('mixed-undo-again')).toBe('undone');
 expect(intent).toMatchObject({deleteGestureId:'mixed-redo',objectIds:['target'],includeInverse:true});
 const restoredAgain=await validator.restoreDeletion(redone.snapshot,redone.deletions!,redone.deletionChanges,delta);
 const again=createWhiteboardDocument();Y.applyUpdate(again,restoredAgain.snapshot);
 expect(readObjects(again)).toEqual(readObjects(restoredDoc));again.destroy();
 // A foreign field change after the receipt cannot be overwritten by this inverse.
 const foreign=await validator.commands(deletion.snapshot,[{type:'text',id:'peer',index:0,deleteCount:0,insert:'remote'}]);
 await expect(validator.restoreDeletion(foreign.snapshot,deletion.deletions!,deletion.deletionChanges,inverse)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 // A delta that also edits an unrelated object must not become authorized by the receipt.
 const hostile=createWhiteboardDocument();Y.applyUpdate(hostile,deletion.snapshot);Y.applyUpdate(hostile,inverse);
 executeCommands(hostile,[{type:'text',id:'panel',index:0,deleteCount:0,insert:'forged'}],{});
 await expect(validator.restoreDeletion(deletion.snapshot,deletion.deletions!,deletion.deletionChanges,Y.encodeStateAsUpdate(hostile,Y.encodeStateVectorFromUpdate(deletion.snapshot)))).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 undo.destroy();doc.destroy();restoredDoc.destroy();redoneDoc.destroy();hostile.destroy();
});

it('persists only actor-bound deletion integrity metadata in the same accepted update transaction',async()=>{
 const f=restoreFixture(),proof=f.receipt.proof;
 f.validator.validate=async()=>({objectIds:[],snapshot:new Uint8Array([0,0]),update:new Uint8Array([0,0]),deletions:proof,deletionChanges:[{id:'note',before:'before-digest',after:null}]});
 const ack=await f.store.append(f.principal,f.boardId,{epoch:1,updateId:f.input.updateId,gestureId:'delete-integrity',update:new Uint8Array([0,0])});
 expect(ack.seq).toBe(5);expect(f.state.committed).toBe(true);
 const metadata=f.params.find(args=>args[4]==='delete-integrity'&&args.length===10)!;
 expect(metadata.slice(0,7)).toEqual([f.principal.orgId,f.boardId,1,f.principal.userId,'delete-integrity',f.input.updateId,5]);
 expect(JSON.parse(metadata[7] as string)).toEqual(proof);
 expect(JSON.parse(metadata[9] as string)).toEqual([{id:'note',before:'before-digest',after:null}]);
 expect(f.writes.some(sql=>sql.startsWith('INSERT INTO whiteboard_deletion_receipts'))).toBe(true);
});
