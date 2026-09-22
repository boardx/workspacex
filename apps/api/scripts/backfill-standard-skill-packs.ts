/**
 * Idempotent backfill of the nine standard platform skill packs (`STANDARD_PLATFORM_PACKS`:
 * standard-web / data-workflows / standard-methods / standard-context / standard-canvas /
 * standard-document / standard-authoring / standard-visual / standard-audio) into the
 * platform org, via the same `importSkillStarterPack` use case the API's boot-time self-heal
 * runs (`main.ts` → `ensurePlatformSkillCatalogSeeded`).
 *
 * Why a script: WorkspaceX Local seeds the platform library in its PGlite **owner phase**
 * (`packages/local-runtime/src/seeds.ts`) and then serves as `app_rw` with the self-heal
 * switched off (`KERNEL_PLATFORM_SKILL_SELFHEAL=off`). Until 2026-09-17 nothing on that
 * path ever imported the packs, so a local install had zero mountable skills (#3716).
 *
 * Usage: `pnpm --filter @repo/api exec tsx scripts/backfill-standard-skill-packs.ts`
 * Exit code 1 when any pack failed — a partial library must not read as "seeded".
 */
import { isCliEntry } from "./cli-entry";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { SERVICE_ACTOR_ID } from "../src/infrastructure/skill/ensure-platform-skill-catalog";
import {
  ensureStandardSkillPacksSeeded,
  type StandardPackSeedOutcome,
} from "../src/infrastructure/skill/ensure-standard-skill-packs";

export async function backfillStandardSkillPacks(): Promise<readonly StandardPackSeedOutcome[]> {
  const db = new PgDatabase(migrationConfig());
  try {
    return await ensureStandardSkillPacksSeeded(db, SERVICE_ACTOR_ID);
  } finally {
    await db.close();
  }
}

if (isCliEntry(import.meta.url)) {
  const outcomes = await backfillStandardSkillPacks();
  const created = outcomes.filter((o) => o.ok && o.created).map((o) => o.packId);
  const existed = outcomes.filter((o) => o.ok && !o.created).map((o) => o.packId);
  const failed = outcomes.filter((o) => !o.ok);
  console.log(
    `[backfill-standard-skill-packs] 完成：新导入 ${String(created.length)} 个` +
    (created.length > 0 ? `（${created.join(", ")}）` : "") +
    `，${String(existed.length)} 个已存在跳过` +
    (existed.length > 0 ? `（${existed.join(", ")}）` : "") + "。",
  );
  for (const f of failed) console.error(`[backfill-standard-skill-packs] 失败：${f.packId}@${f.packVersion}`, f.error);
  if (failed.length > 0) process.exit(1);
}
