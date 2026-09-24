import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { BoardBlobCodec, BoardBlobStore, EncodedBoardBlob } from '../../src/application/whiteboard/blob-ports';
import { MigrateBoardContent, RetireBoardContent } from '../../src/application/whiteboard/migrate-board-content';
import { sha256 } from '../../src/domain/whiteboard/blob-identity';
import { createBoardRetirementCredential } from '../../src/domain/whiteboard/retirement-credential';
import { toOrgId } from '../../src/domain/org-id';
import { PgBoardContentMigrationRepository } from '../../src/infrastructure/whiteboard/pg-board-content-migration';

let pg: PGlite;
const tenantId = 'org-online-migration', boardId = randomUUID(), jobId = randomUUID();
const migrations = ['20260924000800_whiteboard_content_heads.sql', '20260924000900_whiteboard_blob_primary.sql', '20260924001000_whiteboard_content_migrations.sql'];

const database = (): DatabasePort => ({
  async withTenant<T>(orgId: ReturnType<typeof toOrgId>, operation: (session: TenantSession) => Promise<T>): Promise<T> {
    await pg.exec('BEGIN');
    try {
      await pg.query(`SELECT set_config('app.current_org',$1,true)`, [orgId]);
      const value = await operation({ query: async <R>(sql: string, params: readonly unknown[] = []) => {
        const result = await pg.query<R>(sql, [...params]); return { rows: result.rows };
      } });
      await pg.exec('COMMIT'); return value;
    } catch (error) { await pg.exec('ROLLBACK'); throw error; }
  },
  async withoutTenant<T>(operation: (session: TenantSession) => Promise<T>) { return operation({ query: async <R>(sql: string, params: readonly unknown[] = []) => ({ rows: (await pg.query<R>(sql, [...params])).rows }) }); },
  async close() {},
});

class Blobs implements BoardBlobStore {
  values = new Map<string, Uint8Array>();
  async putImmutable(input: Parameters<BoardBlobStore['putImmutable']>[0]) { this.values.set(input.key, new Uint8Array(input.ciphertext)); return 'created' as const; }
  async getVerified(input: Parameters<BoardBlobStore['getVerified']>[0]) { const value = this.values.get(input.key); if (!value || sha256(value) !== input.expectedCipherDigest || value.byteLength !== input.expectedSizeBytes) throw new Error('INTEGRITY_FAILED'); return new Uint8Array(value); }
  async head(input: Parameters<BoardBlobStore['head']>[0]) { const value = this.values.get(input.key); return value ? { cipherDigest: sha256(value), sizeBytes: value.byteLength } : null; }
  async deleteIfMatch(input: Parameters<BoardBlobStore['deleteIfMatch']>[0]) {
    const value = this.values.get(input.key);
    if (!value || sha256(value) !== input.expectedCipherDigest || value.byteLength !== input.expectedSizeBytes) return 'not-found' as const;
    this.values.delete(input.key); return 'deleted' as const;
  }
}
const codec: BoardBlobCodec = {
  async encrypt({ plaintext, tenantKeyVersion }): Promise<EncodedBoardBlob> { const ciphertext = new Uint8Array(plaintext), digest = sha256(ciphertext); return { ciphertext, plainDigest: digest, cipherDigest: digest, sizeBytes: ciphertext.byteLength, tenantKeyVersion }; },
  async decrypt(input) { if (sha256(input.ciphertext) !== input.expectedPlainDigest) throw new Error('INTEGRITY_FAILED'); return new Uint8Array(input.ciphertext); },
};

beforeEach(async () => {
  pg = await PGlite.create();
  await pg.exec(`
    CREATE ROLE app_rw;
    CREATE TABLE whiteboards(org_id text NOT NULL,id uuid NOT NULL,PRIMARY KEY(org_id,id));
    CREATE TABLE whiteboard_documents(org_id text NOT NULL,board_id uuid NOT NULL,epoch integer NOT NULL,seq bigint NOT NULL,snapshot bytea NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,board_id),FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id));
    CREATE TABLE whiteboard_updates(org_id text NOT NULL,board_id uuid NOT NULL,epoch integer NOT NULL,seq bigint NOT NULL,actor_id text NOT NULL,update_id uuid NOT NULL,request_hash text NOT NULL,update bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,board_id,epoch,seq),UNIQUE(org_id,board_id,epoch,actor_id,update_id));
  `);
  for (const name of migrations) await pg.exec(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
  const doc = new Y.Doc(); doc.getMap('objects').set('note', { text: '中文' }); const snapshot = Y.encodeStateAsUpdate(doc);
  const updates: Uint8Array[] = []; doc.on('update', value => updates.push(value));
  doc.getMap('objects').delete('note'); doc.getMap('objects').set('drawing', { points: [1, 2] }); doc.getMap('objects').set('note-2', { text: '保留' }); doc.destroy();
  await pg.query(`INSERT INTO whiteboards(org_id,id) VALUES($1,$2)`, [tenantId, boardId]);
  await pg.query(`INSERT INTO whiteboard_documents(org_id,board_id,epoch,seq,snapshot) VALUES($1,$2,2,3,$3)`, [tenantId, boardId, Buffer.from(snapshot)]);
  for (let index = 0; index < updates.length; index++) await pg.query(`INSERT INTO whiteboard_updates(org_id,board_id,epoch,seq,actor_id,update_id,request_hash,update) VALUES($1,$2,2,$3,'actor',$4,$5,$6)`, [tenantId, boardId, index + 1, randomUUID(), String(index + 1).repeat(64), Buffer.from(updates[index]!)]);
  // The head migration ran before the fixture insert, mirroring a board created during rollout.
  await pg.exec(`INSERT INTO whiteboard_content_heads(org_id,board_id,epoch,head_seq,checkpoint_seq) VALUES('${tenantId}','${boardId}',2,3,3)`);
});
afterEach(async () => pg.close());

it('runs the resumable migration against PGlite and retains metadata-only request receipts', async () => {
  const blobs = new Blobs(), repository = new PgBoardContentMigrationRepository(database());
  let now = new Date('2026-01-01T00:00:00Z');
  const service = new MigrateBoardContent(repository, blobs, codec, 3, 1, 1_000, () => now);
  const states: string[] = [];
  for (let i = 0; i < 4; i++) { const result = await service.step({ tenantId, boardId, jobId }); states.push(result.state); if (result.state === 'cutover') break; }
  expect(states).toEqual(['candidate_ready', 'verified', 'cutover']);
  expect((await pg.query(`SELECT storage_kind,content_state FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2`, [tenantId, boardId])).rows).toEqual([{ storage_kind: 'blob_primary', content_state: 'rollback' }]);
  expect((await pg.query(`SELECT snapshot IS NULL snapshot_cleared FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2`, [tenantId, boardId])).rows).toEqual([{ snapshot_cleared: false }]);
  expect((await pg.query<{ cleared: boolean; count: string }>(`SELECT bool_and(update IS NULL) cleared,count(*)::text count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2`, [tenantId, boardId])).rows).toEqual([{ cleared: false, count: '3' }]);

  const candidate = (await repository.loadOrEnroll(tenantId, boardId, jobId)).candidate!;
  const manifest = JSON.parse(Buffer.from(blobs.values.get(candidate.manifestKey)!).toString('utf8')) as { checkpoint: { cipherDigest: string } };
  const key = new Uint8Array(32).fill(9);
  now = new Date('2026-01-01T00:00:02Z');
  const credential = createBoardRetirementCredential({ version: 1, tenantId, boardId, jobId, manifestDigest: candidate.manifestDigest,
    checkpointDigest: manifest.checkpoint.cipherDigest, pgBackupId: 'pg-restored', blobBackupId: 'blob-restored', restoreDrillId: 'drill',
    verifiedAt: '2026-01-01T00:00:01Z', expiresAt: '2026-01-02T00:00:00Z' }, key);
  const retirement = new RetireBoardContent(repository, service, key, 1, () => now);
  const retirementStates: string[] = [];
  for (let i = 0; i < 4; i++) { const result = await retirement.step({ tenantId, boardId, jobId, credential }); retirementStates.push(result.state); if (result.state === 'completed') break; }
  expect(retirementStates).toEqual(['cleaning', 'cleaning', 'completed']);
  expect((await pg.query(`SELECT snapshot IS NULL snapshot_cleared FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2`, [tenantId, boardId])).rows).toEqual([{ snapshot_cleared: true }]);
  expect((await pg.query<{ cleared: boolean; count: string }>(`SELECT bool_and(update IS NULL) cleared,count(*)::text count FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2`, [tenantId, boardId])).rows).toEqual([{ cleared: true, count: '3' }]);
  expect((await pg.query(`SELECT actor_id,update_id,request_hash FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 ORDER BY seq`, [tenantId, boardId])).rows).toHaveLength(3);
  expect((await pg.query(`SELECT state,retirement_proof_digest IS NOT NULL proof,retirement_manifest_digest=$3 manifest_bound FROM whiteboard_content_migrations WHERE org_id=$1 AND board_id=$2`, [tenantId, boardId, candidate.manifestDigest])).rows).toEqual([{ state: 'completed', proof: true, manifest_bound: true }]);
  expect((await pg.query(`SELECT content_state FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2`, [tenantId, boardId])).rows).toEqual([{ content_state: 'active' }]);
});

it('rejects cross-epoch and duplicate legacy sequence rows before publishing a candidate', async () => {
  await expect(pg.query(`INSERT INTO whiteboard_updates(org_id,board_id,epoch,seq,actor_id,update_id,request_hash,update) SELECT org_id,board_id,epoch,seq,'other',$3,request_hash,update FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND seq=1`, [tenantId, boardId, randomUUID()])).rejects.toThrow();
  await pg.query(`INSERT INTO whiteboard_updates(org_id,board_id,epoch,seq,actor_id,update_id,request_hash,update) SELECT org_id,board_id,1,1,'old',$3,request_hash,update FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND epoch=2 AND seq=1`, [tenantId, boardId, randomUUID()]);
  const service = new MigrateBoardContent(new PgBoardContentMigrationRepository(database()), new Blobs(), codec, 3);
  await expect(service.step({ tenantId, boardId, jobId })).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
  expect((await pg.query(`SELECT storage_kind FROM whiteboard_content_heads WHERE org_id=$1 AND board_id=$2`, [tenantId, boardId])).rows).toEqual([{ storage_kind: 'legacy_pg' }]);
});
