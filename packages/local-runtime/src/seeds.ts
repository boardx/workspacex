/**
 * First-start data: migrations, then the platform library (skill packs + canvas templates),
 * then the one local user/org, default agents and the local model row.
 *
 * Every step reuses an EXISTING `apps/api` script -- this file adds no second copy of any
 * seed list (AGENTS.md). Steps are idempotent on the script side; we additionally record
 * completion in `seed-state.json` so a second start only replays migrations (cheap, and
 * the migrator itself skips applied files).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { databaseEnv, apiEnv, paths, provisionAdminEnv, DB_APP_ROLE, DB_NAME, type LocalConfig } from "./config";
import { runToCompletion } from "./processes";

const PLATFORM_ORG_ID = "org-platform"; // apps/api/src/domain/org-id.ts

export interface SeedState {
  readonly provisioned?: { userId: string; orgId: string };
  readonly platformSeeded?: boolean;
  readonly modelsSeeded?: boolean;
}

export function readSeedState(c: LocalConfig): SeedState {
  const p = paths.seedState(c);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SeedState) : {};
}

function writeSeedState(c: LocalConfig, s: SeedState): void {
  writeFileSync(paths.seedState(c), JSON.stringify(s, null, 2));
}

type Log = (line: string) => void;

async function apiScript(c: LocalConfig, rel: string, args: string[], env: Record<string, string>, log: Log): Promise<string> {
  const apiDir = join(c.repoRoot, "apps", "api");
  const r = await runToCompletion({
    name: rel,
    command: join(c.repoRoot, "node_modules", ".bin", "tsx"),
    args: [rel, ...args],
    cwd: apiDir,
    env,
  });
  for (const line of `${r.stdout}${r.stderr}`.split("\n")) if (line.trim()) log(`[${rel}] ${line}`);
  if (r.code !== 0) throw new Error(`${rel} exited ${String(r.code)}`);
  return r.stdout;
}

export async function runMigrations(c: LocalConfig, log: Log): Promise<void> {
  await apiScript(c, "src/infrastructure/db/migrate-cli.ts", [], databaseEnv(c), log);
  await grantLocalServiceDdl(c, log);
}

/**
 * The Python deep-agent service creates and migrates its OWN tables at startup (thread
 * ledger, LangGraph checkpoints, the `workspacex_memory` schema). In the cloud it gets a
 * database user with DDL rights for that; on one machine every process is `app_rw`
 * (see pglite-server.ts), so the app role needs CREATE on the schema and the database.
 * Those tables are the service's private state, never RLS-governed API tables, and
 * `app_rw` owns what it creates -- so no RLS invariant is weakened. Owner phase only.
 */
async function grantLocalServiceDdl(c: LocalConfig, log: Log): Promise<void> {
  const client = new pg.Client({ host: "127.0.0.1", port: c.ports.postgres, user: "postgres", password: "local", database: DB_NAME });
  await client.connect();
  try {
    await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${DB_APP_ROLE}`);
    await client.query(`GRANT CREATE ON DATABASE ${DB_NAME} TO ${DB_APP_ROLE}`);
    log(`[seeds] granted schema/database CREATE to ${DB_APP_ROLE} for the deep-agent service`);
  } finally {
    await client.end();
  }
}

/**
 * What the platform library must contain before the app phase starts. Read from the
 * database itself, **not** from `seed-state.json`: on 2026-09-17 that file said
 * `platformSeeded: true` for a database that had been created 5 s earlier (the three seed
 * scripts had exited 0 without running -- see `apps/api/scripts/cli-entry.ts`), so the
 * local app served zero canvas templates and zero mountable skills. Static trace ≠ live fact.
 */
export interface PlatformLibraryProbe {
  readonly platformOrg: boolean;
  readonly officialSkills: number;
  readonly canvasTemplates: number;
}

/** Human-readable list of what is missing; empty means the library is complete enough to serve. */
export function platformLibraryGaps(p: PlatformLibraryProbe): readonly string[] {
  const gaps: string[] = [];
  if (!p.platformOrg) gaps.push(`platform org ${PLATFORM_ORG_ID}`);
  if (p.officialSkills < 1) gaps.push("official platform skills");
  if (p.canvasTemplates < 1) gaps.push("built-in canvas templates");
  return gaps;
}

/** Owner phase runs as the PGlite superuser, which bypasses RLS -- counts are the whole truth. */
async function probePlatformLibrary(c: LocalConfig): Promise<PlatformLibraryProbe> {
  const client = new pg.Client({ host: "127.0.0.1", port: c.ports.postgres, user: "postgres", password: "local", database: DB_NAME });
  await client.connect();
  try {
    const r = await client.query<{ org: string; skills: string; canvas: string }>(
      `SELECT (SELECT count(*) FROM organizations WHERE id = $1) AS org,
              (SELECT count(*) FROM skills WHERE org_id = $1) AS skills,
              (SELECT count(*) FROM canvas_templates WHERE org_id = $1) AS canvas`,
      [PLATFORM_ORG_ID],
    );
    const row = r.rows[0]!;
    return { platformOrg: Number(row.org) > 0, officialSkills: Number(row.skills), canvasTemplates: Number(row.canvas) };
  } finally {
    await client.end();
  }
}

/** Owner-phase seeds: need the migration role (platform org, skills, canvas templates). */
export async function runOwnerSeeds(c: LocalConfig, log: Log): Promise<void> {
  const state = readSeedState(c);
  const env = apiEnv(c);
  const before = await probePlatformLibrary(c);
  const gaps = platformLibraryGaps(before);
  if (gaps.length > 0) {
    log(`[seeds] platform library incomplete (${gaps.join(", ")}); seeding`);
    await apiScript(c, "scripts/backfill-platform-org.ts", [], env, log);
    await apiScript(c, "scripts/backfill-platform-skills.ts", [], env, log);
    await apiScript(c, "scripts/backfill-canvas-builtin-templates.ts", [PLATFORM_ORG_ID], env, log);
    const after = platformLibraryGaps(await probePlatformLibrary(c));
    if (after.length > 0) throw new Error(`platform seed scripts exited 0 but the library is still missing: ${after.join(", ")}`);
  } else {
    log(`[seeds] platform library present: ${String(before.officialSkills)} skills, ${String(before.canvasTemplates)} canvas templates`);
  }
  // The nine standard packs are imported idempotently on every owner phase -- the same
  // cadence as the cloud API's boot-time self-heal, which the local app has switched off.
  await apiScript(c, "scripts/backfill-standard-skill-packs.ts", [], env, log);
  writeSeedState(c, { ...readSeedState(c), platformSeeded: true });
  if (!state.provisioned) {
    const out = await apiScript(c, "scripts/provision-admin.ts", [], { ...env, ...provisionAdminEnv(c) }, log);
    const line = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).pop();
    if (!line) throw new Error("provision-admin printed no JSON result");
    const parsed = JSON.parse(line) as { ok: boolean; userId?: string; orgId?: string };
    if (!parsed.ok || !parsed.userId || !parsed.orgId) throw new Error(`provision-admin failed: ${line}`);
    writeSeedState(c, { ...readSeedState(c), provisioned: { userId: parsed.userId, orgId: parsed.orgId } });
  }
  const after = readSeedState(c);
  await apiScript(c, "scripts/backfill-default-agents.ts", [], env, log);
  if (!after.modelsSeeded && after.provisioned) {
    await apiScript(c, "scripts/seed-local-models.ts", [], { ...env, SEED_MODEL_ORG_ID: after.provisioned.orgId }, log);
    writeSeedState(c, { ...after, modelsSeeded: true });
  }
}
