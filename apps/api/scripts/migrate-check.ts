/**
 * migrate:check -- idempotency of the migration set (UC-0.6 V6).
 *
 * Naive version of this check: run migrations, run them again, compare. With a version
 * table the second run is a no-op, so it passes while testing nothing -- the seventh
 * instance of "green gate, idle gate" in this project.
 *
 * What it does instead: replay every file with `force: true`, ignoring the version table,
 * and compare schema digests. That asserts the property that actually matters -- each
 * migration file is individually replayable, which is what repair after a partial failure
 * depends on. Production never lets you rebuild the database.
 *
 * The digest includes rls_probe's ROW COUNT, so a non-idempotent seed is caught too.
 */
import { migrate, migrationFiles, schemaDigest, MIGRATIONS_DIR } from "../src/infrastructure/db/migrator";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import pg from "pg";

const cfg = migrationConfig();
let bad = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${cond ? "" : ` -- ${detail}`}`);
  if (!cond) bad++;
};

const first = await migrate(cfg);
console.log(`  applied ${first.applied.length} migration(s) to an empty database`);
const a = await schemaDigest(cfg);

const replay = await migrate(cfg, { force: true });
check(
  "force replay re-ran every file (not silently skipped by the version table)",
  replay.applied.length === migrationFiles().length,
  `replayed ${replay.applied.length} of ${migrationFiles().length}`,
);
const b = await schemaDigest(cfg);

check("schema digest identical after replay", a.digest === b.digest, `${a.digest.slice(0, 12)} vs ${b.digest.slice(0, 12)}`);
if (a.digest !== b.digest) {
  const setA = new Set(a.parts);
  const setB = new Set(b.parts);
  for (const p of a.parts) if (!setB.has(p)) console.log(`      only before: ${p}`);
  for (const p of b.parts) if (!setA.has(p)) console.log(`      only after : ${p}`);
}

const client = new pg.Client(cfg);
await client.connect();
const recorded = new Set(
  (await client.query<{ name: string }>("SELECT name FROM _kernel_migrations")).rows.map((r) => r.name),
);
await client.end();
const missing = migrationFiles().filter((f) => !recorded.has(f));
check("every file in migrations/ is recorded in the version table", missing.length === 0, missing.join(", "));

console.log(`  (migrations dir: ${MIGRATIONS_DIR})`);
console.log(bad === 0 ? "✅ migrate:check: migrations rebuild from empty and are individually replayable" : `❌ migrate:check: ${bad} failure(s). Do not work around this by rebuilding the database -- production will not offer that option.`);
process.exit(bad === 0 ? 0 : 1);
