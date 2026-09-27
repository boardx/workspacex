import {expect,it,vi} from 'vitest';
import {fixture,principal,boardId,request} from './operation-service.test';
it('uses server before-reference and one immutable Undo id, authorizing before replay',async()=>{
 const f=fixture(),receipt=await f.service.execute(principal,boardId,request),compensate=vi.fn(f.collaboration.compensateInTransaction!);
 f.collaboration.compensateInTransaction=compensate;f.audit.lockHead=async()=>({epoch:1,seq:1,actorRole:'editor'});
 const result=await f.service.undo(principal,boardId,receipt.operationId,{expectedRevision:receipt.revision});
 expect(result.events[0]).toMatchObject({type:'OperationUndone',actor:{actorId:'agent-1'}});
 expect(compensate).toHaveBeenCalledWith(f.session,principal,boardId,expect.objectContaining({actorId:'agent-1',before:new Uint8Array([0,0])}));
 expect((await f.service.undo(principal,boardId,receipt.operationId,{expectedRevision:receipt.revision})).replayed).toBe(true);expect(compensate).toHaveBeenCalledTimes(1);
 f.audit.resolveActor=async()=>null;
 await expect(f.service.undo(principal,boardId,receipt.operationId,{expectedRevision:receipt.revision})).rejects.toMatchObject({code:'FORBIDDEN'});expect(compensate).toHaveBeenCalledTimes(1);
});
it.each(['foreign-owner','viewer','commenter','archived','stale','corrupt-file','comment-conflict'] as const)('rejects %s Undo before compensation',async mode=>{
 const f=fixture(),receipt=await f.service.execute(principal,boardId,request),compensate=vi.fn(f.collaboration.compensateInTransaction!);f.collaboration.compensateInTransaction=compensate;
 f.audit.lockHead=async()=>({epoch:1,seq:mode==='stale'?2:1,actorRole:mode==='viewer'?'viewer':mode==='commenter'?'commenter':'editor',archived:mode==='archived'});
 if(mode==='foreign-owner')f.undoRecords.get(receipt.operationId)!.ownerUserId='other';
 if(mode==='corrupt-file')f.undoStore.readBefore=async()=>{throw new Error('integrity')};
 if(mode==='comment-conflict')f.undoStore.checkComments=async()=>{throw new Error('CAS')};
 const events=f.session.events.length;
 await expect(f.service.undo(principal,boardId,receipt.operationId,{expectedRevision:receipt.revision})).rejects.toThrow();expect(compensate).not.toHaveBeenCalled();expect(f.session.events).toHaveLength(events);
});
it('rejects caller supplied inverse commands rather than treating them as server proof',async()=>{
 const f=fixture();await expect(f.service.undo(principal,boardId,'op',{expectedRevision:{epoch:1,seq:0},commands:[{type:'delete',id:'unrelated'}]})).rejects.toThrow();expect(f.session.events).toEqual([]);
});
it.each(['commenter','viewer','archived'] as const)('also denies ordinary receipt replay after %s transition',async mode=>{
 const f=fixture();await f.service.execute(principal,boardId,request);
 f.audit.lockHead=async()=>({epoch:1,seq:1,actorRole:mode==='archived'?'editor':mode,archived:mode==='archived'});
 await expect(f.service.execute(principal,boardId,request)).rejects.toMatchObject({code:mode==='archived'?'ARCHIVED':'FORBIDDEN'});expect(f.session.events).toHaveLength(1);
});
it('does not write commands or publish an operation receipt when before-image materialization fails',async()=>{
 const f=fixture(),write=vi.fn(f.collaboration.writeCommandsInTransaction),append=vi.fn(f.audit.append),record=vi.fn(f.undoStore.record);
 f.collaboration.writeCommandsInTransaction=write;f.audit.append=append;f.undoStore.record=record;
 f.undoStore.capture=async()=>{throw new Error('snapshot write/readback unavailable');};
 await expect(f.service.execute(principal,boardId,request)).rejects.toThrow('snapshot write/readback unavailable');
 expect(write).not.toHaveBeenCalled();expect(append).not.toHaveBeenCalled();expect(record).not.toHaveBeenCalled();expect(f.session.events).toEqual([]);
});
