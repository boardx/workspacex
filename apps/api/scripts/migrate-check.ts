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
import { createHash } from "node:crypto";
import pg from "pg";

const cfg = migrationConfig();
let bad = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${cond ? "" : ` -- ${detail}`}`);
  if (!cond) bad++;
};

const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/**
 * A schema-only digest cannot detect a replay that duplicates, deletes, or rewrites rows.
 * Keep this generic so every current and future migration-owned table participates without
 * maintaining a second table allowlist. The gate database is deliberately tiny, so sorting
 * canonical JSON for every row is bounded here while still exercising real PostgreSQL types.
 */
async function dataDigest(): Promise<{ digest: string; parts: string[] }> {
  const client = new pg.Client(cfg);
  await client.connect();
  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    const parts: string[] = [];
    for (const { table_name: table } of tables.rows) {
      const relation = quoteIdentifier(table);
      const rows = await client.query<{ n: string; content: string }>(
        `SELECT count(*)::text AS n,
                md5(COALESCE(string_agg(to_jsonb(row_value)::text, E'\\n'
                    ORDER BY to_jsonb(row_value)::text), '')) AS content
           FROM ${relation} AS row_value`,
      );
      parts.push(`rows ${table}=${rows.rows[0]?.n ?? "?"} ${rows.rows[0]?.content ?? "?"}`);
    }
    return { digest: createHash("sha256").update(parts.join("\n")).digest("hex"), parts };
  } finally {
    await client.end();
  }
}

async function seedPopulatedReplayFixture(): Promise<void> {
  const client = new pg.Client(cfg);
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', 'org-migration-replay-probe', true)");
    await client.query(
      `INSERT INTO organizations (id, name, kind, owner_user_id, seat_quota)
       VALUES ('org-migration-replay-probe', 'migration replay probe', 'organization', NULL, 7)
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO teams (id, org_id, name)
       VALUES ('team-migration-replay-probe', 'org-migration-replay-probe', 'migration replay probe')
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO projects (id, org_id, name, kind)
       VALUES ('project-migration-replay-probe', 'org-migration-replay-probe', 'migration replay probe', 'workshop')
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO workshops (id, org_id)
       VALUES ('project-migration-replay-probe', 'org-migration-replay-probe')
       ON CONFLICT (id) DO NOTHING`,
    );
    // Reproduce a real upgrade, not only an empty-schema replay: versions written before
    // `screens` existed have legacy frames/prototype/notes and the column's [] default.
    // The version ledger is append-only, so every later migration must leave this row intact.
    await client.query(
      `INSERT INTO design_projects
         (id, org_id, owner_id, name, template, frames, prototype, frame_notes, screens)
       VALUES
         ('design-migration-replay-probe', 'org-migration-replay-probe',
          'migration-replay-owner', 'migration replay design', 'mobile',
          '["Home"]'::jsonb, '[{"type":"text","text":"Legacy"}]'::jsonb,
          '["legacy note"]'::jsonb,
          '[{"frame":"Home","root":{"type":"text","text":"Legacy"},"notes":"legacy note"}]'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO design_project_prototype_versions
         (id, org_id, project_id, seq, source, summary, frames, prototype, notes)
       VALUES
         ('design-version-migration-replay-probe', 'org-migration-replay-probe',
          'design-migration-replay-probe', 1, 'user', 'legacy version',
          '["Home"]'::jsonb, '[{"type":"text","text":"Legacy"}]'::jsonb,
          '["legacy note"]'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

const first = await migrate(cfg);
console.log(`  applied ${first.applied.length} migration(s) to an empty database`);
const a = await schemaDigest(cfg);

await seedPopulatedReplayFixture();
const dataBeforeReplay = await dataDigest();

const replay = await migrate(cfg, { force: true });
check(
  "force replay re-ran every file (not silently skipped by the version table)",
  replay.applied.length === migrationFiles().length,
  `replayed ${replay.applied.length} of ${migrationFiles().length}`,
);
const b = await schemaDigest(cfg);
const dataAfterReplay = await dataDigest();

check("schema digest identical after replay", a.digest === b.digest, `${a.digest.slice(0, 12)} vs ${b.digest.slice(0, 12)}`);
if (a.digest !== b.digest) {
  const setA = new Set(a.parts);
  const setB = new Set(b.parts);
  for (const p of a.parts) if (!setB.has(p)) console.log(`      only before: ${p}`);
  for (const p of b.parts) if (!setA.has(p)) console.log(`      only after : ${p}`);
}

check(
  "populated database data identical after replay",
  dataBeforeReplay.digest === dataAfterReplay.digest,
  `${dataBeforeReplay.digest.slice(0, 12)} vs ${dataAfterReplay.digest.slice(0, 12)}`,
);
if (dataBeforeReplay.digest !== dataAfterReplay.digest) {
  const before = new Set(dataBeforeReplay.parts);
  const after = new Set(dataAfterReplay.parts);
  for (const part of dataBeforeReplay.parts) if (!after.has(part)) console.log(`    - ${part}`);
  for (const part of dataAfterReplay.parts) if (!before.has(part)) console.log(`    + ${part}`);
}

const probe = new pg.Client(cfg);
await probe.connect();
const populatedProbeCount = await probe.query<{ n: string }>(
  "SELECT count(*)::text AS n FROM organizations WHERE id = 'org-migration-replay-probe'",
);
const legacyVersion = await probe.query<{ screens: unknown; frames: unknown; prototype: unknown; notes: unknown }>(
  `SELECT screens, frames, prototype, notes
     FROM design_project_prototype_versions
    WHERE id = 'design-version-migration-replay-probe'`,
);
let versionUpdateBlocked = false;
try {
  await probe.query(
    `UPDATE design_project_prototype_versions
        SET summary = 'must remain immutable'
      WHERE id = 'design-version-migration-replay-probe'`,
  );
} catch (error) {
  versionUpdateBlocked = /append-only/i.test((error as Error).message);
}
await probe.end();
check("populated replay fixture survived", populatedProbeCount.rows[0]?.n === "1", `count=${populatedProbeCount.rows[0]?.n ?? "?"}`);
check(
  "legacy prototype version survived replay byte-for-byte",
  JSON.stringify(legacyVersion.rows[0]?.screens) === "[]" &&
    JSON.stringify(legacyVersion.rows[0]?.frames) === '["Home"]' &&
    JSON.stringify(legacyVersion.rows[0]?.prototype) === '[{"text":"Legacy","type":"text"}]' &&
    JSON.stringify(legacyVersion.rows[0]?.notes) === '["legacy note"]',
  JSON.stringify(legacyVersion.rows[0]),
);
check("prototype version remains append-only after replay", versionUpdateBlocked);

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
