import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let db: PGlite;
const board = '0199aabb-ccdd-7eef-8abc-0123456789ab';
const migration = new URL('../../migrations/20260924000800_whiteboard_content_heads.sql', import.meta.url);

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE app_rw;
    CREATE TABLE whiteboard_documents (
      org_id text NOT NULL,
      board_id uuid NOT NULL,
      epoch integer NOT NULL DEFAULT 1,
      seq bigint NOT NULL DEFAULT 0,
      snapshot bytea NOT NULL,
      PRIMARY KEY(org_id,board_id)
    );
    INSERT INTO whiteboard_documents(org_id,board_id,epoch,seq,snapshot) VALUES
      ('org-a','${board}',3,7,decode('00010200ff','hex')),
      ('org-b','${board}',4,8,decode('aabbcc','hex'));
  `);
  await db.exec(await readFile(migration, 'utf8'));
});
afterEach(async () => { await db.close(); });

describe('whiteboard content heads migration', () => {
  it('preserves legacy bytea exactly and seeds tenant-composite metadata heads', async () => {
    const legacy = await db.query<{ org_id: string; snapshot_hex: string }>(`SELECT org_id,encode(snapshot,'hex') snapshot_hex FROM whiteboard_documents ORDER BY org_id`);
    expect(legacy.rows).toEqual([{ org_id: 'org-a', snapshot_hex: '00010200ff' }, { org_id: 'org-b', snapshot_hex: 'aabbcc' }]);
    const heads = await db.query<{ org_id: string; epoch: number; head_seq: string; storage_kind: string }>(`SELECT org_id,epoch,head_seq::text,storage_kind FROM whiteboard_content_heads ORDER BY org_id`);
    expect(heads.rows).toEqual([
      { org_id: 'org-a', epoch: 3, head_seq: '7', storage_kind: 'legacy_pg' },
      { org_id: 'org-b', epoch: 4, head_seq: '8', storage_kind: 'legacy_pg' },
    ]);
  });

  it('enforces the all-or-none published manifest metadata tuple', async () => {
    await expect(db.exec(`UPDATE whiteboard_content_heads SET storage_kind='blob_primary' WHERE org_id='org-a'`)).rejects.toThrow();
    await db.exec(`UPDATE whiteboard_content_heads SET storage_kind='blob_primary',content_state='active',manifest_key='tenants/a/manifest',manifest_digest='${'a'.repeat(64)}',manifest_size_bytes=123,tenant_key_version=1,schema_version=1,protocol_version=1 WHERE org_id='org-a'`);
    await expect(db.exec(`UPDATE whiteboard_content_heads SET manifest_digest='short' WHERE org_id='org-a'`)).rejects.toThrow();
  });

  it('installs forced tenant RLS and hides the other tenant from app_rw', async () => {
    const catalog = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='whiteboard_content_heads'`);
    expect(catalog.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await db.query<{ policyname: string }>(`SELECT policyname FROM pg_policies WHERE tablename='whiteboard_content_heads'`);
    expect(policies.rows).toEqual([{ policyname: 'whiteboard_content_heads_tenant' }]);
    await db.exec(`SET ROLE app_rw; SET app.current_org='org-a';`);
    const rows = await db.query<{ org_id: string }>(`SELECT org_id FROM whiteboard_content_heads`);
    expect(rows.rows).toEqual([{ org_id: 'org-a' }]);
  });

  it('is replayable without modifying legacy content', async () => {
    await db.exec(await readFile(migration, 'utf8'));
    const rows = await db.query<{ count: string; digest: string }>(`SELECT count(*)::text count,string_agg(encode(snapshot,'hex'),',' ORDER BY org_id) digest FROM whiteboard_documents`);
    expect(rows.rows).toEqual([{ count: '2', digest: '00010200ff,aabbcc' }]);
  });
});
