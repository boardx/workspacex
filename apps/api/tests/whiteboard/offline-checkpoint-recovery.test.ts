import { describe,expect,it } from 'vitest';
import * as Y from 'yjs';
import { checkpointHash,createWhiteboardDocument,executeCommands,readObjects } from '@repo/whiteboard-core';
import type { WhiteboardCheckpointManifest } from '@repo/contracts/whiteboard-collaboration';
import { WhiteboardRecoveryService,type WhiteboardRecoveryMetadata } from '../../src/application/whiteboard/recovery-service';
import { toOrgId } from '../../src/domain/org-id';

const principal={orgId:toOrgId('offline-recovery-org'),userId:'owner'},boardId='20000000-0000-4000-8000-000000000001';

describe('offline checkpoint recovery',()=>{
  it('falls back from corrupt bytes, replays the contiguous segment, and commits the audit with restore',async()=>{
    const base=createWhiteboardDocument(),target=createWhiteboardDocument(),vector=Y.encodeStateVector(base);
    executeCommands(target,[{type:'create',object:{id:'restored-note',schemaVersion:1,kind:'sticky',geometry:{x:1,y:2,width:10,height:10,rotation:0},text:'recovered',style:{},parentId:null,orderKey:''}}],{});
    const baseBytes=Y.encodeStateAsUpdate(base),delta=Y.encodeStateAsUpdate(target,vector),targetBytes=Y.encodeStateAsUpdate(target);
    const candidate:WhiteboardCheckpointManifest={checkpointId:'10000000-0000-4000-8000-000000000001',boardId,version:1,epoch:2,seq:6,objectKey:'candidate',contentHash:await checkpointHash(baseBytes),byteSize:baseBytes.byteLength,createdBy:'owner',createdAt:'2026-09-27T00:00:00.000Z'};
    const requested:WhiteboardCheckpointManifest={checkpointId:'10000000-0000-4000-8000-000000000002',boardId,version:1,epoch:2,seq:7,objectKey:'requested',contentHash:await checkpointHash(targetBytes),byteSize:targetBytes.byteLength,createdBy:'owner',createdAt:'2026-09-27T00:01:00.000Z'};
    let committed:Parameters<WhiteboardRecoveryMetadata['commitRestore']>[1]|undefined;
    const metadata:WhiteboardRecoveryMetadata={head:async()=>({epoch:2,seq:7,role:'owner',archived:false}),saveCheckpoint:async()=>{throw new Error('unused')},getCheckpoint:async()=>requested,findCheckpointRequest:async()=>null,findRestore:async()=>null,recoveryCandidates:async()=>[candidate],updatesBetween:async()=>[{seq:7,update:delta}],commitRestore:async(_p,input)=>{committed=input;return{epoch:3,seq:0,replayed:false,auditEvents:input.auditEvents}}};
    const blobs=new Map([['candidate',baseBytes],['requested',new Uint8Array([9,9,9])]]),service=new WhiteboardRecoveryService(metadata,{snapshot:async()=>targetBytes},{putOnce:async()=>{},get:async(key:string)=>blobs.get(key)??null},()=>new Date('2026-09-27T00:02:00.000Z'));
    await expect(service.restore(principal,boardId,requested.checkpointId,'10000000-0000-4000-8000-000000000003',{epoch:2,seq:7})).resolves.toMatchObject({epoch:3,auditEvents:[{type:'CheckpointFallbackUsed'}]});
    expect(committed?.auditEvents).toEqual([expect.objectContaining({type:'CheckpointFallbackUsed',requestedCheckpointId:requested.checkpointId,fallbackCheckpointId:candidate.checkpointId,replayedThroughSeq:7})]);
    const restored=createWhiteboardDocument();Y.applyUpdate(restored,committed!.snapshot);expect(readObjects(restored)[0]).toMatchObject({id:'restored-note',text:'recovered'});
    base.destroy();target.destroy();restored.destroy();
  });
});
