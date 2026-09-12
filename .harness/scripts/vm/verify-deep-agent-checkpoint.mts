/** Run only through with-test-isolation; never against deployment credentials. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolatedDatabase } from "../lib/test-isolation";

assertIsolatedDatabase({ resolvedDatabase: process.env.WORKSPACEX_DB ?? "", env: process.env });
const project = process.env.COMPOSE_PROJECT_NAME ?? "";
assert.match(project, /^wsx-[a-zA-Z0-9-]+$/, "dedicated isolation project required");
assert.ok(process.env.WORKSPACEX_ISOLATION_ID && process.env.WORKSPACEX_ISOLATION_SEED, "run through with-test-isolation");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const compose = ["compose", "-f", join(root, "apps/api/docker-compose.dev.yml"), "-p", project];
const temp = mkdtempSync(join(tmpdir(), "checkpoint-pg-verification-"));
const envFile = join(temp, "deploy.env");
writeFileSync(envFile, "", { mode: 0o600 });
const commands: string[][] = [];
const outputs: string[] = [];
function run(binary: string, args: string[], input?: string, allowFailure = false) {
  commands.push([binary, ...args]);
  const result = spawnSync(binary, args, { encoding: "utf8", input, cwd: root, timeout: 120000, maxBuffer: 1024 * 1024 });
  outputs.push(result.stdout ?? "", result.stderr ?? "");
  // Do not echo child diagnostics: they may contain SQL or credentials.
  if (!allowFailure && result.status !== 0) throw new Error(`verification subprocess failed: ${binary} (status ${result.status})`);
  return result;
}
let container = "";
const admin = (sql: string) => run("docker", ["exec", "-i", container, "psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], sql).stdout.trim();
const bootstrap = (file = envFile, allowFailure = false) => run("bash", ["-c", 'set -euo pipefail; source "$1"; deep_agent_checkpoint_bootstrap "$2" "$3"', "checkpoint-verify", join(root, ".harness/scripts/vm/deep-agent-lib.sh"), file, container], undefined, allowFailure);
let cleanupFailed = false;
let ownsStack = false;
try {
  // Never attach to an existing stack, even one carrying a colliding isolation name.
  assert.equal(run("docker", [...compose, "ps", "-aq"]).stdout.trim(), "", "isolation project already contains containers");
  ownsStack = true;
  run("docker", [...compose, "up", "-d", "postgres"]);
  container = run("docker", [...compose, "ps", "-q", "postgres"]).stdout.trim();
  assert.ok(container && !container.includes("\n"), "one isolated PostgreSQL container required");
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (run("docker", ["exec", container, "pg_isready", "-U", "postgres"], undefined, true).status === 0) { ready = true; break; }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.ok(ready, "isolated PostgreSQL readiness timed out");
  console.log("VERIFY: dedicated database bootstrap and idempotency");
  const first = bootstrap();
  const saved = readFileSync(envFile, "utf8");
  const password = /wsx_deep_agent:([0-9a-f]{64})@postgres:5432\/wsx_deep_agent/.exec(saved)?.[1];
  assert.ok(password, "managed checkpoint DSN not generated");
  const network = first.stdout.trim();
  assert.equal(network, `${project}_default`, "unexpected database network");
  assert.equal(statSync(envFile).mode & 0o777, 0o600);
  assert.equal(bootstrap().stdout.trim(), network);
  assert.ok(readFileSync(envFile, "utf8") === saved, "repeat bootstrap changed credentials");
  assert.equal(admin("SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls FROM pg_roles WHERE rolname='wsx_deep_agent';\n"), "t");
  assert.equal(admin("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='wsx_deep_agent';\n"), "wsx_deep_agent");
  console.log("VERIFY: dedicated identity via container TCP");
  const image = run("docker", ["inspect", "--format", "{{.Config.Image}}", container]).stdout.trim();
  // The password is stdin to a disposable network client, not docker/sh/psql argv.
  const connected = run("docker", ["run", "--rm", "-i", "--network", network, image, "sh", "-c", 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -A -t -q -v ON_ERROR_STOP=1 -h postgres -U wsx_deep_agent -d wsx_deep_agent'], password + "\nCREATE TABLE checkpoint_probe(id integer PRIMARY KEY); INSERT INTO checkpoint_probe VALUES(7); SELECT current_user || ':' || current_database() || ':' || id FROM checkpoint_probe;\n");
  assert.equal(connected.stdout.trim(), "wsx_deep_agent:wsx_deep_agent:7");
  console.log("VERIFY: ledger setup and async graph checkpoint recovery");
  const python = process.env.CHECKPOINT_TEST_PYTHON;
  assert.ok(python, "CHECKPOINT_TEST_PYTHON must select the installed DeepAgent Python environment");
  const port = run("docker", [...compose, "port", "postgres", "5432"]).stdout.trim().split(":").at(-1);
  assert.match(port ?? "", /^\d+$/, "isolated PostgreSQL published port missing");
  const probe = "import sys, asyncio; sys.path.insert(0, sys.argv[1]); from deep_agent_service.postgres_checkpointer import probe_checkpoint, probe_checkpoint_isolation, probe_restricted_runtime; from deep_agent_service.self_hosted_runtime import PostgresLedger; dsn=sys.stdin.read().strip(); ledger=PostgresLedger(dsn); asyncio.run(ledger.prepare()); asyncio.run(ledger.create_thread('ledger-probe','reject')); asyncio.run(ledger.create_run('ledger-probe','ledger-run-probe',{'assistant_id':'Guided Research'})); latest=asyncio.run(ledger.latest_run('ledger-probe')); assert latest['assistant_id']=='Guided Research' and 'request' not in latest; asyncio.run(probe_checkpoint(dsn)); asyncio.run(probe_checkpoint_isolation(dsn)); asyncio.run(probe_restricted_runtime(dsn))";
  run(python, ["-c", probe, join(root, "apps/deep-agent-service/src")], `postgresql://wsx_deep_agent:${password}@127.0.0.1:${port}/wsx_deep_agent`);
  console.log("VERIFY: external configuration preservation and foreign-role rejection");
  const externalFile = join(temp, "external.env");
  const external = "DEEP_AGENT_CHECKPOINT_DB=postgresql://external:external-sentinel@external.invalid/external\n";
  writeFileSync(externalFile, external, { mode: 0o600 });
  assert.equal(bootstrap(externalFile).stdout.trim(), network);
  assert.ok(readFileSync(externalFile, "utf8") === external, "external DSN changed");
  // Simulate a foreign preexisting role only inside this disposable PostgreSQL.
  admin("DROP DATABASE wsx_deep_agent; DROP ROLE wsx_deep_agent; CREATE ROLE wsx_deep_agent LOGIN;\n");
  assert.notEqual(bootstrap(envFile, true).status, 0, "foreign role was adopted");
  assert.equal(admin("SELECT COALESCE(shobj_description(oid,'pg_authid'),'unmarked') FROM pg_roles WHERE rolname='wsx_deep_agent';\n"), "unmarked");
  assert.equal(admin("SELECT count(*) FROM pg_database WHERE datname='wsx_deep_agent';\n"), "0");
  assert.ok(!JSON.stringify(commands).includes(password), "credential leaked into command arguments");
  assert.ok(!outputs.join("\n").includes(password), "credential leaked into subprocess output");
  assert.ok(!outputs.join("\n").includes("external-sentinel"), "external credential leaked into output");
  console.log("PASS: isolated checkpoint bootstrap, idempotency, least-privilege role, container TCP write, async graph checkpoint and restart, cross-assistant namespace and deletion isolation, actual restricted selector/runtime/HTTP recovery, foreign-role rejection, external DSN preservation, secret output boundaries");
} finally {
  if (ownsStack) cleanupFailed = run("docker", [...compose, "down", "-v", "--remove-orphans"], undefined, true).status !== 0;
  rmSync(temp, { recursive: true, force: true });
  if (cleanupFailed) throw new Error("checkpoint verification stack cleanup failed");
}
