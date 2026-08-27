/**
 * F02 -- invariant I-4 (UC-0.3 R12 V9 ①): zero cross-tenant leakage, with data present.
 *
 * `verify-rls.sh` proves the same property against a freshly reset database, where the
 * identity tables are empty -- so for those tables it proves that nothing leaked out of
 * nothing. This file seeds two complete organizations first, because "no rows came back"
 * is only evidence when there were rows to come back.
 *
 * ## Every query here is deliberately unfiltered
 *
 * No `WHERE org_id = ...` anywhere except where the point is the WITH CHECK side. R7 says
 * the database is the first line and application filtering is the second; a check run with
 * the second line still in place cannot tell you whether the first works. So these read
 * `SELECT * FROM <table>` with nothing else and let RLS answer.
 *
 * ## The table list is not written down here either
 *
 * It comes from `kernel_tenant_table_audit()`. When F04 adds the artifact tables, they are
 * covered by this file the day they are created -- nobody has to remember to extend it.
 * That matters more than it sounds: the table that leaks is always the newest one.
 *
 * ## One documented exception: rows the platform itself publishes to everyone
 *
 * `PLATFORM_ORG_ID` (`org-platform`) is a real row in `organizations`, and a small,
 * deliberately-reviewed set of `_platform_read` policies (`20260826120000_platform_
 * canvas_template_library.sql`, `20260827200000_platform_owned_skills.sql`) grant every
 * tenant `FOR SELECT` on rows it owns in specific tables -- currently `canvas_templates`,
 * `skills`, `skill_versions`, `skill_version_files`, `capability_listings`. That is not a
 * leak: it is the policy working as designed, on rows nobody scoped to a tenant in the
 * first place (a global template library / four official Skills every org gets by
 * default). I-4's actual claim is "no OTHER tenant's data crosses the boundary" -- this
 * file excludes `org-platform`'s own rows from both zero-leak assertions below rather
 * than asserting a stronger invariant the schema was never designed to hold. Skill
 * versions/files are the reason this needed a real fix rather than just "delete the test
 * fixture between files": once `published`, `wave2_skill_immutable_trg`
 * (`20260804031000_wave2_skill_starter_import.sql`) refuses UPDATE/DELETE on them --
 * matching production, where a published Skill version never goes away -- so the platform
 * skill rows `backfillPlatformSkills()` writes are meant to persist across every test file
 * that shares this database, the same way `org-platform` itself does.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addBinding,
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { PLATFORM_ORG_ID } from "../../src/domain/org-id";

const A = "org-f02-leak-a";
const B = "org-f02-leak-b";
const PROJ_A = "proj-f02-leak-a";
const PROJ_B = "proj-f02-leak-b";

/** Tenant tables and their tenant column, straight from the catalog. */
async function tenantTables(): Promise<{ table: string; col: string }[]> {
  const rows = await asOwner(
    async (c) =>
      (
        await c.query<{ table_name: string; tenant_column: string }>(
          "SELECT table_name, tenant_column FROM kernel_tenant_table_audit() WHERE verdict = 'ok'",
        )
      ).rows,
  );
  return rows.map((r) => ({ table: r.table_name, col: r.tenant_column }));
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

beforeEach(async () => {
  await resetOrgs(A, B);
  const fa = await seedOrg({ orgId: A, projectId: PROJ_A });
  const fb = await seedOrg({ orgId: B, projectId: PROJ_B });
  await addOrgMember(A, "u-a", "consultant", fa.teams.energy!);
  await addOrgMember(B, "u-b", "consultant", fb.teams.energy!);
  await addProjectMember(A, PROJ_A, "u-a", "member", fa.groups.g1!);
  await addProjectMember(B, PROJ_B, "u-b", "member", fb.groups.g1!);
  await addBinding({ orgId: A, subject: { kind: "user", id: "u-a" }, object: { kind: "project", id: PROJ_A }, scope: "org-wide" });
  await addBinding({ orgId: B, subject: { kind: "user", id: "u-b" }, object: { kind: "project", id: PROJ_B }, scope: "org-wide" });
});

describe("I-4: reads", () => {
  it("sees zero foreign rows in EVERY tenant-carrying table, with both tenants populated", async () => {
    const tables = await tenantTables();
    // Non-vacuity first. An empty list would make the loop below pass without executing.
    expect(tables.length, "the catalog audit returned no tenant tables -- this test is idle").toBeGreaterThanOrEqual(8);

    const foreign = await asApp(A, async (c) => {
      const out: string[] = [];
      for (const { table, col } of tables) {
        // 见本文件头注「一处已记录的例外」：`org-platform` 自己的行不算跨租户
        // 泄漏——`_platform_read` 策略就是设计成让每个租户都看得到它们。
        const r = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${table} WHERE ${col} <> $1 AND ${col} <> $2`,
          [A, PLATFORM_ORG_ID],
        );
        if (r.rows[0]!.n !== "0") out.push(`${table}=${r.rows[0]!.n}`);
      }
      return out;
    });
    expect(foreign).toEqual([]);
  });

  it("...and DOES see its own rows -- isolation, not paralysis", async () => {
    // Without this half, a policy of `USING (false)` passes the test above perfectly. The
    // seeded tables are named explicitly because "some table had rows" is not the claim.
    const own = await asApp(A, async (c) => {
      const counts: Record<string, number> = {};
      for (const t of ["organizations", "teams", "projects", "groups", "org_memberships", "project_memberships", "acl_bindings"]) {
        counts[t] = Number((await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`)).rows[0]!.n);
      }
      return counts;
    });
    for (const [t, n] of Object.entries(own)) expect(n, `${t} returned nothing for its own tenant`).toBeGreaterThan(0);
  });

  it("asking for another tenant's row by its exact id returns nothing, not an error", async () => {
    // The response must not distinguish "not yours" from "does not exist" (UC-0.3 R6
    // failure post-condition). An error here would be a resource-existence oracle.
    const rows = await asApp(A, async (c) => (await c.query("SELECT * FROM projects WHERE id = $1", [PROJ_B])).rows);
    expect(rows).toEqual([]);
  });

  it("with no tenant context at all, every table is empty (fail-closed)", async () => {
    // `current_setting(..., true)` is NULL when unset, and `col = NULL` is NULL, which is
    // not true. Forgetting to scope therefore reads nothing rather than everything -- the
    // entire argument for pushing isolation into the database (R7).
    const tables = await tenantTables();
    const nonEmpty = await asApp(null, async (c) => {
      const out: string[] = [];
      for (const { table, col } of tables) {
        // 同上一条：`_platform_read` 策略不看 `app.current_org`（它的 USING 子句只问
        // "这行是不是 org-platform 的"），所以即使完全没设租户上下文，platform 行
        // 依然会被这个策略放行——这是设计如此，不是 fail-closed 出了缺口。
        const r = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${table} WHERE ${col} <> $1`,
          [PLATFORM_ORG_ID],
        );
        if (r.rows[0]!.n !== "0") out.push(`${table}=${r.rows[0]!.n}`);
      }
      return out;
    });
    expect(nonEmpty).toEqual([]);
  });
});

describe("I-4: writes -- a leak in the other direction", () => {
  it("cannot INSERT a row belonging to another tenant", async () => {
    // WITH CHECK, not USING. Without it a compromised or buggy caller plants rows in
    // someone else's tenant -- invisible to itself afterwards, which makes it worse.
    await expect(
      // F116: `kind` spelled out on purpose. Omitting it would make this row rejected by a
      // NOT NULL violation, and the test would be green while WITH CHECK was gone.
      asApp(A, (c) => c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, $3, 'workshop')", ["x-cross", B, "planted"])),
    ).rejects.toThrow();
  });

  it("an unqualified UPDATE touches only its own tenant's rows", async () => {
    // The realistic accident: a migration or a maintenance script with no WHERE clause.
    // Under RLS its blast radius is one tenant.
    const n = await asApp(A, async (c) => (await c.query("UPDATE projects SET name = 'renamed'")).rowCount);
    expect(n).toBe(1);
    const bName = await asApp(B, async (c) => (await c.query<{ name: string }>("SELECT name FROM projects")).rows[0]!.name);
    expect(bName).toBe(`project ${PROJ_B}`);
  });

  it("an unqualified DELETE touches only its own tenant's rows", async () => {
    const n = await asApp(A, async (c) => (await c.query("DELETE FROM acl_bindings")).rowCount);
    expect(n).toBe(1);
    const remaining = await asApp(B, async (c) => (await c.query("SELECT * FROM acl_bindings")).rows.length);
    expect(remaining).toBe(1);
  });

  it("cannot move an own row into another tenant by UPDATE", async () => {
    // USING lets the row be selected; WITH CHECK must reject the new value. A policy with
    // only USING allows exactly this, and it exfiltrates by writing rather than reading.
    await expect(asApp(A, (c) => c.query("UPDATE projects SET org_id = $1", [B]))).rejects.toThrow();
  });
});
