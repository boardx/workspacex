import { describe, expect, it } from 'vitest';
import { toOrgId } from '../../src/domain/org-id';
import { WhiteboardResourceError } from '../../src/application/whiteboard/ports';
import { WhiteboardCursorCodec } from '../../src/infrastructure/whiteboard/whiteboard-cursor';

const principal = {orgId:toOrgId('cursor-org'),userId:'owner'};
const input = {archived:'active' as const,limit:30,query:'研究',tagIds:['6426c0d9-d05a-42bf-9acd-f72c5aa71f6d']};
const codec = new WhiteboardCursorCodec('test-whiteboard-cursor-secret-at-least-32-bytes');

describe('whiteboard list cursor', () => {
  it('round-trips a keyset while binding actor and normalized filters', () => {
    const encoded = codec.encode(principal,input,{updatedAt:'2026-09-26T00:00:00.000Z',id:'9fe596a7-34bb-4fc5-8782-42fa6c4f3c98'});
    expect(codec.decode(principal,{...input,cursor:encoded})).toEqual({updatedAt:'2026-09-26T00:00:00.000Z',id:'9fe596a7-34bb-4fc5-8782-42fa6c4f3c98'});
    expect(() => codec.decode({...principal,userId:'other'},{...input,cursor:encoded})).toThrowError(expect.objectContaining({code:'CURSOR_FILTER_MISMATCH'}));
    expect(() => codec.decode(principal,{...input,query:'other',cursor:encoded})).toThrowError(WhiteboardResourceError);
  });
  it('rejects tampering without parsing untrusted pagination state', () => {
    const encoded = codec.encode(principal,input,{updatedAt:'2026-09-26T00:00:00.000Z',id:'9fe596a7-34bb-4fc5-8782-42fa6c4f3c98'});
    expect(() => codec.decode(principal,{...input,cursor:`${encoded}x`})).toThrowError(expect.objectContaining({code:'CURSOR_INVALID'}));
  });
});
