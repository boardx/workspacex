import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let db: PGlite;
const board = '0199aabb-ccdd-7eef-8abc-0123456789ab';
const rolloutId = '0199aabb-ccdd-7eef-8abc-012345678900';
const migration = new URL('../../migrations/20260924001000_whiteboard_content_migrations.sql', import.meta.url);

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE app_rw;
    CREATE TABLE whiteboards(org_id text NOT NULL,id uuid NOT NULL,PRIMARY KEY(org_id,id));
    CREATE TABLE whiteboard_content_heads(org_id text NOT NULL,board_id uuid NOT NULL,content_state text NOT NULL DEFAULT 'legacy',CONSTRAINT whiteboard_content_heads_content_state_check CHECK(content_state IN ('legacy','active')),PRIMARY KEY(org_id,board_id));
    CREATE TABLE whiteboard_updates(update bytea);
    INSERT INTO whiteboards(org_id,id) VALUES('org-a','${board}'),('org-b','${board}');
    INSERT INTO whiteboard_content_heads(org_id,board_id) VALUES('org-a','${board}'),('org-b','${board}');
  `);
  await db.exec(await readFile(migration, 'utf8'));
});
afterEach(async () => db.close());

describe('whiteboard online content migration journal', () => {
  it('is tenant isolated, board scoped and replayable', async () => {
    await db.exec(`INSERT INTO whiteboard_content_migrations(org_id,board_id,job_id,source_epoch,source_head_seq,source_fencing_token) VALUES('org-a','${board}','0199aabb-ccdd-7eef-8abc-012345678901',3,8,11),('org-b','${board}','0199aabb-ccdd-7eef-8abc-012345678902',4,9,12)`);
    await db.exec(await readFile(migration, 'utf8'));
    await db.exec(`SET ROLE app_rw; SET app.current_org='org-a'`);
    expect((await db.query<{ org_id: string }>('SELECT org_id FROM whiteboard_content_migrations')).rows).toEqual([{ org_id: 'org-a' }]);
  });

  it('requires a complete immutable candidate tuple before advancing', async () => {
    await db.exec(`INSERT INTO whiteboard_content_migrations(org_id,board_id,job_id,source_epoch,source_head_seq,source_fencing_token) VALUES('org-a','${board}','0199aabb-ccdd-7eef-8abc-012345678901',3,8,11)`);
    await expect(db.exec(`UPDATE whiteboard_content_migrations SET state='candidate_ready' WHERE org_id='org-a'`)).rejects.toThrow();
    await db.exec(`UPDATE whiteboard_content_migrations SET state='candidate_ready',candidate_manifest_key='tenants/a/boards/${board}/manifest/sha256/${'a'.repeat(64)}',candidate_manifest_digest='${'a'.repeat(64)}',candidate_manifest_plain_digest='${'b'.repeat(64)}',candidate_manifest_size_bytes=100,candidate_tenant_key_version=2,candidate_schema_version=1,candidate_protocol_version=1,candidate_head_seq=8 WHERE org_id='org-a'`);
    await expect(db.exec(`UPDATE whiteboard_content_migrations SET candidate_head_seq=7 WHERE org_id='org-a'`)).rejects.toThrow();
  });

  it('keeps reports metadata-only and forces tenant RLS', async () => {
    const columns = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name='whiteboard_content_migrations' ORDER BY column_name`)).rows.map(row => row.column_name);
    expect(columns).not.toContain('snapshot');
    expect(columns).not.toContain('update');
    expect(columns).not.toContain('content');
    const catalog = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='whiteboard_content_migrations'`);
    expect(catalog.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await db.query<{ allowed: boolean }>(`SELECT has_column_privilege('app_rw','whiteboard_updates','update','UPDATE') allowed`)).rows).toEqual([{ allowed: true }]);
  });

  it('persists tenant rollout controls, stable work items, metrics and append-only audit', async () => {
    const tables = ['whiteboard_content_rollouts', 'whiteboard_content_rollout_items', 'whiteboard_content_rollout_events'];
    for (const table of tables) {
      const catalog = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      expect(catalog.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    }
    await db.exec(`INSERT INTO whiteboard_content_rollouts(org_id,rollout_id,config) VALUES('org-a','${rolloutId}', '{"pageSize":1}'::jsonb),('org-b','${rolloutId}', '{"pageSize":1}'::jsonb)`);
    await db.exec(`SET ROLE app_rw; SET app.current_org='org-a'`);
    expect((await db.query<{ org_id: string }>('SELECT org_id FROM whiteboard_content_rollouts')).rows).toEqual([{ org_id: 'org-a' }]);
    await expect(db.exec(`DELETE FROM whiteboard_content_rollout_events`)).rejects.toThrow();
  });
});
