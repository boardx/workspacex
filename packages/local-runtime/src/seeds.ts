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
import { databaseEnv, apiEnv, paths, provisionAdminEnv, type LocalConfig } from "./config";
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
}

/** Owner-phase seeds: need the migration role (platform org, skills, canvas templates). */
export async function runOwnerSeeds(c: LocalConfig, log: Log): Promise<void> {
  const state = readSeedState(c);
  const env = apiEnv(c);
  if (!state.platformSeeded) {
    await apiScript(c, "scripts/backfill-platform-org.ts", [], env, log);
    await apiScript(c, "scripts/backfill-platform-skills.ts", [], env, log);
    await apiScript(c, "scripts/backfill-canvas-builtin-templates.ts", [PLATFORM_ORG_ID], env, log);
    writeSeedState(c, { ...state, platformSeeded: true });
  }
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
