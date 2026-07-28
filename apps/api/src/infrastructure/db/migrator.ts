/**
 * Migration runner -- explicit SQL, forward-only, idempotent, rebuildable from an empty
 * database (UC-0.6 R7).
 *
 * ## Why the `force` switch has to exist
 * With a version table, a second run is trivially a no-op, so "running twice yields the
 * same result" would be automatically true while testing nothing. This project has already
 * hit "gate is green but idle" six times; this would have been the seventh.
 *
 * So `migrate:check` uses `force: true` to replay every file ignoring the version table,
 * then compares schema digests. That tests the property that actually matters: every
 * migration file is individually replayable -- which is what repair after a partial failure
 * and disaster replay both depend on. Production never lets you rebuild the database.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { PgConfig } from "./pg-config";

export const MIGRATIONS_DIR = new URL("../../../migrations/", import.meta.url).pathname;

const VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS _kernel_migrations (
  name       text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

export function migrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

export interface MigrateResult {
  readonly applied: string[];
  readonly skipped: string[];
}

export async function migrate(
  cfg: PgConfig,
  opts: { force?: boolean; dir?: string } = {},
): Promise<MigrateResult> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const client = new pg.Client(cfg);
  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query(VERSION_TABLE);
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM _kernel_migrations")).rows.map((r) => r.name),
    );
    for (const name of migrationFiles(dir)) {
      if (done.has(name) && !opts.force) {
        skipped.push(name);
        continue;
      }
      const sql = readFileSync(join(dir, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      // One transaction per file: a failure rolls the whole file back, never half a schema.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO _kernel_migrations (name, checksum) VALUES ($1, $2)
             ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum`,
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${name} failed: ${(e as Error).message}`);
      }
      applied.push(name);
    }
  } finally {
    await client.end();
  }
  return { applied, skipped };
}

/**
 * Schema digest -- what the idempotency assertion compares.
 *
 * Deliberately includes the probe table's ROW COUNT: comparing structure alone would let
 * a non-idempotent seed (a few extra rows on every replay) slip through, and "replay
 * doubles the data" is exactly what this class of bug looks like in practice.
 */
export async function schemaDigest(cfg: PgConfig): Promise<{ digest: string; parts: string[] }> {
  const client = new pg.Client(cfg);
  await client.connect();
  try {
    const parts: string[] = [];
    const columns = await client.query<{ t: string; c: string; d: string; n: string }>(
      `SELECT table_name AS t, column_name AS c, data_type AS d, is_nullable AS n
         FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`,
    );
    for (const r of columns.rows) parts.push(`col ${r.t}.${r.c} ${r.d} ${r.n}`);

    const policies = await client.query<{ t: string; p: string; q: string | null; w: string | null }>(
      `SELECT tablename AS t, policyname AS p, qual AS q, with_check AS w
         FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`,
    );
    for (const r of policies.rows) parts.push(`policy ${r.t}.${r.p} USING(${r.q}) CHECK(${r.w})`);

    const rls = await client.query<{ t: string; e: boolean; f: boolean }>(
      `SELECT c.relname AS t, c.relrowsecurity AS e, c.relforcerowsecurity AS f
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
    );
    for (const r of rls.rows) parts.push(`rls ${r.t} enabled=${r.e} forced=${r.f}`);

    const probe = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM rls_probe");
    parts.push(`rows rls_probe=${probe.rows[0]?.n ?? "?"}`);

    return { digest: createHash("sha256").update(parts.join("\n")).digest("hex"), parts };
  } finally {
    await client.end();
  }
}
