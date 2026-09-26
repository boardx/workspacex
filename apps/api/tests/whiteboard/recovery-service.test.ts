import { describe, expect, it } from 'vitest';
import { WhiteboardRecoveryError, WhiteboardRecoveryService, type WhiteboardRecoveryMetadata } from '../../src/application/whiteboard/recovery-service';
import type { WhiteboardCheckpointManifest } from '@repo/contracts/whiteboard-collaboration';
import { checkpointHash } from '@repo/whiteboard-core';
import { ObjectExistsError } from '../../src/application/artifact/ports';
import { toOrgId } from '../../src/domain/org-id';

const principal={orgId:toOrgId('recovery-unit-org'),userId:'owner'}, boardId='20000000-0000-4000-8000-000000000001';
const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004'];
function fixture() {
  let saved:WhiteboardCheckpointManifest|undefined, restoreInput:Parameters<WhiteboardRecoveryMetadata['commitRestore']>[1]|undefined;
  let bytes=new TextEncoder().encode('snapshot'),head={epoch:2,seq:7,role:'owner' as const,archived:false},snapshotCalls=0; const blobs=new Map<string,Uint8Array>();
  const metadata:WhiteboardRecoveryMetadata={
    head:async()=>head,
    saveCheckpoint:async(_p,manifest)=>{const replayed=Boolean(saved);saved??=manifest;return{manifest:saved,replayed}}, getCheckpoint:async()=>saved??null,
    commitRestore:async(_p,input)=>{restoreInput=input;return{epoch:input.newEpoch,seq:0,replayed:false}},
  };
  const objects={putOnce:async(key:string,value:Uint8Array)=>{if(blobs.has(key))throw new ObjectExistsError(key);blobs.set(key,value)},get:async(key:string)=>blobs.get(key)??null};
  const snapshots={snapshot:async()=>{snapshotCalls++;return bytes}};
  const service=new WhiteboardRecoveryService(metadata,snapshots,objects,()=>new Date('2026-09-26T00:00:00.000Z'));
  return {service,metadata,objects,blobs,get bytes(){return bytes},moveHead(){head={...head,seq:head.seq+1};bytes=new TextEncoder().encode('new snapshot')},get snapshotCalls(){return snapshotCalls},get saved(){return saved},get restoreInput(){return restoreInput}};
}

describe('whiteboard checkpoint recovery orchestration',()=>{
  it('writes immutable bytes before metadata and restores by CAS into a new append-only epoch',async()=>{
    const f=fixture(), created=await f.service.createCheckpoint(principal,boardId,ids[3]!);
    expect(created.manifest).toMatchObject({checkpointId:ids[3],epoch:2,seq:7,byteSize:8,contentHash:await checkpointHash(f.bytes)});
    expect(f.blobs.get(created.manifest.objectKey)).toEqual(f.bytes);
    const restored=await f.service.restore(principal,boardId,created.manifest.checkpointId,ids[2]!,{epoch:2,seq:7});
    expect(restored).toMatchObject({epoch:3,seq:0,event:{type:'BoardRestored',previousEpoch:2,epoch:3}});
    expect(f.restoreInput).toMatchObject({expectedEpoch:2,expectedSeq:7,newEpoch:3,checkpoint:{objectKey:created.manifest.objectKey}});
    expect(f.restoreInput).not.toHaveProperty('snapshot'); expect(f.restoreInput).not.toHaveProperty('bytes');
    const replay=await f.service.createCheckpoint(principal,boardId,ids[3]!);
    expect(replay).toMatchObject({replayed:true,manifest:{checkpointId:created.manifest.checkpointId,contentHash:created.manifest.contentHash}});
  });
  it('replays the original manifest before sampling a changed head',async()=>{
    const f=fixture(),first=await f.service.createCheckpoint(principal,boardId,ids[3]!);f.moveHead();
    const replay=await f.service.createCheckpoint(principal,boardId,ids[3]!);
    expect(replay).toMatchObject({replayed:true,manifest:{epoch:first.manifest.epoch,seq:first.manifest.seq,contentHash:first.manifest.contentHash}});
    expect(f.snapshotCalls).toBe(1);
  });
  it('converges concurrent same-id creators that sampled different heads',async()=>{
    let saved:WhiteboardCheckpointManifest|null=null,lookups=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve});const blobs=new Map<string,Uint8Array>();
    const metadata:WhiteboardRecoveryMetadata={head:async()=>({epoch:2,seq:lookups,role:'owner',archived:false}),getCheckpoint:async()=>{lookups++;if(lookups===2)release();if(lookups<=2){await barrier;return null;}return saved;},saveCheckpoint:async(_p,value)=>{if(saved&&saved.contentHash!==value.contentHash)throw new WhiteboardRecoveryError('CHECKPOINT_INVALID');const replayed=Boolean(saved);saved??=value;return{manifest:saved,replayed}},commitRestore:async()=>{throw new Error('unused')}};
    const objects={putOnce:async(key:string,value:Uint8Array)=>{if(blobs.has(key))throw new ObjectExistsError(key);blobs.set(key,value)},get:async(key:string)=>blobs.get(key)??null};
    const service=new WhiteboardRecoveryService(metadata,{snapshot:async(_p,_b,_e,seq)=>new TextEncoder().encode(`snapshot-${seq}`)},objects,()=>new Date('2026-09-26T00:00:00.000Z'));
    const [a,b]=await Promise.all([service.createCheckpoint(principal,boardId,ids[3]!),service.createCheckpoint(principal,boardId,ids[3]!)]);
    expect(a.manifest).toEqual(b.manifest);expect([a.replayed,b.replayed].sort()).toEqual([false,true]);expect(blobs.size).toBe(2);
  });
  it('rejects tampered object bytes before committing metadata',async()=>{
    const f=fixture(), created=await f.service.createCheckpoint(principal,boardId,ids[3]!);
    f.blobs.set(created.manifest.objectKey,new TextEncoder().encode('tampered'));
    await expect(f.service.restore(principal,boardId,created.manifest.checkpointId,ids[2]!,{epoch:2,seq:7})).rejects.toMatchObject({code:'CHECKPOINT_INVALID'});
    expect(f.restoreInput).toBeUndefined();
  });
  it('reads back and verifies every fresh checkpoint write before publishing metadata',async()=>{
    let saves=0;const metadata:WhiteboardRecoveryMetadata={head:async()=>({epoch:1,seq:0,role:'owner',archived:false}),getCheckpoint:async()=>null,saveCheckpoint:async(_p,manifest)=>{saves++;return{manifest,replayed:false}},commitRestore:async()=>{throw new Error('unused')}};
    const service=new WhiteboardRecoveryService(metadata,{snapshot:async()=>new TextEncoder().encode('expected')},{putOnce:async()=>{},get:async()=>new TextEncoder().encode('tampered')},()=>new Date('2026-09-26T00:00:00.000Z'));
    await expect(service.createCheckpoint(principal,boardId,ids[0]!)).rejects.toMatchObject({code:'CHECKPOINT_INVALID'});expect(saves).toBe(0);
  });
});
