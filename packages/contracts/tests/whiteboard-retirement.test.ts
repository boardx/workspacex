import { describe, expect, it } from 'vitest';
import { whiteboardRetirement as C } from '../src';

const digest = (character: string) => character.repeat(64);
const body = {
  version: 1 as const,
  tenantId: 'tenant-a',
  boardId: '0199aabb-ccdd-7eef-8abc-0123456789ab',
  jobId: '0299aabb-ccdd-7eef-8abc-0123456789ab',
  manifestDigest: digest('a'),
  checkpointDigest: digest('b'),
  pgBackupId: 'pg-backup-1',
  blobBackupId: 'blob-backup-1',
  restoreDrillId: 'restore-drill-1',
  verifiedAt: '2026-09-24T08:00:00.000Z',
  expiresAt: '2026-10-01T08:00:00.000Z',
};

describe('Board retirement credential contract', () => {
  it('accepts the signed, object-bound backup restore receipt', () => {
    expect(C.BoardRetirementCredentialBodySchema.parse(body)).toEqual(body);
    expect(C.BoardRetirementCredentialSchema.parse({ ...body, signature: digest('c') }))
      .toEqual({ ...body, signature: digest('c') });
  });

  it('rejects unknown fields, malformed digests, and unbound identifiers', () => {
    expect(C.BoardRetirementCredentialBodySchema.safeParse({ ...body, unexpected: true }).success).toBe(false);
    expect(C.BoardRetirementCredentialSchema.safeParse({ ...body, signature: 'short' }).success).toBe(false);
    expect(C.BoardRetirementCredentialBodySchema.safeParse({ ...body, boardId: 'not-a-uuid' }).success).toBe(false);
    expect(C.BoardRetirementCredentialBodySchema.safeParse({ ...body, tenantId: '' }).success).toBe(false);
  });
});
