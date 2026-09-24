import { describe, expect, it } from 'vitest';
import { decodeBoardContentManifest, encodeBoardContentManifest, validateBoardContentManifest } from '../../src/domain/whiteboard/content-manifest';

const digest = (character: string) => character.repeat(64);
const checkpoint = { key: `tenants/a/boards/b/checkpoint/sha256/${digest('a')}`, plainDigest: digest('b'), cipherDigest: digest('a'), sizeBytes: 9, throughSeq: 2 };
const tail = [
  { key: `tenants/a/boards/b/update/sha256/${digest('c')}`, plainDigest: digest('d'), cipherDigest: digest('c'), sizeBytes: 4, fromSeq: 3, throughSeq: 4 },
  { key: `tenants/a/boards/b/update/sha256/${digest('e')}`, plainDigest: digest('f'), cipherDigest: digest('e'), sizeBytes: 5, fromSeq: 5, throughSeq: 5 },
];
const manifest = {
  manifestVersion: 1 as const,
  boardId: '0199aabb-ccdd-7eef-8abc-0123456789ab', epoch: 1, headSeq: 5, schemaVersion: 1,
  checkpoint, tail, parentManifestDigest: null, tenantKeyVersion: 2, createdAt: '2026-09-24T08:00:00.000Z',
};

describe('Board content manifest', () => {
  it('has one canonical byte encoding independent of object property order', () => {
    const reordered = { tail, checkpoint, createdAt: manifest.createdAt, tenantKeyVersion: 2, parentManifestDigest: null, schemaVersion: 1, headSeq: 5, epoch: 1, boardId: manifest.boardId, manifestVersion: 1 };
    expect(encodeBoardContentManifest(reordered)).toEqual(encodeBoardContentManifest(manifest));
    expect(decodeBoardContentManifest(encodeBoardContentManifest(manifest))).toEqual(manifest);
  });

  it('rejects unknown fields and non-canonical sequence ranges', () => {
    expect(() => validateBoardContentManifest({ ...manifest, unexpected: true })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => validateBoardContentManifest({ ...manifest, tail: [{ ...tail[0], fromSeq: 4 }] })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => validateBoardContentManifest({ ...manifest, tail: [tail[0]] })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => validateBoardContentManifest({ ...manifest, checkpoint: { ...checkpoint, throughSeq: 6 } })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});
