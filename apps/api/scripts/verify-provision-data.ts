/** Explicit isolated integration lane; creates/drops ONLY its random test database. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { migrate } from "../src/infrastructure/db/migrator";

if (process.env.WORKSPACEX_DATA_TEST !== "1") throw new Error("requires explicit WORKSPACEX_DATA_TEST=1 and isolated PostgreSQL/Redis");
const execute = promisify(execFile);
const name = `wsx_provision_${randomBytes(8).toString("hex")}`;
const cfg = { ...migrationConfig(), database: name };
const owner = new pg.Client({ ...cfg, database: "postgres" });
await owner.connect();
try {
  await owner.query(`CREATE DATABASE "${name}"`);
  const first = await migrate(cfg);
  assert(first.applied.length > 0);
  const replay = await migrate(cfg);
  assert.equal(replay.applied.length, 0);
  assert.equal(replay.skipped.length, first.applied.length);
  const lock = new pg.Client(cfg);
  await lock.connect();
  try {
    await lock.query("SELECT pg_advisory_lock($1)", [8_014_530_119_003_001]);
    const started = Date.now();
    await assert.rejects(migrate(cfg, { lockTimeoutMs: 100 }), error => (error as { code?: string }).code === "55P03");
    assert(Date.now() - started < 3000);
  } finally { await lock.end(); }
  const env = { ...process.env, PGDATABASE: name, WORKSPACEX_DEPLOY_PROFILE: "starter",
    APP_DB_PASSWORD: process.env.APP_DB_PASSWORD,
    PROVISION_ADMIN_EMAIL: "integration@example.com", PROVISION_ADMIN_PASSWORD: "isolated-provision-password",
    PROVISION_ADMIN_NAME: "Integration", PROVISION_ORG_NAME: "Integration" };
  const run = (script: string, overrides = {}) => execute(process.execPath, ["--import", "tsx", new URL(script, import.meta.url).pathname], { env: { ...env, ...overrides }, timeout: 30000 });
  const initial = JSON.parse((await run("./provision-admin.ts")).stdout);
  assert.equal(initial.created, true);
  const repeat = await Promise.all([run("./provision-admin.ts"), run("./provision-admin.ts")]);
  for (const response of repeat) {
    const result = JSON.parse(response.stdout);
    assert.equal(result.created, false); assert.equal(result.userId, initial.userId); assert.equal(result.orgId, initial.orgId);
  }
  await assert.rejects(run("./provision-admin.ts", { PROVISION_ADMIN_PASSWORD: "wrong-provision-password" }));
  assert.equal(JSON.parse((await run("./data-readiness.ts")).stdout).ok, true);
  await assert.rejects(run("./data-readiness.ts", { REDIS_PASSWORD: "wrong-cache-password" }));
  console.log(JSON.stringify({ ok: true, migrated: first.applied.length, replay: true, lockTimeout: true,
    bootstrap: true, concurrentRetry: true, wrongAdminRejected: true, readiness: true, wrongRedisRejected: true, cloudVerified: false }));
} finally {
  await owner.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await owner.end();
}
