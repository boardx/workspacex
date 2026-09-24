import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, expect, it } from 'vitest';

let db: PGlite;
const boardId = '0199aabb-ccdd-7eef-8abc-0123456789ab';
const migration = new URL('../../migrations/20260924001100_whiteboard_blob_retention_gc.sql', import.meta.url);

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`CREATE ROLE app_rw; CREATE TABLE whiteboards(org_id text NOT NULL,id uuid NOT NULL,PRIMARY KEY(org_id,id));
    INSERT INTO whiteboards VALUES('org-a','${boardId}'),('org-b','${boardId}');`);
  await db.exec(await readFile(migration, 'utf8'));
});
afterEach(async () => db.close());

it('stores only tenant-scoped backup/legal-hold roots and bounded sweep metrics', async () => {
  const root = (org: string, kind: 'backup' | 'legal_hold', id: string) => `INSERT INTO whiteboard_blob_retention_roots
    (org_id,board_id,root_kind,reference_id,manifest_key,manifest_digest,manifest_plain_digest,manifest_size_bytes,tenant_key_version,retain_until)
    VALUES('${org}','${boardId}','${kind}','${id}','tenants/x/boards/${boardId}/manifest/sha256/${'a'.repeat(64)}','${'a'.repeat(64)}','${'b'.repeat(64)}',42,2,${kind === 'backup' ? "'2030-01-01'" : 'NULL'})`;
  await db.exec(`${root('org-a','backup','backup-a')}; ${root('org-a','legal_hold','hold-a')}; ${root('org-b','backup','backup-b')};`);
  await db.exec(`INSERT INTO whiteboard_blob_gc_runs VALUES('org-a','${boardId}',now(),now(),12,5,1,3,1,'v1:513')`);
  await db.exec(await readFile(migration, 'utf8'));
  const columns = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name='whiteboard_blob_retention_roots'`)).rows.map(row => row.column_name);
  expect(columns).not.toEqual(expect.arrayContaining(['content','snapshot','update','ciphertext','plaintext']));
  await db.exec(`SET ROLE app_rw; SET app.current_org='org-a'`);
  expect((await db.query<{ reference_id: string }>(`SELECT reference_id FROM whiteboard_blob_retention_roots ORDER BY reference_id`)).rows)
    .toEqual([{ reference_id: 'backup-a' }, { reference_id: 'hold-a' }]);
  expect((await db.query<{ deleted: number }>(`SELECT deleted FROM whiteboard_blob_gc_runs`)).rows).toEqual([{ deleted: 1 }]);
});
