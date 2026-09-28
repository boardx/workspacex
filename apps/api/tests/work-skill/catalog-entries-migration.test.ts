/**
 * WS02（Phase 20）：`skill_catalog_entries` 迁移的结构、约束与 RLS；并锁住「不改 skill_versions 结构」。
 * 真实 PostgreSQL：约束由 DB 执行，RLS 以 app_rw（非 owner、无 BYPASSRLS）验证。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-ws02-mig";
const OTHER = "org-ws02-mig-other";

/** skill_versions 在 WS02 之前的列集合（20260804031000 及其后续迁移）；本迁移不得增删。 */
async function columns(table: string): Promise<string[]> {
  return asOwner(async (c) => (await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`, [table])).rows.map((r) => r.column_name));
}

async function seedSkill(orgId: string, id: string): Promise<void> {
  await asOwner((c) => c.query(
    `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
     VALUES ($1,$2,$1,$1,'enabled','u-ws02',now(),now())`, [id, orgId]));
}

const insertEntry = (orgId: string, skillId: string, extra: { stableId?: string; channel?: string; successor?: string | null } = {}) =>
  asApp(orgId, (c) => c.query(
    `INSERT INTO skill_catalog_entries (org_id, skill_id, stable_id, domain, ${extra.channel ? "channel," : ""} successor_skill_id, search_document, updated_by, updated_at)
     VALUES ($1,$2,$3,'Research',${extra.channel ? "$6," : ""} $4,'x','u-ws02',$5)`,
    [orgId, skillId, extra.stableId ?? "S003", extra.successor ?? null, new Date().toISOString(), ...(extra.channel ? [extra.channel] : [])]));

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await seedOrg({ orgId: OTHER, projectId: `${OTHER}-p` });
  await seedSkill(ORG, "skill-ws02-a");
  await seedSkill(ORG, "skill-ws02-b");
  await seedSkill(OTHER, "skill-ws02-other");
});

afterAll(async () => {
  await resetOrgs(ORG, OTHER);
});

describe("skill_catalog_entries schema", () => {
  it("has the domain columns, forced RLS and a narrow app_rw grant", async () => {
    expect(await columns("skill_catalog_entries")).toEqual([
      "channel", "domain", "org_id", "search_document", "skill_id", "stable_id",
      "successor_skill_id", "updated_at", "updated_by",
    ]);
    const meta = await asOwner(async (c) => ({
      rls: (await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'skill_catalog_entries'")).rows[0],
      grants: (await c.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_name = 'skill_catalog_entries' AND grantee = 'app_rw' ORDER BY privilege_type`)).rows.map((r) => r.privilege_type),
    }));
    expect(meta.rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(meta.grants).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("does not change the skill_versions table structure", async () => {
    expect(await columns("skill_versions")).toEqual([
      "content_digest", "created_at", "creator_id", "id", "manifest", "org_id", "published", "semantic_label", "skill_id",
    ]);
  });
});

describe("skill_catalog_entries constraints", () => {
  it("defaults channel to candidate", async () => {
    await insertEntry(ORG, "skill-ws02-a");
    const row = await asApp(ORG, async (c) => (await c.query<{ channel: string }>(
      "SELECT channel FROM skill_catalog_entries WHERE skill_id = 'skill-ws02-a'")).rows[0]);
    expect(row?.channel).toBe("candidate");
  });

  it("rejects an unknown channel, a malformed stableId and a self successor", async () => {
    await expect(insertEntry(ORG, "skill-ws02-a", { channel: "beta" })).rejects.toThrow(/check constraint/);
    await expect(insertEntry(ORG, "skill-ws02-a", { stableId: "X1" })).rejects.toThrow(/check constraint/);
    await expect(insertEntry(ORG, "skill-ws02-a", { successor: "skill-ws02-a" })).rejects.toThrow(/not_self/);
  });

  it("keeps one row per skill and a unique stableId per org", async () => {
    await insertEntry(ORG, "skill-ws02-a");
    await expect(insertEntry(ORG, "skill-ws02-a", { stableId: "S004" })).rejects.toThrow(/duplicate key/);
    await expect(insertEntry(ORG, "skill-ws02-b")).rejects.toThrow(/stable_id_uniq/);
  });

  it("requires the skill to exist in the same org", async () => {
    await expect(insertEntry(ORG, "skill-ws02-other")).rejects.toThrow(/foreign key/);
  });
});

describe("skill_catalog_entries RLS", () => {
  it("hides another org's rows and refuses cross-org writes", async () => {
    await insertEntry(OTHER, "skill-ws02-other");
    const visible = await asApp(ORG, async (c) => (await c.query("SELECT skill_id FROM skill_catalog_entries")).rows);
    expect(visible).toEqual([]);
    await expect(asApp(ORG, (c) => c.query(
      `INSERT INTO skill_catalog_entries (org_id, skill_id, stable_id, domain, search_document, updated_by, updated_at)
       VALUES ($1,'skill-ws02-other','S009','Research','x','u',now())`, [OTHER]))).rejects.toThrow(/row-level security/);
    await expect(asApp(ORG, (c) => c.query("DELETE FROM skill_catalog_entries"))).rejects.toThrow(/permission denied/);
  });
});
