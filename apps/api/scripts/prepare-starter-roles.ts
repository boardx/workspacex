/** Run only against the dedicated Starter database instance, before application DDL. */
import pg from "pg";
import { appConfig, diagnosticsReaderConfig, migrationConfig } from "../src/infrastructure/db/pg-config";

let client: pg.Client | undefined;
try {
  if (process.env.WORKSPACEX_DEPLOY_PROFILE !== "starter") throw new Error("starter only");
  const runtime = appConfig(), diagnostics = diagnosticsReaderConfig(), owner = migrationConfig();
  if (runtime.user !== "app_rw" || diagnostics.user !== "app_diag_ro" || [runtime.user, diagnostics.user].includes(owner.user)) throw new Error("invalid role separation");
  const agentRequested = ["AGENT_DB_USER", "AGENT_DB_PASSWORD", "AGENT_DB_DATABASE"].some(name => process.env[name] !== undefined);
  const agentPassword = process.env.AGENT_DB_PASSWORD;
  if (agentRequested && (process.env.AGENT_DB_USER !== "agent_server" || process.env.AGENT_DB_DATABASE !== "workspacex_agent" ||
    !agentPassword || agentPassword.length < 16 || agentPassword.length > 4096 || /[\r\n\0]/.test(agentPassword) || owner.user === "agent_server")) throw new Error("invalid Agent database separation");
  const memoryRequested = ["MEMORY_DB_USER", "MEMORY_DB_PASSWORD", "MEMORY_DB_OWNER", "MEMORY_DB_OWNER_PASSWORD", "MEMORY_DB_DATABASE"].some(name => process.env[name] !== undefined);
  const memoryPassword = process.env.MEMORY_DB_PASSWORD, memoryOwnerPassword = process.env.MEMORY_DB_OWNER_PASSWORD;
  const strong = (value: string | undefined): value is string => !!value && value.length >= 16 && value.length <= 4096 && !/[\r\n\0]/.test(value);
  if (memoryRequested && (process.env.MEMORY_DB_USER !== "memory_rw" || process.env.MEMORY_DB_OWNER !== "memory_owner" || process.env.MEMORY_DB_DATABASE !== "workspacex_memory" ||
    !strong(memoryPassword) || !strong(memoryOwnerPassword) || memoryPassword === memoryOwnerPassword || ["memory_rw", "memory_owner"].includes(owner.user))) throw new Error("invalid memory database separation");
  const identities = [runtime, diagnostics,
    ...(agentRequested ? [{ ...runtime, user: "agent_server", password: agentPassword! }] : []),
    ...(memoryRequested ? [{ ...runtime, user: "memory_rw", password: memoryPassword! }, { ...runtime, user: "memory_owner", password: memoryOwnerPassword! }] : [])];
  client = new pg.Client(owner);
  await client.connect();
  await client.query("SET lock_timeout = '10s'");
  // Session lock spans the role transaction and CREATE DATABASE, which cannot run in a
  // transaction. Replays cannot race the existence check; disconnect releases the lock.
  await client.query("SELECT pg_advisory_lock(hashtextextended('workspacex.starter.roles',0))");
  await client.query("BEGIN");
  for (const identity of identities) {
    const existing = await client.query<{ unsafe: boolean }>("SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR (rolname IN ('agent_server', 'memory_rw', 'memory_owner') AND EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid OR roleid = pg_roles.oid)) AS unsafe FROM pg_roles WHERE rolname=$1", [identity.user]);
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
  if (agentRequested) {
    const database = await client.query<{ owner: string }>("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname='workspacex_agent'");
    if (!database.rows.length) await client.query('CREATE DATABASE "workspacex_agent" OWNER "agent_server" TEMPLATE template0');
    else if (database.rows[0]?.owner !== "agent_server") throw new Error("unexpected Agent database owner");
    const probe = new pg.Client({ ...runtime, database: "workspacex_agent", user: "agent_server", password: agentPassword! });
    try { await probe.connect(); await probe.query("SELECT 1"); } finally { await probe.end(); }
  }
  if (memoryRequested) {
    const database = await client.query<{ owner: string }>("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname='workspacex_memory'");
    if (!database.rows.length) await client.query('CREATE DATABASE "workspacex_memory" OWNER "memory_owner" TEMPLATE template0');
    else if (database.rows[0]?.owner !== "memory_owner") throw new Error("unexpected memory database owner");
    for (const [user, password] of [["memory_rw", memoryPassword!], ["memory_owner", memoryOwnerPassword!]]) {
      const probe = new pg.Client({ ...runtime, database: "workspacex_memory", user, password });
      try { await probe.connect(); await probe.query("SELECT 1"); } finally { await probe.end(); }
    }
  }
  console.log(JSON.stringify({ ok: true, rolesPrepared: true, agentDatabasePrepared: agentRequested, memoryDatabasePrepared: memoryRequested }));
} catch {
  await client?.query("ROLLBACK").catch(() => undefined);
  console.error(JSON.stringify({ ok: false, reason: "starter_role_preparation_failed" }));
  process.exitCode = 1;
} finally { await client?.end(); }
