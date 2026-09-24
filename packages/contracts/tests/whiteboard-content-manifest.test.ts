import { describe, expect, it } from 'vitest';
import { whiteboardContentManifest as C } from '../src';

const digest = (character: string) => character.repeat(64);
const manifest = {
  manifestVersion: 1 as const,
  boardId: '0199aabb-ccdd-7eef-8abc-0123456789ab',
  epoch: 1,
  headSeq: 2,
  schemaVersion: 1,
  checkpoint: {
    key: `tenants/a/boards/b/checkpoint/sha256/${digest('a')}`,
    plainDigest: digest('b'),
    cipherDigest: digest('a'),
    sizeBytes: 9,
    throughSeq: 2,
  },
  tail: [],
  parentManifestDigest: null,
  tenantKeyVersion: 2,
  createdAt: '2026-09-24T08:00:00.000Z',
};

describe('Board content manifest contract', () => {
  it('accepts the strict versioned logical shape', () => {
    expect(C.BoardContentManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('rejects unknown fields and unsafe blob descriptors', () => {
    expect(C.BoardContentManifestSchema.safeParse({ ...manifest, unexpected: true }).success).toBe(false);
    expect(C.BoardContentManifestSchema.safeParse({
      ...manifest,
      checkpoint: { ...manifest.checkpoint, key: '../escape' },
    }).success).toBe(false);
    expect(C.BoardContentManifestSchema.safeParse({
      ...manifest,
      checkpoint: { ...manifest.checkpoint, cipherDigest: 'short' },
    }).success).toBe(false);
  });
});
