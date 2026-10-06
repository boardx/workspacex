import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import type {WhiteboardFileMetadata} from '@repo/contracts/whiteboard-file';
import {AUTH_POLICY} from '@repo/contracts/auth';

type Session = {query<T>(sql: string, values?: unknown[]): Promise<{rows: T[]; rowCount: number | null}>};
async function fileDatabase() {
  if (!process.env.WORKSPACEX_ISOLATION_ID || !process.env.WORKSPACEX_DB || process.env.WORKSPACEX_DB === 'workspacex') throw new Error('FILES_REQUIRE_ISOLATED_DB');
  return await tsImport(pathToFileURL(resolve(__dirname, '../../../api/tests/support/db.ts')).href, {
    parentURL: pathToFileURL(__filename).href, tsconfig: resolve(__dirname, '../../../api/tsconfig.json'),
  }) as {asApp<T>(org: string | null, action: (db: Session) => Promise<T>): Promise<T>; asOwner<T>(action: (db: Session) => Promise<T>): Promise<T>};
}
async function appRoleProof(db: Session, expectedTenant: string | null) {
  const identity = (await db.query<{name: string; role: string; tenant: string | null; superuser: boolean; bypass: boolean; table_owner: string; rls: boolean; forced: boolean}>(
    "SELECT current_database() AS name,current_user AS role,current_setting('app.current_org',true) AS tenant,rolsuper AS superuser,rolbypassrls AS bypass,pg_get_userbyid(c.relowner) AS table_owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced FROM pg_roles p JOIN pg_class c ON c.relname='whiteboard_file_assets' AND c.relnamespace='public'::regnamespace WHERE p.rolname=current_user",
  )).rows[0];
  if (!identity || identity.name !== process.env.WORKSPACEX_DB || identity.role !== 'app_rw' || identity.superuser || identity.bypass || identity.table_owner === identity.role || !identity.rls || !identity.forced) throw new Error('FILES_REQUIRE_REAL_APP_RLS_ROLE');
  if ((identity.tenant || null) !== expectedTenant) throw new Error('FILES_REQUIRE_EXACT_TENANT_CONTEXT');
  return identity;
}

export async function fileAssetRows(tenant: string | null, boardId: string) {
  const fixture = await fileDatabase();
  return fixture.asApp(tenant, async db => {
    await appRoleProof(db, tenant);
    return (await db.query<{asset_id: string; metadata: WhiteboardFileMetadata; state: string}>(
      'SELECT a.asset_id,a.metadata,r.state FROM whiteboard_file_assets a JOIN whiteboard_asset_refs r ON r.org_id=a.org_id AND r.board_id=a.board_id AND r.object_key=a.object_key WHERE a.board_id=$1 ORDER BY a.asset_id', [boardId],
    )).rows;
  });
}

/** Query the connected database, not a producer's claimed version or SET ROLE identity. */
export async function fileNativeDatabaseProof(tenant: string) {
  const fixture = await fileDatabase();
  return fixture.asApp(tenant, async db => {
    const role = await appRoleProof(db, tenant);
    const native = (await db.query<{server_version_num: string; authenticated_role: string; vector_version: string; owner_membership: boolean}>(
      "SELECT current_setting('server_version_num') AS server_version_num,session_user AS authenticated_role,(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector_version,pg_has_role(current_user,'postgres','MEMBER') AS owner_membership",
    )).rows[0];
    if (!native || native.server_version_num !== '160015' || native.vector_version !== '0.8.6' || native.authenticated_role !== 'app_rw' || native.owner_membership) throw new Error('FILES_REQUIRE_NATIVE_AUTHENTICATED_NONOWNER_POSTGRES');
    return {role, native};
  });
}

/** Every attempted write is rolled back, even if a broken policy unexpectedly permits it. */
export async function fileWriteCounterproof(tenant: string | null, ownerOrg: string, boardId: string, assetId: string) {
  const fixture = await fileDatabase();
  const source = await fixture.asApp(ownerOrg, async db => {
    await appRoleProof(db, ownerOrg);
    const record = (await db.query<{object_key: string; metadata: WhiteboardFileMetadata}>('SELECT object_key,metadata FROM whiteboard_file_assets WHERE board_id=$1 AND asset_id=$2', [boardId, assetId])).rows[0];
    if (!record) throw new Error('FILES_RLS_POSITIVE_SOURCE_REQUIRED');
    return record;
  });
  return fixture.asApp(tenant, async db => {
    const role = await appRoleProof(db, tenant);
    const attempts = [];
    for (const [action, sql] of [
      ['insert', 'INSERT INTO whiteboard_file_assets(org_id,board_id,asset_id,object_key,metadata) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING asset_id'],
      ['update', 'UPDATE whiteboard_file_assets SET metadata=metadata WHERE org_id=$1 AND board_id=$2 AND asset_id=$3 RETURNING asset_id'],
      ['delete', 'DELETE FROM whiteboard_file_assets WHERE org_id=$1 AND board_id=$2 AND asset_id=$3 RETURNING asset_id'],
    ] as const) {
      await db.query('SAVEPOINT file_write_probe');
      let rows: number | null = null, sqlState: string | null = null;
      try {
        const probeId = `board-file-${'0'.repeat(64)}`;
        const result = await db.query(sql, action === 'insert' ? [ownerOrg, boardId, probeId, source.object_key, JSON.stringify({...source.metadata, assetId: probeId})] : [ownerOrg, boardId, assetId]);
        rows = result.rowCount;
      } catch (error) { sqlState = (error as {code?: string}).code ?? 'UNKNOWN'; }
      finally { await db.query('ROLLBACK TO SAVEPOINT file_write_probe'); await db.query('RELEASE SAVEPOINT file_write_probe'); }
      attempts.push({action, rows, sqlState});
    }
    return {role, attempts};
  });
}

/** Lifecycle setup is restricted to the disposable foreign tenant created by this lane. */
export async function setFileFixtureOrgFrozen(orgId: string, frozen: boolean) {
  if (!/^board-security-org-[a-f0-9-]{36}$/.test(orgId)) throw new Error('FILES_FREEZE_REQUIRES_OWN_DISPOSABLE_ORG');
  const fixture = await fileDatabase();
  const disabledAt = frozen ? new Date() : null;
  const retentionUntil = disabledAt ? new Date(disabledAt.getTime() + AUTH_POLICY.orgRetentionDays * 86_400_000) : null;
  await fixture.asOwner(async db => {
    const database = (await db.query<{name: string}>('SELECT current_database() AS name')).rows[0];
    if (database?.name !== process.env.WORKSPACEX_DB) throw new Error('FILES_FREEZE_REQUIRES_CORRECT_ISOLATED_DB');
    const result = await db.query('UPDATE organizations SET status=$2,disabled_at=$3,retention_until=$4 WHERE id=$1 RETURNING id', [orgId, frozen ? 'disabled' : 'active', disabledAt, retentionUntil]);
    if (result.rowCount !== 1) throw new Error('FILES_FREEZE_FIXTURE_MISSING');
  });
}
