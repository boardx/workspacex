import { expect, it } from 'vitest';
import { WHITEBOARD_SYNC, WhiteboardClientMessage, WhiteboardServerMessage } from '../src/whiteboard-sync';

it('separates bounded inbound updates and state vectors from whole-document sync frames', () => {
  const encodedLength = 4 * Math.ceil(WHITEBOARD_SYNC.documentBytes / 3);
  expect(WHITEBOARD_SYNC.documentBase64Characters).toBe(encodedLength);
  const emptyEnvelope = Buffer.byteLength(JSON.stringify({ type: 'sync', epoch: Number.MAX_SAFE_INTEGER, seq: Number.MAX_SAFE_INTEGER, update: '', role: 'owner', archived: false }));
  expect(encodedLength + emptyEnvelope).toBeLessThanOrEqual(WHITEBOARD_SYNC.outboundDocumentFrameBytes);
  expect(WhiteboardServerMessage.safeParse({ type: 'sync', epoch: 1, seq: 0, update: 'A'.repeat(encodedLength), role: 'owner', archived: false }).success).toBe(true);
  const beyondInbound = 'A'.repeat(WHITEBOARD_SYNC.inboundUpdateBase64Characters + 4), updateId = crypto.randomUUID();
  expect(WhiteboardServerMessage.safeParse({ type: 'sync', epoch: 1, seq: 0, update: beyondInbound, role: 'owner', archived: false }).success).toBe(true);
  expect(WhiteboardClientMessage.safeParse({ type: 'update', epoch: 1, updateId, update: 'A'.repeat(WHITEBOARD_SYNC.inboundUpdateBase64Characters) }).success).toBe(true);
  expect(WhiteboardClientMessage.safeParse({ type: 'update', epoch: 1, updateId, update: beyondInbound }).success).toBe(false);
  expect(WhiteboardClientMessage.safeParse({ type: 'hello', stateVector: 'A'.repeat(WHITEBOARD_SYNC.stateVectorBase64Characters + 4) }).success).toBe(false);
  const inboundFrame = JSON.stringify({ type: 'update', epoch: Number.MAX_SAFE_INTEGER, updateId, update: 'A'.repeat(WHITEBOARD_SYNC.inboundUpdateBase64Characters) });
  expect(Buffer.byteLength(inboundFrame)).toBeLessThanOrEqual(WHITEBOARD_SYNC.inboundFrameBytes);
  expect(WHITEBOARD_SYNC.inboundFrameBytes).toBeLessThan(WHITEBOARD_SYNC.outboundDocumentFrameBytes);
});

it('keeps resume, awareness and recovery envelopes closed and bounded', () => {
  const hello={type:'hello',stateVector:'',resume:{epoch:3,seq:9}};
  expect(WhiteboardClientMessage.safeParse(hello).success).toBe(true);
  expect(WhiteboardClientMessage.safeParse({...hello,resume:{epoch:0,seq:9}}).success).toBe(false);
  expect(WhiteboardClientMessage.safeParse({type:'awareness',cursor:{x:1,y:2},selected:['note'],editingObjectId:'note'}).success).toBe(true);
  expect(WhiteboardClientMessage.safeParse({type:'awareness',cursor:null,selected:Array.from({length:201},(_,i)=>`n-${i}`)}).success).toBe(false);
  expect(WhiteboardServerMessage.safeParse({type:'recovery',code:'STALE_EPOCH',disposition:'reload-required',epoch:4,seq:0}).success).toBe(true);
  expect(WhiteboardServerMessage.safeParse({type:'recovery',code:'UNKNOWN',disposition:'reload-required'}).success).toBe(false);
  expect(WhiteboardServerMessage.safeParse({type:'error',code:'PROTOCOL_LIMIT',recoverable:true}).success).toBe(true);
  expect(WhiteboardServerMessage.safeParse({type:'error',code:'PROTOCOL_LIMIT'}).success).toBe(false);
});
