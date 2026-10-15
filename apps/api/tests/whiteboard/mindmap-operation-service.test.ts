import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, mindmapStateVector } from '@repo/whiteboard-core';
import { fixture, boardId, principal, request } from './operation-service.test';

function mindmapFixture() {
  const f = fixture(), doc = createWhiteboardDocument();
  const object = {...request.commands[0]!.object,id:'root',extensionData:{mindmap:{version:1,role:'node',treeId:'root',collapsed:false}}};
  const commands = [{type:'create',object}];
  const input = {...request,commands,mindmap:{action:'create-root',treeId:'root',expectedStateVector:mindmapStateVector(doc),commands}};
  f.collaboration.loadInTransaction = vi.fn(async()=>({epoch:1,seq:0,role:'editor' as const,archived:false,update:Y.encodeStateAsUpdate(doc)}));
  const write = vi.fn(f.collaboration.writeCommandsInTransaction);
  f.collaboration.writeCommandsInTransaction = write;
  return {...f,doc,input,write};
}
describe('typed mindmap operation service boundary',()=>{
  it('validates the locked snapshot and commits exactly one matching batch',async()=>{
    const f=mindmapFixture();await f.service.execute(principal,boardId,f.input);
    expect(f.write).toHaveBeenCalledTimes(1);expect(f.write.mock.calls[0]?.[3]).toMatchObject({expectedSeq:0,commands:f.input.commands});
    expect(f.doc.getMap('objects').size).toBe(0);f.doc.destroy();
  });
  it('rejects a typed batch that differs from the committed batch without writes',async()=>{
    const f=mindmapFixture();await expect(f.service.execute(principal,boardId,{...f.input,commands:[{type:'create',object:{...f.input.commands[0]!.object,text:'tampered'}}]})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
    expect(f.write).not.toHaveBeenCalled();expect(f.session.events).toHaveLength(0);f.doc.destroy();
  });
  it('rejects a stale state vector even when the submitted head number matches',async()=>{
    const f=mindmapFixture();f.doc.getMap('objects').set('untrusted',new Y.Map());
    await expect(f.service.execute(principal,boardId,f.input)).rejects.toMatchObject({code:'STALE_REVISION'});
    expect(f.write).not.toHaveBeenCalled();f.doc.destroy();
  });
  it('rejects a tree scope mismatch and illegal action before commit',async()=>{
    const f=mindmapFixture();await expect(f.service.execute(principal,boardId,{...f.input,mindmap:{...f.input.mindmap,treeId:'other'}})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
    expect(f.write).not.toHaveBeenCalled();
    await expect(f.service.execute(principal,boardId,{...f.input,mindmap:{...f.input.mindmap,action:'layout'}})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
    f.doc.destroy();
  });
  it('undo uses server compensation without executing or reading a new domain command',async()=>{
    const f=mindmapFixture(),receipt=await f.service.execute(principal,boardId,f.input);
    const load=vi.mocked(f.collaboration.loadInTransaction);load.mockClear();
    const compensate=vi.fn(f.collaboration.compensateInTransaction!);f.collaboration.compensateInTransaction=compensate;
    f.audit.lockHead=async()=>({epoch:1,seq:1,actorRole:'editor'});
    const result=await f.service.undo(principal,boardId,receipt.operationId,{expectedRevision:receipt.revision});
    expect(result.events[0]?.type).toBe('OperationUndone');
    expect(compensate).toHaveBeenCalledTimes(1);expect(load).not.toHaveBeenCalled();expect(f.write).toHaveBeenCalledTimes(1);
    f.doc.destroy();
  });

});
