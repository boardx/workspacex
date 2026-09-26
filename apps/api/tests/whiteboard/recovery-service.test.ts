import { describe, expect, it } from 'vitest';
import { WhiteboardRecoveryService, type WhiteboardRecoveryMetadata } from '../../src/application/whiteboard/recovery-service';
import type { WhiteboardCheckpointManifest } from '@repo/contracts/whiteboard-collaboration';
import { checkpointHash } from '@repo/whiteboard-core';
import { ObjectExistsError } from '../../src/application/artifact/ports';
import { toOrgId } from '../../src/domain/org-id';

const principal={orgId:toOrgId('recovery-unit-org'),userId:'owner'}, boardId='20000000-0000-4000-8000-000000000001';
const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004'];
function fixture() {
  let saved:WhiteboardCheckpointManifest|undefined, restoreInput:Parameters<WhiteboardRecoveryMetadata['commitRestore']>[1]|undefined;
  const bytes=new TextEncoder().encode('snapshot'); const blobs=new Map<string,Uint8Array>();
  const metadata:WhiteboardRecoveryMetadata={
    head:async()=>({epoch:2,seq:7,role:'owner',archived:false}),
    saveCheckpoint:async(_p,manifest)=>{const replayed=Boolean(saved);saved??=manifest;return{manifest:saved,replayed}}, getCheckpoint:async()=>saved??null,
    commitRestore:async(_p,input)=>{restoreInput=input;return{epoch:input.newEpoch,seq:0,replayed:false}},
  };
  const objects={putOnce:async(key:string,value:Uint8Array)=>{if(blobs.has(key))throw new ObjectExistsError(key);blobs.set(key,value)},get:async(key:string)=>blobs.get(key)??null};
  const snapshots={snapshot:async()=>bytes};
  const service=new WhiteboardRecoveryService(metadata,snapshots,objects,()=>new Date('2026-09-26T00:00:00.000Z'));
  return {service,metadata,objects,blobs,bytes,get saved(){return saved},get restoreInput(){return restoreInput}};
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
  it('rejects tampered object bytes before committing metadata',async()=>{
    const f=fixture(), created=await f.service.createCheckpoint(principal,boardId,ids[3]!);
    f.blobs.set(created.manifest.objectKey,new TextEncoder().encode('tampered'));
    await expect(f.service.restore(principal,boardId,created.manifest.checkpointId,ids[2]!,{epoch:2,seq:7})).rejects.toMatchObject({code:'CHECKPOINT_INVALID'});
    expect(f.restoreInput).toBeUndefined();
  });
});
