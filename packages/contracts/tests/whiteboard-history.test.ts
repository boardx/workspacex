import { describe, expect, it } from 'vitest';
import { whiteboardHistory as H } from '../src';

const digest='a'.repeat(64),boardId='11111111-1111-4111-8111-111111111111',checkpointId='22222222-2222-4222-8222-222222222222';
describe('whiteboard history contract',()=>{
  it('binds named versions to an exact content head and explicit retention/reason',()=>{
    expect(H.CreateCheckpoint.parse({requestId:'33333333-3333-4333-8333-333333333333',label:'Workshop close',reason:'Facilitator approved',retentionDays:365,expectedHead:{epoch:1,seq:7,digest}}).expectedHead.seq).toBe(7);
    expect(()=>H.CreateCheckpoint.parse({requestId:'33333333-3333-4333-8333-333333333333',label:'Workshop close',reason:'',retentionDays:365,expectedHead:{epoch:1,seq:7,digest}})).toThrow();
  });
  it('returns bounded object projections and never transports snapshot bytes',()=>{
    expect(H.CheckpointPreview.keyof().options).toEqual(['checkpoint','objects']);
    expect(H.operations.previewCheckpoint.path).toContain(':checkpointId');
    expect(JSON.stringify(H.operations)).not.toMatch(/snapshotBase64|bytea/);
  });
  it('makes restore create a named board from a digest-bound source',()=>{
    const input=H.RestoreCheckpoint.parse({requestId:'33333333-3333-4333-8333-333333333333',sourceContentDigest:digest,boardName:'Recovered workshop',reason:'Facilitator recovery',retentionDays:365});
    expect(input.sourceContentDigest).toBe(digest);
    expect(H.CompareCheckpoint.parse({fromCheckpointId:checkpointId,to:'current'}).to).toBe('current');
    expect(H.HistoryHead.parse({epoch:1,seq:0,digest})).toEqual({epoch:1,seq:0,digest});
    expect(H.CheckpointId.parse(checkpointId)).toBe(checkpointId);expect(H.Checkpoint.parse({id:checkpointId,boardId,epoch:1,seq:0,headDigest:digest,contentDigest:digest,byteLength:2,objectCount:0,blobVersion:1,createdAt:'2026-09-24T00:00:00.000Z',creatorId:'u1',label:'Restored',reason:'Recovery',retentionUntil:'2027-09-24T00:00:00.000Z',retentionState:'active',sourceBoardId:boardId,sourceCheckpointId:checkpointId}).sourceBoardId).toBe(boardId);
  });
});
