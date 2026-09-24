import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import { PgBoardBlobReferenceGuard } from '../../src/infrastructure/whiteboard/pg-board-blob-reference-guard';
import { toOrgId } from '../../src/domain/org-id';

it('holds the Board writer lock while returning current, migration, backup and legal-hold manifest roots', async () => {
  const tenantId = toOrgId('gc-reference-tenant'), boardId = '0199aabb-ccdd-7eef-8abc-0123456789ab';
  const queries: string[] = []; let transactionOpen = false, inspectedWhileOpen = false;
  const session: TenantSession = { async query<R>(sql: string) {
    queries.push(sql);
    if (sql.startsWith('SELECT id FROM whiteboards')) return { rows: [{ id: boardId }] as R[] };
    return { rows: [{ manifest_key: 'head-key', manifest_digest: 'a'.repeat(64), manifest_plain_digest: 'b'.repeat(64), manifest_size_bytes: '42', tenant_key_version: 2 },
      { manifest_key: 'candidate-key', manifest_digest: 'c'.repeat(64), manifest_plain_digest: 'd'.repeat(64), manifest_size_bytes: '43', tenant_key_version: 3 },
      { manifest_key: 'backup-key', manifest_digest: 'e'.repeat(64), manifest_plain_digest: 'f'.repeat(64), manifest_size_bytes: '44', tenant_key_version: 4 },
      { manifest_key: 'hold-key', manifest_digest: '1'.repeat(64), manifest_plain_digest: '2'.repeat(64), manifest_size_bytes: '45', tenant_key_version: 5 }] as R[] };
  } };
  const db: DatabasePort = {
    async withTenant(_org, operation) { transactionOpen = true; try { return await operation(session); } finally { transactionOpen = false; } },
    async withoutTenant() { throw new Error('not used'); }, async close() {},
  };
  const roots = await new PgBoardBlobReferenceGuard(db).withLockedManifestRoots({ tenantId, boardId }, async value => {
    inspectedWhileOpen = transactionOpen; return value;
  });
  expect(inspectedWhileOpen).toBe(true);
  expect(queries[0]).toContain('FOR UPDATE');
  expect(queries[1]).toContain('whiteboard_content_heads'); expect(queries[1]).toContain('whiteboard_content_migrations');
  expect(queries[1]).toContain('whiteboard_blob_retention_roots');
  expect(queries[1]).toContain("root_kind='legal_hold'"); expect(queries[1]).toContain('retain_until>now()');
  expect(roots).toEqual([
    { key: 'head-key', cipherDigest: 'a'.repeat(64), plainDigest: 'b'.repeat(64), sizeBytes: 42, tenantKeyVersion: 2 },
    { key: 'candidate-key', cipherDigest: 'c'.repeat(64), plainDigest: 'd'.repeat(64), sizeBytes: 43, tenantKeyVersion: 3 },
    { key: 'backup-key', cipherDigest: 'e'.repeat(64), plainDigest: 'f'.repeat(64), sizeBytes: 44, tenantKeyVersion: 4 },
    { key: 'hold-key', cipherDigest: '1'.repeat(64), plainDigest: '2'.repeat(64), sizeBytes: 45, tenantKeyVersion: 5 },
  ]);
});

it('fails closed before enumeration when the scoped Board no longer exists', async () => {
  const db: DatabasePort = {
    async withTenant(_org, operation) { return operation({ query: async <R>() => ({ rows: [] as R[] }) }); },
    async withoutTenant() { throw new Error('not used'); }, async close() {},
  };
  await expect(new PgBoardBlobReferenceGuard(db).withLockedManifestRoots({ tenantId: toOrgId('gc-reference-tenant'), boardId: '0199aabb-ccdd-7eef-8abc-0123456789ab' }, async () => undefined)).rejects.toThrow('BOARD_NOT_FOUND');
});

it('is mechanically limited to tenant-scoped retention metadata and the writer lock', async () => {
  const source = await readFile(new URL('../../src/infrastructure/whiteboard/pg-board-blob-reference-guard.ts', import.meta.url), 'utf8');
  const tables = [...source.matchAll(/(?:FROM|JOIN)\s+([a-z_]+)/gi)].map(match => match[1]).sort();
  expect([...new Set(tables)]).toEqual(['whiteboard_blob_retention_roots', 'whiteboard_content_heads', 'whiteboard_content_migrations', 'whiteboards']);
  expect(source).toContain('this.db.withTenant'); expect(source).not.toContain('.withoutTenant(');
  expect(source).toMatch(/whiteboards[^`]+FOR UPDATE/s);
  expect(source).not.toMatch(/\b(snapshot|ciphertext|plaintext)\b/);
});
