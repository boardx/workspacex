import { describe, expect, it } from 'vitest';
import { WhiteboardRecoveryService, type WhiteboardRecoveryMetadata } from '../../src/application/whiteboard/recovery-service';
import type { WhiteboardCheckpointManifest } from '@repo/contracts/whiteboard-collaboration';
import { checkpointHash } from '@repo/whiteboard-core';
import { ObjectExistsError } from '../../src/application/artifact/ports';
import { toOrgId } from '../../src/domain/org-id';
import * as Y from 'yjs';
import { createWhiteboardDocument,executeCommands,readObjects } from '@repo/whiteboard-core';

const principal={orgId:toOrgId('recovery-unit-org'),userId:'owner'}, boardId='20000000-0000-4000-8000-000000000001';
const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004'];
function fixture() {
  let saved:WhiteboardCheckpointManifest|undefined, restoreInput:Parameters<WhiteboardRecoveryMetadata['commitRestore']>[1]|undefined,restored:{epoch:number;seq:0;event:Parameters<WhiteboardRecoveryMetadata['commitRestore']>[1]['event']}|null=null,head={epoch:2,seq:7};
  const bytes=new TextEncoder().encode('snapshot'); const blobs=new Map<string,Uint8Array>();
  const metadata:WhiteboardRecoveryMetadata={
    head:async()=>({...head,role:'owner',archived:false}),
    saveCheckpoint:async(_p,manifest)=>{const replayed=Boolean(saved);saved??=manifest;return{manifest:saved,replayed}}, getCheckpoint:async()=>saved??null,
    findCheckpointRequest:async()=>saved??null,
    findRestore:async()=>restored,
    recoveryCandidates:async()=>[],updatesBetween:async()=>[],
    commitRestore:async(_p,input)=>{restoreInput=input;restored={epoch:input.newEpoch,seq:0,event:input.event};head={epoch:input.newEpoch,seq:0};return{epoch:input.newEpoch,seq:0,replayed:false}},
  };
  const objects={putOnce:async(key:string,value:Uint8Array)=>{if(blobs.has(key))throw new ObjectExistsError(key);blobs.set(key,value)},get:async(key:string)=>blobs.get(key)??null};
  const snapshots={snapshot:async()=>bytes};
  const service=new WhiteboardRecoveryService(metadata,snapshots,objects,()=>new Date('2026-09-26T00:00:00.000Z'));
  return {service,metadata,objects,blobs,bytes,get saved(){return saved},get restoreInput(){return restoreInput}};
}

describe('whiteboard checkpoint recovery orchestration',()=>{
  it('keeps commenters read-only for checkpoint creation',async()=>{
    const f=fixture();
    f.metadata.head=async()=>({epoch:2,seq:7,role:'commenter',archived:false});
    await expect(f.service.createCheckpoint(principal,boardId,ids[3]!)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it('writes immutable bytes before metadata and restores by CAS into a new append-only epoch',async()=>{
    const f=fixture(), created=await f.service.createCheckpoint(principal,boardId,ids[3]!);
    expect(created.manifest).toMatchObject({checkpointId:ids[3],epoch:2,seq:7,byteSize:8,contentHash:await checkpointHash(f.bytes)});
    expect(f.blobs.get(created.manifest.objectKey)).toEqual(f.bytes);
    const restored=await f.service.restore(principal,boardId,created.manifest.checkpointId,ids[2]!,{epoch:2,seq:7});
    expect(restored).toMatchObject({epoch:3,seq:0,event:{type:'BoardRestored',previousEpoch:2,epoch:3}});
    expect(f.restoreInput).toMatchObject({expectedEpoch:2,expectedSeq:7,newEpoch:3,checkpoint:{objectKey:created.manifest.objectKey}});
    expect(f.restoreInput?.snapshot).toEqual(f.bytes); expect(f.restoreInput).not.toHaveProperty('bytes');
    const restoreReplay=await f.service.restore(principal,boardId,created.manifest.checkpointId,ids[2]!,{epoch:2,seq:7});
    expect(restoreReplay).toMatchObject({epoch:3,seq:0,replayed:true,event:{type:'BoardRestored'}});
    const replay=await f.service.createCheckpoint(principal,boardId,ids[3]!);
    expect(replay).toMatchObject({replayed:true,manifest:{checkpointId:created.manifest.checkpointId,contentHash:created.manifest.contentHash}});
  });
  it('rejects tampered object bytes before committing metadata',async()=>{
    const f=fixture(), created=await f.service.createCheckpoint(principal,boardId,ids[3]!);
    f.blobs.set(created.manifest.objectKey,new TextEncoder().encode('tampered'));
    await expect(f.service.restore(principal,boardId,created.manifest.checkpointId,ids[2]!,{epoch:2,seq:7})).rejects.toMatchObject({code:'CHECKPOINT_INVALID'});
    expect(f.restoreInput).toBeUndefined();
  });
  it('falls back to the newest valid checkpoint, replays the update segment, and commits an audit event',async()=>{
    const base=createWhiteboardDocument(),target=createWhiteboardDocument(),vector=Y.encodeStateVector(base);
    executeCommands(target,[{type:'create',object:{id:'restored-note',schemaVersion:1,kind:'sticky',geometry:{x:1,y:2,width:10,height:10,rotation:0},text:'recovered',style:{},parentId:null,orderKey:''}}],{});
    const baseBytes=Y.encodeStateAsUpdate(base),delta=Y.encodeStateAsUpdate(target,vector),targetBytes=Y.encodeStateAsUpdate(target);
    const candidate:WhiteboardCheckpointManifest={checkpointId:ids[0]!,boardId,version:1,epoch:2,seq:6,objectKey:'candidate',contentHash:await checkpointHash(baseBytes),byteSize:baseBytes.byteLength,createdBy:'owner',createdAt:'2026-09-26T00:00:00.000Z'};
    const requested:WhiteboardCheckpointManifest={checkpointId:ids[1]!,boardId,version:1,epoch:2,seq:7,objectKey:'requested',contentHash:await checkpointHash(targetBytes),byteSize:targetBytes.byteLength,createdBy:'owner',createdAt:'2026-09-26T00:01:00.000Z'};
    let committed:Parameters<WhiteboardRecoveryMetadata['commitRestore']>[1]|undefined;
    const metadata:WhiteboardRecoveryMetadata={head:async()=>({epoch:2,seq:7,role:'owner',archived:false}),saveCheckpoint:async()=>{throw new Error('unused')},getCheckpoint:async()=>requested,findCheckpointRequest:async()=>null,findRestore:async()=>null,recoveryCandidates:async()=>[candidate],updatesBetween:async()=>[{seq:7,update:delta}],commitRestore:async(_p,input)=>{committed=input;return{epoch:3,seq:0,replayed:false}}};
    const blobs=new Map([['candidate',baseBytes],['requested',new Uint8Array([9,9,9])]]),objects={putOnce:async()=>{},get:async(key:string)=>blobs.get(key)??null};
    const service=new WhiteboardRecoveryService(metadata,{snapshot:async()=>targetBytes},objects,()=>new Date('2026-09-26T00:02:00.000Z'));
    await expect(service.restore(principal,boardId,requested.checkpointId,ids[2]!,{epoch:2,seq:7})).resolves.toMatchObject({epoch:3});
    expect(committed?.auditEvents).toEqual([expect.objectContaining({type:'CheckpointFallbackUsed',requestedCheckpointId:requested.checkpointId,fallbackCheckpointId:candidate.checkpointId,replayedThroughSeq:7})]);
    const restored=createWhiteboardDocument();Y.applyUpdate(restored,committed!.snapshot);expect(readObjects(restored)[0]).toMatchObject({id:'restored-note',text:'recovered'});
    base.destroy();target.destroy();restored.destroy();
  });
});
