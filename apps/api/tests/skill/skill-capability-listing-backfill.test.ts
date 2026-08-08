/**
 * `backfillSkillCapabilityListings`（`scripts/backfill-skill-capability-listings.ts`）—
 * 2026-08-07，人类实测"我在后台不能看到导入了的 skills"的真正修复的补种脚本。
 *
 * 造两行 `skills`：一行没有 `capability_listings`（模拟修复落地前导入的旧数据），
 * 一行已经有（模拟修复落地后新导入的，或走 starter-pack 路径的）——断言脚本只补前者，
 * 且幂等。
 *
 * 独立数据库：脚本扫描 `skills` 全表，不带任何租户过滤——绝不能在共享测试库上跑。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_skill_listing_backfill_${process.pid}_${Date.now()}`;

const ORG = "org-skill-listing-backfill";
const ACTOR = "u-skill-listing-backfill-actor";
const SKILL_MISSING_LISTING = "sk-missing-listing";
const SKILL_HAS_LISTING = "sk-has-listing";

function ownerConfig(database: string) {
  return { ...migrationConfig(), database };
}

async function adminClient(database = "postgres") {
  const client = new pg.Client(ownerConfig(database));
  await client.connect();
  return client;
}

beforeAll(async () => {
  const admin = await adminClient();
  try { await admin.query(`CREATE DATABASE ${DATABASE}`); } finally { await admin.end(); }
  process.env.PGDATABASE = DATABASE;
  await migrate(ownerConfig(DATABASE));

  const owner = new pg.Client(ownerConfig(DATABASE));
  await owner.connect();
  try {
    await owner.query(
      "INSERT INTO organizations (id, name, kind) VALUES ($1, '有导入 skill 缺目录行的组织', 'organization')",
      [ORG],
    );
    await owner.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$1,'修复前导入的 skill','enabled',$3,now(),now())`,
      [SKILL_MISSING_LISTING, ORG, ACTOR],
    );
    await owner.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$1,'修复后导入的 skill','enabled',$3,now(),now())`,
      [SKILL_HAS_LISTING, ORG, ACTOR],
    );
    await owner.query(
      `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
       VALUES ($1,$2,'skill','修复后导入的 skill','org-wide',NULL,true,NULL)`,
      [SKILL_HAS_LISTING, ORG],
    );
  } finally {
    await owner.end();
  }
}, 60_000);

afterAll(async () => {
  const admin = await adminClient();
  try { await dropDatabaseAfterDraining(admin, DATABASE); }
  finally {
    await admin.end();
    if (ORIGINAL_DATABASE === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = ORIGINAL_DATABASE;
  }
}, 30_000);

describe("backfillSkillCapabilityListings：补种既有 URL 导入 skill 缺失的目录行", () => {
  it("只补缺失的那一行，不动已经有目录行的那一行，且幂等", async () => {
    const { backfillSkillCapabilityListings } = await import("../../scripts/backfill-skill-capability-listings");

    const first = await backfillSkillCapabilityListings();
    expect(first.candidateCount).toBe(1);
    expect(first.created).toBe(1);

    const owner = new pg.Client(ownerConfig(DATABASE));
    await owner.connect();
    try {
      const rows = await owner.query<{ id: string; name: string; kind: string; enabled: boolean }>(
        "SELECT id, name, kind, enabled FROM capability_listings WHERE org_id = $1 ORDER BY id",
        [ORG],
      );
      expect(rows.rows).toHaveLength(2);
      const backfilled = rows.rows.find((r) => r.id === SKILL_MISSING_LISTING);
      expect(backfilled?.name).toBe("修复前导入的 skill");
      expect(backfilled?.kind).toBe("skill");
      expect(backfilled?.enabled).toBe(true);
    } finally {
      await owner.end();
    }

    const second = await backfillSkillCapabilityListings();
    expect(second.candidateCount).toBe(0);
    expect(second.created).toBe(0);
  });
});
