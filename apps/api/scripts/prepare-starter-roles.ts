/** Run only against the dedicated Starter database instance, before application DDL. */
import pg from "pg";
import { appConfig, diagnosticsReaderConfig, migrationConfig } from "../src/infrastructure/db/pg-config";

let client: pg.Client | undefined;
try {
  if (process.env.WORKSPACEX_DEPLOY_PROFILE !== "starter") throw new Error("starter only");
  const runtime = appConfig(), diagnostics = diagnosticsReaderConfig(), owner = migrationConfig();
  if (runtime.user !== "app_rw" || diagnostics.user !== "app_diag_ro" || [runtime.user, diagnostics.user].includes(owner.user)) throw new Error("invalid role separation");
  client = new pg.Client(owner);
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('workspacex.starter.roles',0))");
  for (const identity of [runtime, diagnostics]) {
    const existing = await client.query<{ unsafe: boolean }>("SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole AS unsafe FROM pg_roles WHERE rolname=$1", [identity.user]);
    if (existing.rows.some(role => role.unsafe)) throw new Error("unsafe existing role");
    const name = pg.escapeIdentifier(identity.user);
    if (existing.rows.length === 0) {
      await client.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${pg.escapeLiteral(identity.password)}`);
    } else {
      // Verify the stable secret by a real login. Never rotate or repair an existing role
      // silently: an unexpected password or privilege means this is not the same install.
      const probe = new pg.Client(identity);
      try { await probe.connect(); await probe.query("SELECT 1"); }
      finally { await probe.end(); }
    }
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true, rolesPrepared: true }));
} catch {
  await client?.query("ROLLBACK").catch(() => undefined);
  console.error(JSON.stringify({ ok: false, reason: "starter_role_preparation_failed" }));
  process.exitCode = 1;
} finally { await client?.end(); }
