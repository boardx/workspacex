import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { BoardContentRolloutItemOutcome, BoardContentRolloutLimits } from '../../src/application/whiteboard/content-rollout-ports';
import { PgBoardContentRolloutRepository } from '../../src/infrastructure/whiteboard/pg-board-content-rollout';
import { toOrgId } from '../../src/domain/org-id';

let db: PGlite;
const board = '0199aabb-ccdd-7eef-8abc-0123456789ab';
const board2 = '0199aabb-ccdd-7eef-8abc-0123456789ac';
const rolloutId = '0199aabb-ccdd-7eef-8abc-012345678900';
const rateRolloutId = '0199aabb-ccdd-7eef-8abc-012345678910';
const pauseRolloutId = '0199aabb-ccdd-7eef-8abc-012345678920';
const migration = new URL('../../migrations/20260924001000_whiteboard_content_migrations.sql', import.meta.url);
const rolloutMigration = new URL('../../migrations/20260924001200_whiteboard_content_rollouts.sql', import.meta.url);

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE app_rw;
    CREATE TABLE whiteboards(org_id text NOT NULL,id uuid NOT NULL,PRIMARY KEY(org_id,id));
    CREATE TABLE whiteboard_content_heads(org_id text NOT NULL,board_id uuid NOT NULL,content_state text NOT NULL DEFAULT 'legacy',storage_kind text NOT NULL DEFAULT 'legacy_pg',CONSTRAINT whiteboard_content_heads_content_state_check CHECK(content_state IN ('legacy','active')),PRIMARY KEY(org_id,board_id));
    CREATE TABLE whiteboard_updates(update bytea);
    GRANT SELECT ON whiteboards,whiteboard_content_heads TO app_rw;
    INSERT INTO whiteboards(org_id,id) VALUES('org-a','${board}'),('org-a','${board2}'),('org-b','${board}'),('org-b','${board2}');
    INSERT INTO whiteboard_content_heads(org_id,board_id) VALUES('org-a','${board}'),('org-a','${board2}'),('org-b','${board}'),('org-b','${board2}');
  `);
  await db.exec(await readFile(migration, 'utf8'));
  await db.exec(await readFile(rolloutMigration, 'utf8'));
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

  it('keeps global admission tables private and exposes only tenant-bound hardened primitives', async () => {
    const tables = ['whiteboard_content_rollout_limiters', 'whiteboard_content_rollout_global_leases', 'whiteboard_content_rollout_contenders'];
    for (const table of tables) {
      expect((await db.query<{ allowed: boolean }>(`SELECT has_table_privilege('app_rw',$1,'SELECT') allowed`, [table])).rows[0]?.allowed).toBe(false);
    }
    const contenderPolicy = await db.query<{ qual: string; with_check: string }>(`
      SELECT qual,with_check FROM pg_policies WHERE schemaname='public'
      AND tablename='whiteboard_content_rollout_contenders'`);
    expect(contenderPolicy.rows).toHaveLength(1);
    expect(contenderPolicy.rows[0]?.qual).toContain('org_id');
    expect(contenderPolicy.rows[0]?.qual).toContain('app.current_org');
    expect(contenderPolicy.rows[0]?.with_check).toContain('app.current_org');
    const owner = await db.query<{ rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolinherit: boolean; rolbypassrls: boolean; app_member: boolean; app_can_set: boolean }>(`
      SELECT r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolbypassrls,
      pg_has_role('app_rw',r.oid,'MEMBER') app_member,pg_has_role('app_rw',r.oid,'SET') app_can_set
      FROM pg_roles r WHERE r.rolname='board_rollout_admission_owner'`);
    expect(owner.rows).toEqual([{ rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolbypassrls: false, app_member: false, app_can_set: false }]);
    const functions = await db.query<{ proname: string; owner: string; prosecdef: boolean; proconfig: string[]; app_execute: boolean; proacl: string }>(`
      SELECT p.proname,r.rolname owner,p.prosecdef,p.proconfig,has_function_privilege('app_rw',p.oid,'EXECUTE') app_execute,coalesce(p.proacl::text,'') proacl
      FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
      WHERE p.proname IN ('claim_whiteboard_content_rollout_admission','release_whiteboard_content_rollout_admission','invalidate_whiteboard_content_rollout_leases') ORDER BY p.proname`);
    expect(functions.rows).toHaveLength(3);
    for (const fn of functions.rows) {
      expect(fn).toMatchObject({ owner: 'board_rollout_admission_owner', prosecdef: true, app_execute: true });
      expect(fn.proconfig.join(',')).toContain('search_path=pg_catalog, public');
      expect(fn.proacl).not.toMatch(/(?:^|[,{])=X\//);
    }
    await db.exec(`SET ROLE app_rw; SET app.current_org='org-a'`);
    for (const table of tables) await expect(db.query(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/i);
    await expect(db.query(`SELECT * FROM claim_whiteboard_content_rollout_admission($1,$2,$3,$4,$5)`,
      ['org-b', rolloutId, 'worker-a', '0199aabb-ccdd-7eef-8abc-012345678999', new Date(Date.now() + 1_000).toISOString()])).rejects.toThrow(/ROLLOUT_ADMISSION_INVALID|ROLLOUT_SCOPE_INVALID/);
    await expect(db.query(`SELECT * FROM claim_whiteboard_content_rollout_admission($1,$2,$3,$4,$5)`,
      ['org-a', rolloutId, `worker'; DROP TABLE whiteboards; --`, '0199aabb-ccdd-7eef-8abc-012345678999', new Date(Date.now() + 1_000).toISOString()])).rejects.toThrow(/ROLLOUT_ADMISSION_INVALID/);
    await db.exec(`RESET ROLE`);
    expect((await db.query<{ exists: boolean }>(`SELECT to_regclass('public.whiteboards') IS NOT NULL exists`)).rows[0]?.exists).toBe(true);
  });

  it('atomically fences reclaimed leases and shares global admission across tenant runners', async () => {
    const database: DatabasePort = {
      async withTenant<T>(orgId: ReturnType<typeof toOrgId>, operation: (session: TenantSession) => Promise<T>) {
        await db.exec('BEGIN');
        try {
          await db.exec('SET LOCAL ROLE app_rw');
          await db.query(`SELECT set_config('app.current_org',$1,true)`, [orgId]);
          const value = await operation({ query: async <R>(sql: string, params: readonly unknown[] = []) => ({ rows: (await db.query<R>(sql, [...params])).rows }) });
          await db.exec('COMMIT'); return value;
        } catch (error) { await db.exec('ROLLBACK'); throw error; }
      },
      async withoutTenant<T>(operation: (session: TenantSession) => Promise<T>) { return operation({ query: async <R>(sql: string, params: readonly unknown[] = []) => ({ rows: (await db.query<R>(sql, [...params])).rows }) }); },
      async close() {},
    };
    const repository = new PgBoardContentRolloutRepository(database);
    const limits: BoardContentRolloutLimits = { pageSize: 2, maxPagesPerRun: 2, maxBoardsPerRun: 4, globalConcurrency: 1,
      tenantConcurrency: 1, ratePerSecond: 10_000, phaseBudget: 3, retryBudget: 1, baseBackoffMs: 10, maxBackoffMs: 100, leaseMs: 10_000 };
    for (const tenant of ['org-a', 'org-b']) { await repository.loadOrCreate(tenant, rolloutId, limits); await repository.preparePage(tenant, rolloutId); }
    const [first] = await repository.claim('org-a', rolloutId, 'process-a', 1, new Date(Date.now() + 10_000));
    expect(first).toBeDefined();
    expect(await repository.claim('org-b', rolloutId, 'process-b', 1, new Date(Date.now() + 10_000))).toEqual([]);
    const outcome = (state: 'succeeded' | 'retry' = 'succeeded'): BoardContentRolloutItemOutcome => ({ state, errorCode: null, retryAt: null,
      report: null, operation: { bytesRead: 2, bytesWritten: 3, casResets: 0, orphanCandidates: 0 }, phaseCalls: 1, latencyMs: 1 });
    await repository.finish(first!, outcome());
    expect(await repository.claim('org-a', rolloutId, 'process-a', 1, new Date(Date.now() + 10_000))).toEqual([]);
    const [second] = await repository.claim('org-b', rolloutId, 'process-b', 1, new Date(Date.now() + 10_000));
    expect(second).toMatchObject({ owner: 'process-b', epoch: 1 });
    await repository.finish(second!, outcome());

    const [expired] = await repository.claim('org-a', rolloutId, 'process-a', 1, new Date(Date.now() + 10_000));
    await db.query(`UPDATE whiteboard_content_rollout_items SET lease_until=now()-interval '1 second' WHERE org_id='org-a' AND rollout_id=$1 AND lease_token=$2`, [rolloutId, expired!.token]);
    await db.query(`UPDATE whiteboard_content_rollout_global_leases SET lease_until=now()-interval '1 second' WHERE rollout_id=$1 AND lease_token=$2`, [rolloutId, expired!.token]);
    const [betaSecond] = await repository.claim('org-b', rolloutId, 'process-b', 1, new Date(Date.now() + 10_000));
    await repository.finish(betaSecond!, outcome());
    const [reclaimed] = await repository.claim('org-a', rolloutId, 'process-b', 1, new Date(Date.now() + 10_000));
    expect(reclaimed).toMatchObject({ boardId: expired!.boardId, epoch: expired!.epoch + 1 });
    await expect(repository.finish(expired!, outcome())).rejects.toMatchObject({ code: 'ROLLOUT_LEASE_LOST' });
    await repository.release(expired!);
    await repository.finish(reclaimed!, outcome());
    expect((await repository.snapshot('org-a', rolloutId)).metrics).toMatchObject({ migrated: 2, scanned: 2, retried: 1 });
    expect((await db.query<{ code: string }>(`SELECT code FROM whiteboard_content_rollout_events WHERE org_id='org-a' AND rollout_id=$1 AND code='LEASE_EXPIRED'`, [rolloutId])).rows).toEqual([{ code: 'LEASE_EXPIRED' }]);

    await repository.loadOrCreate('org-a', pauseRolloutId, limits); await repository.preparePage('org-a', pauseRolloutId);
    const [paused] = await repository.claim('org-a', pauseRolloutId, 'pause-a', 1, new Date(Date.now() + 10_000));
    await repository.setControl('org-a', pauseRolloutId, 'paused');
    await repository.setControl('org-a', pauseRolloutId, 'running');
    const [resumed] = await repository.claim('org-a', pauseRolloutId, 'pause-b', 1, new Date(Date.now() + 10_000));
    expect(paused).toMatchObject({ attempt: 1 }); expect(resumed).toMatchObject({ boardId: paused!.boardId, attempt: 1, epoch: 2 });
    await repository.finish(resumed!, outcome());
    expect((await repository.snapshot('org-a', pauseRolloutId)).metrics).toMatchObject({ migrated: 1, scanned: 1, retried: 0 });

    const rateLimits = { ...limits, ratePerSecond: 1 };
    for (const tenant of ['org-a', 'org-b']) { await repository.loadOrCreate(tenant, rateRolloutId, rateLimits); await repository.preparePage(tenant, rateRolloutId); }
    const [rateLease] = await repository.claim('org-a', rateRolloutId, 'rate-a', 1, new Date(Date.now() + 10_000));
    await repository.release(rateLease!);
    expect(await repository.claim('org-b', rateRolloutId, 'rate-b', 1, new Date(Date.now() + 10_000))).toEqual([]);
  });

  it('upgrades a database that already recorded the immutable base migration and replays the follow-up', async () => {
    const legacy = await PGlite.create();
    try {
      await legacy.exec(`CREATE ROLE app_rw; CREATE TABLE whiteboards(org_id text NOT NULL,id uuid NOT NULL,PRIMARY KEY(org_id,id)); CREATE TABLE whiteboard_content_heads(org_id text NOT NULL,board_id uuid NOT NULL,content_state text NOT NULL DEFAULT 'legacy',PRIMARY KEY(org_id,board_id)); CREATE TABLE whiteboard_updates(update bytea); CREATE TABLE _kernel_migrations(name text PRIMARY KEY,checksum text NOT NULL);`);
      const immutableBase = await readFile(migration, 'utf8');
      expect(immutableBase).not.toContain('whiteboard_content_rollouts');
      await legacy.exec(immutableBase);
      await legacy.exec(`INSERT INTO _kernel_migrations(name,checksum) VALUES('20260924001000_whiteboard_content_migrations.sql','already-applied')`);
      expect((await legacy.query<{ count: string }>(`SELECT count(*)::text count FROM information_schema.tables WHERE table_name='whiteboard_content_rollouts'`)).rows[0]?.count).toBe('0');
      const followUp = await readFile(rolloutMigration, 'utf8');
      await legacy.exec(followUp); await legacy.exec(followUp);
      expect((await legacy.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'whiteboard_content_rollout%' ORDER BY table_name`)).rows.map(row => row.table_name)).toEqual([
        'whiteboard_content_rollout_contenders', 'whiteboard_content_rollout_events', 'whiteboard_content_rollout_global_leases',
        'whiteboard_content_rollout_items', 'whiteboard_content_rollout_limiters', 'whiteboard_content_rollouts',
      ]);
    } finally { await legacy.close(); }
  });
});
