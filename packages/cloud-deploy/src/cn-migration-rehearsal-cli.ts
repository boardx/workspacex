/** Synthetic-only local drill. Never accepts a remote DB or a production connection. */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { generateMigrationPlan, migrationHash } from "./cn-migration-plan";
import type { MigrationIdentity } from "./cn-migration-plan";

const [checkout, targetSha, baselineSha, ledgerPath, reportPath] = process.argv.slice(2);
if (!checkout || !targetSha || !baselineSha || !ledgerPath || !reportPath) throw new Error("usage: cn-migration-rehearsal-cli checkout targetSha baselineSha readonly-ledger.json private-report.json");
if (process.env.WORKSPACEX_DEPLOY_PROFILE) throw new Error("synthetic rehearsal refuses cloud profile");
const root = resolve(checkout);
const snapshot = JSON.parse(readFileSync(ledgerPath, "utf8")) as { readOnly: boolean; ledger: MigrationIdentity[] };
if (snapshot.readOnly !== true || !Array.isArray(snapshot.ledger)) throw new Error("read-only ledger required");
const plan = await generateMigrationPlan(root, { targetSha, baselineSha, ledger: snapshot.ledger });
const source = join(root, "apps/api/migrations");
const authority = await import(pathToFileURL(join(root, "apps/api/src/infrastructure/db/migrator.ts")).href) as {
  migrationFiles: (dir: string) => string[];
  migrate: (cfg: Record<string, unknown>, opts: { dir: string }) => Promise<{ applied: string[]; skipped: string[] }>;
};
type Rows = { rows: Array<Record<string, unknown>> };
type Client = { connect: () => Promise<void>; end: () => Promise<void>; query: (sql: string, params?: unknown[]) => Promise<Rows> };
const pg = createRequire(join(root, "apps/api/package.json"))("pg") as { Client: new (cfg: Record<string, unknown>) => Client };
const project = "wsx-cn-migration-rehearsal-4763";
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 120_000 }).trim();
const image = "localhost/workspacex-postgres-age:pg16-age1.6.0";
const imageId = docker("image", "inspect", "--format", "{{.Id}}", image);
const temp = mkdtempSync(join(tmpdir(), "wsx-cn-rehearsal-"));
const composePath = join(temp, "compose.json");
writeFileSync(composePath, JSON.stringify({ services: { postgres: {
  image: imageId, pull_policy: "never", cpus: 2, mem_limit: "1g",
  environment: { POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "synthetic_rehearsal_only", POSTGRES_DB: "postgres" },
  ports: ["127.0.0.1::5432"], tmpfs: ["/var/lib/postgresql/data:rw,size=768m"],
  healthcheck: { test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U postgres -d postgres"], interval: "2s", timeout: "3s", retries: 30 },
} } }), { mode: 0o600 });
const compose = (...args: string[]) => docker("compose", "-f", composePath, "-p", project, ...args);
const report: Record<string, unknown> = { schemaVersion: 1, scope: "synthetic-local-rehearsal", targetSha, baselineSha,
  productionPlanSha256: plan.planSha256, productionReady: false, sourceDriftWaived: false,
  syntheticSource: "target SQL only; no production rows/checksums inserted", imageId,
  rehearsalScriptSha256: migrationHash(readFileSync(new URL(import.meta.url))),
  faultInjections: [] as unknown[], startedAt: new Date().toISOString(), checks: [] as string[], models: [] as unknown[] };
const checks = report.checks as string[];
function check(label: string, actual: unknown, expected: unknown = true) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`assertion_failed:${label}`);
  checks.push(label);
}
const all = authority.migrationFiles(source);
const w1 = "20260929050000_pw_w1_general_project_kind.sql";
const portrait = "20260929150000_dh_portrait_avatars.sql";
const tags = "20260929160000_agent_tags.sql";
const prefix = all.slice(0, all.indexOf(w1));
if (!prefix.length || !all.includes(portrait) || !all.includes(tags)) throw new Error("required target migrations missing");
function directory(names: string[]) {
  const dir = mkdtempSync(join(temp, "sql-"));
  for (const name of names) copyFileSync(join(source, name), join(dir, name));
  return dir;
}
let owned = false;
let cfg: Record<string, unknown>;
async function clientFor(database: string): Promise<Client> {
  const client = new pg.Client({ ...cfg, database }); await client.connect(); return client;
}
async function withDb<T>(database: string, action: (client: Client) => Promise<T>) {
  const client = await clientFor(database); try { return await action(client); } finally { await client.end(); }
}
async function transaction(client: Client, sql: string) {
  await client.query("BEGIN"); try { await client.query(sql); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
}
const projectSnapshotSql = `SELECT id, org_id, kind FROM projects WHERE id LIKE 'drill-%' ORDER BY id`;
async function projectSnapshot(client: Client) { return (await client.query(projectSnapshotSql)).rows; }
try {
  // Never adopt or remove an existing project, even if its name matches ours.
  if (docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`)
    || docker("network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`)
    || docker("volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`)) throw new Error("rehearsal project already exists");
  owned = true;
  compose("up", "-d", "--wait", "--wait-timeout", "90");
  const port = Number(compose("port", "postgres", "5432").split(":").at(-1));
  if (!Number.isInteger(port) || port <= 0) throw new Error("invalid loopback database port");
  cfg = { host: "127.0.0.1", port, user: "postgres", password: "synthetic_rehearsal_only", connectionTimeoutMillis: 5000, statement_timeout: 120_000 };
  report.port = port;
  const containerId = compose("ps", "-q", "postgres");
  report.resourceLimits = JSON.parse(docker("inspect", "--format", '{"memoryBytes":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}}}', containerId));
  await withDb("postgres", async client => {
    await client.query("CREATE DATABASE wsx_4763_ledger_model");
    await client.query("CREATE DATABASE wsx_4763_w1_model");
  });
  const baselineNames = snapshot.ledger.map(item => item.name);
  const baselineDir = directory(baselineNames);
  const ledgerModel: Record<string, unknown> = { model: "184-ledger-names-target-source", baselineCount: baselineNames.length,
    baselineSourceSha256: migrationHash(JSON.stringify(baselineNames.sort().map(name => ({ name, checksum: migrationHash(readFileSync(join(source, name), "utf8")) })))),
    productionChecksumsReused: false, productionEquivalent: false };
  (report.models as unknown[]).push(ledgerModel);
  try {
    const applied = await authority.migrate({ ...cfg, database: "wsx_4763_ledger_model" }, { dir: baselineDir });
    ledgerModel.applied = applied.applied.length;
    const pending = await authority.migrate({ ...cfg, database: "wsx_4763_ledger_model" }, { dir: source });
    ledgerModel.pendingApplied = pending.applied.length; ledgerModel.status = "source-replay-only";
  } catch (error) {
    // Synthetic SQL only; record migration identity and sanitized error, not row values.
    ledgerModel.status = "baseline-source-replay-blocked";
    ledgerModel.failure = String(error).slice(0, 500);
  }
  const scoped: Record<string, unknown> = { model: "canonical-prefix-before-W1", prefixCount: prefix.length,
    pendingSuffixCount: all.length - prefix.length, productionEquivalent: false,
    prefixSourceSha256: migrationHash(JSON.stringify(prefix.map(name => ({ name, checksum: migrationHash(readFileSync(join(source, name), "utf8")) })))),
    productionPendingPreappliedByModel: prefix.filter(name => !baselineNames.includes(name)),
    limitation: "This model pre-applies many production-pending migrations; it cannot prove all 193 production pending migrations safe." };
  (report.models as unknown[]).push(scoped);
  await authority.migrate({ ...cfg, database: "wsx_4763_w1_model" }, { dir: directory(prefix) });
  const db = "wsx_4763_w1_model";
  await withDb(db, async client => {
    for (const org of ["a", "b"]) {
      await client.query("INSERT INTO organizations(id,name,kind) VALUES ($1,$2,'organization')", [`drill-org-${org}`, `Synthetic ${org}`]);
      for (const [suffix, kind, table] of [["r", "research_project", "research_projects"], ["u", "user_insight", "user_insights"]]) {
        const id = `drill-${org}-${suffix}`;
        await client.query("INSERT INTO projects(id,org_id,name,kind) VALUES($1,$2,$3,$4)", [id, `drill-org-${org}`, id, kind]);
        await client.query(`INSERT INTO ${table}(id,org_id) VALUES($1,$2)`, [id, `drill-org-${org}`]);
        for (const role of ["owner", "collaborator"]) await client.query(`INSERT INTO ${suffix === "r" ? "research_project_members" : "user_insight_members"}(user_id,project_id,org_id,role) VALUES($1,$2,$3,$4)`, [`drill-user-${org}-${role}`, id, `drill-org-${org}`, role]);
      }
      const agent = `drill-agent-${org}`;
      await client.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at,catalog_source) VALUES($1,$2,'d002-research-knowledge-analyst',$1,'enabled','synthetic',now(),now(),'official')`, [agent, `drill-org-${org}`]);
      await client.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at,catalog_source) VALUES($1,$2,$3,'1.0.0',$4,'synthetic only','{}','synthetic','synthetic','[]','synthetic',now(),now(),'official')`, [`drill-version-${org}`, `drill-org-${org}`, agent, "0".repeat(64)]);
    }
  });
  const fullDir = directory(all);
  for (const name of [w1, portrait, tags]) {
    await authority.migrate({ ...cfg, database: db }, { dir: directory(all.slice(0, all.indexOf(name))) });
    const exact = readFileSync(join(source, name), "utf8");
    const injected = name === w1 ? `${exact}\nSELECT rehearsal_deliberate_failure();\n` : exact.replace("ALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;", "SELECT rehearsal_deliberate_failure();\nALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;");
    if (injected === exact) throw new Error("fault injection missing");
    (report.faultInjections as unknown[]).push({ name, exactChecksum: migrationHash(exact), injectedChecksum: migrationHash(injected), scope: "isolated synthetic transaction only" });
    writeFileSync(join(fullDir, name), injected);
    const before = await withDb(db, projectSnapshot);
    const agentDigestSql = "SELECT md5(COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.id)::text,'')) digest FROM agent_versions v WHERE id LIKE 'drill-%'";
    const beforeAgentDigest = await withDb(db, async client => (await client.query(agentDigestSql)).rows[0]?.digest);
    let failed = false;
    try { await authority.migrate({ ...cfg, database: db }, { dir: fullDir }); }
    catch (error) { failed = String(error).includes(`migration ${name} failed`) && String(error).includes("rehearsal_deliberate_failure"); }
    check(`transaction-failure-observed:${name}`, failed);
    await withDb(db, async client => {
      check(`project-data-rollback:${name}`, await projectSnapshot(client), before);
      check(`agent-version-data-rollback:${name}`, (await client.query(agentDigestSql)).rows[0]?.digest, beforeAgentDigest);
      check(`failed-migration-not-ledgered:${name}`, (await client.query("SELECT count(*)::integer n FROM _kernel_migrations WHERE name=$1", [name])).rows[0]?.n, 0);
      check(`immutable-trigger-restored-on-rollback:${name}`, (await client.query("SELECT tgenabled FROM pg_trigger WHERE tgname='agent_versions_immutable_trg'")).rows[0]?.tgenabled, "O");
    });
    copyFileSync(join(source, name), join(fullDir, name));
    // Stop next run at the next selected fault, rather than silently applying it now.
    const next = name === w1 ? portrait : name === portrait ? tags : null;
    if (next) {
      const text = readFileSync(join(source, next), "utf8");
      writeFileSync(join(fullDir, next), text.replace("ALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;", "SELECT rehearsal_deliberate_failure();\nALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;"));
    }
  }
  await authority.migrate({ ...cfg, database: db }, { dir: fullDir });
  await withDb(db, async client => {
    const expectedProjects = ["a", "b"].flatMap(org => ["r", "u"].map(suffix => ({ id: `drill-${org}-${suffix}`, org_id: `drill-org-${org}`, kind: "general" })));
    check("W1-project-ID-org-kind-conservation", await projectSnapshot(client), expectedProjects);
    check("W1-subtype-count", (await client.query("SELECT count(*)::integer n FROM general_projects WHERE id LIKE 'drill-%'")).rows[0]?.n, 4);
    const members = (await client.query("SELECT user_id,project_id,org_id,role FROM general_project_members WHERE project_id LIKE 'drill-%' ORDER BY project_id,role")).rows;
    const expectedMembers = ["a", "b"].flatMap(org => ["r", "u"].flatMap(suffix => ["collaborator", "owner"].map(role => ({ user_id: `drill-user-${org}-${role}`, project_id: `drill-${org}-${suffix}`, org_id: `drill-org-${org}`, role }))));
    check("W1-full-membership-conservation", members, expectedMembers);
    check("W1-old-tables-removed", (await client.query("SELECT to_regclass('research_projects') a,to_regclass('user_insights') b,to_regclass('research_project_members') c,to_regclass('user_insight_members') d")).rows, [{ a: null, b: null, c: null, d: null }]);
    const flags = (await client.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('general_projects','general_project_members') ORDER BY relname")).rows;
    check("W1-RLS-FORCE-enabled", flags.every(row => row.relrowsecurity === true && row.relforcerowsecurity === true));
    await client.query("SET ROLE app_rw");
    await client.query("SELECT set_config('app.current_org','drill-org-a',false)");
    check("app-tenant-project-isolation", (await client.query("SELECT org_id FROM general_projects ORDER BY id")).rows, [{ org_id: "drill-org-a" }, { org_id: "drill-org-a" }]);
    let crossTenantWriteRejected = false;
    try { await client.query("INSERT INTO general_project_members(user_id,project_id,org_id,role) VALUES('synthetic-cross-tenant','drill-b-r','drill-org-b','collaborator')"); }
    catch (error) { crossTenantWriteRejected = String(error).includes("row-level security"); }
    check("app-cross-tenant-write-rejected", crossTenantWriteRejected);
    check("app-tenant-member-isolation", (await client.query("SELECT count(*)::integer n FROM general_project_members")).rows[0]?.n, 4);
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('app.current_org','',false)");
    await client.query("CREATE ROLE rehearsal_owner NOSUPERUSER NOBYPASSRLS");
    await client.query("GRANT USAGE ON SCHEMA public TO rehearsal_owner");
    await client.query("ALTER TABLE general_projects OWNER TO rehearsal_owner");
    await client.query("SET ROLE rehearsal_owner");
    check("non-bypass-owner-FORCE-no-tenant-zero-rows", (await client.query("SELECT count(*)::integer n FROM general_projects")).rows[0]?.n, 0);
    await client.query("SELECT set_config('app.current_org','drill-org-a',false)");
    check("non-bypass-owner-FORCE-single-tenant", (await client.query("SELECT count(*)::integer n FROM general_projects")).rows[0]?.n, 2);
    await client.query("RESET ROLE"); await client.query("ALTER TABLE general_projects OWNER TO postgres");
    check("portrait-backfill-draft-and-version", (await client.query("SELECT avatar IS NOT NULL ok FROM agents WHERE id LIKE 'drill-%' UNION ALL SELECT avatar IS NOT NULL ok FROM agent_versions WHERE id LIKE 'drill-%'")).rows.map(row => row.ok), [true, true, true, true]);
    check("tags-backfill-draft-and-version", (await client.query("SELECT cardinality(tags)>0 ok FROM agents WHERE id LIKE 'drill-%' UNION ALL SELECT cardinality(tags)>0 ok FROM agent_versions WHERE id LIKE 'drill-%'")).rows.map(row => row.ok), [true, true, true, true]);
    let immutable = false;
    try { await client.query("UPDATE agent_versions SET instructions='must fail' WHERE id='drill-version-a'"); }
    catch (error) { immutable = String(error).includes("immutable"); }
    check("published-version-immutability-restored", immutable);
    const before = migrationHash(JSON.stringify(await projectSnapshot(client)) + JSON.stringify((await client.query("SELECT id,avatar,tags FROM agent_versions WHERE id LIKE 'drill-%' ORDER BY id")).rows));
    for (const name of [w1, portrait, tags]) await transaction(client, readFileSync(join(source, name), "utf8"));
    const after = migrationHash(JSON.stringify(await projectSnapshot(client)) + JSON.stringify((await client.query("SELECT id,avatar,tags FROM agent_versions WHERE id LIKE 'drill-%' ORDER BY id")).rows));
    check("direct-exact-selected-SQL-idempotency-without-force", after, before);
    scoped.dataDigest = after;
  });
  const repeated = await authority.migrate({ ...cfg, database: db }, { dir: source });
  check("normal-migrator-repeat-applied-zero", repeated.applied.length, 0);
  check("normal-migrator-repeat-skips-complete-target", repeated.skipped.length, all.length);
  scoped.status = "scoped-synthetic-checks-passed";
} catch (error) { report.failure = String(error).slice(0, 500); process.exitCode = 1; }
finally {
  if (owned) {
    try {
      compose("down", "--volumes", "--remove-orphans", "--timeout", "10");
      const containers = docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`);
      const volumes = docker("volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`);
      const networks = docker("network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`);
      report.cleanup = { containers, volumes, networks, passed: !containers && !volumes && !networks };
      if (containers || volumes || networks) process.exitCode = 1;
    } catch (error) { report.cleanup = { passed: false, failure: String(error).slice(0, 300) }; process.exitCode = 1; }
  } else report.cleanup = { passed: true, createdResources: false };
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify({ reportPath, checksPassed: checks.length, productionReady: false, cleanup: report.cleanup, failure: report.failure ?? null }));
}
