/**
 * F02 -- invariants I-5 and I-6 (UC-0.3 R12 V9 ② and ③).
 *
 * ## The failure this file exists to prevent
 *
 * In PostgreSQL a table's owner is NOT subject to its row-level security policies unless
 * the table is FORCEd. So an application connected as the owner runs with every policy
 * written, every policy visible in `\d+`, and no policy in effect -- and nothing errors.
 * The whole isolation story would be false while looking correct, and the tests written
 * over it would all pass. That is why "which role is the app" is asserted rather than
 * configured and reviewed.
 *
 * ## Why it is catalog-derived
 *
 * The gate this replaces asked "is every RLS-ENABLED table forced?" -- a question that a
 * brand new table with no RLS at all answers correctly by not being asked. F04 adds six
 * artifact tables; F09/F10 add more. A hand-maintained list would be missing exactly the
 * table that was just added, which is exactly the table nobody has thought about yet.
 * `kernel_tenant_table_audit()` (migration 0004) derives the set from pg_catalog.
 *
 * ## Two-way, and self-checked
 *
 * "Nothing is misconfigured" is trivially true of an audit that sees nothing, so the
 * counts are asserted too -- and the last test breaks the schema on purpose inside a
 * rolled-back transaction and requires the audit to notice. A gate nobody has watched go
 * red is a gate nobody knows works.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce } from "../support/db";

interface AuditRow {
  table_name: string;
  tenant_column: string | null;
  rls_enabled: boolean;
  rls_forced: boolean;
  tenant_policies: number;
  runtime_grants: number;
  verdict: string;
}

const audit = async (): Promise<AuditRow[]> =>
  asOwner(async (c) => (await c.query<AuditRow>("SELECT * FROM kernel_tenant_table_audit()")).rows);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

describe("I-5: the runtime connection is not an owner and cannot escape RLS", () => {
  it("owns no table in public", async () => {
    const n = await asApp(null, async (c) =>
      (
        await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user`,
        )
      ).rows[0]!.n,
    );
    expect(n, "an owner silently bypasses every policy on the table").toBe("0");
  });

  it("holds neither BYPASSRLS nor SUPERUSER", async () => {
    const r = await asApp(null, async (c) =>
      (
        await c.query<{ bypass: boolean; su: boolean }>(
          "SELECT rolbypassrls AS bypass, rolsuper AS su FROM pg_roles WHERE rolname = current_user",
        )
      ).rows[0]!,
    );
    expect(r.bypass).toBe(false);
    expect(r.su).toBe(false);
  });

  it("cannot create a table, so it cannot create one for itself to own", async () => {
    // The escape route if only ownership were checked: the app role makes its own table,
    // owns it, and reads it without policies. DDL has to be closed for I-5 to hold over time.
    await expect(asApp(null, (c) => c.query("CREATE TABLE rls_escape_hatch (id int)"))).rejects.toThrow();
  });
});

describe("I-6: every tenant-carrying table is ENABLE + FORCE with a real tenant policy", () => {
  it("reports no misconfigured table -- and the table set comes from the catalog", async () => {
    const rows = await audit();
    const bad = rows.filter((r) => r.verdict !== "ok" && !r.verdict.startsWith("exempt-"));
    expect(bad.map((r) => `${r.table_name}: ${r.verdict}`)).toEqual([]);
  });

  it("is not idle: it classifies the tables that actually exist", async () => {
    const rows = await audit();
    const ok = new Set(rows.filter((r) => r.verdict === "ok").map((r) => r.table_name));

    // The tables that must NEVER silently drop out of the audit. A table disappearing --
    // renamed, or dropped and recreated without RLS -- has to fail rather than quietly
    // lower the bar.
    //
    // ⚠ Asserted as a SUBSET, not an exact list. The first version froze the full set, and
    // it broke the moment F03 landed two tables in a parallel branch: a hand-maintained
    // expectation in the very test whose point is that the table set comes from the
    // CATALOG. Every new table is still covered -- by the assertion above, which requires
    // zero misconfigured tables across whatever the catalog holds.
    for (const t of [
      "acl_bindings", "groups", "org_memberships", "organizations",
      "project_memberships", "projects", "rls_probe", "teams",
    ]) {
      expect(ok.has(t), `${t} vanished from the tenant-table audit`).toBe(true);
    }
    // Non-vacuity: an audit returning nothing would satisfy "no misconfigured table".
    expect(ok.size).toBeGreaterThanOrEqual(8);
  });

  it("finds the tenant root through its foreign keys, not by name", async () => {
    const rows = await audit();
    // `organizations` keys off its own `id`; every other table off `org_id`. The audit was
    // never told this -- it followed the FKs. That is what makes the check survive a rename.
    expect(rows.find((r) => r.table_name === "organizations")?.tenant_column).toBe("id");
    expect(rows.find((r) => r.table_name === "acl_bindings")?.tenant_column).toBe("org_id");
  });

  it("every exemption is declared on the table itself", async () => {
    // ⚠ This used to read `toEqual(["_kernel_migrations"])`. That is a COUNT assertion, and it
    // went red when F10 added a second legitimately non-tenant table (`embedding_models`: a
    // model's identity and dimension are the same fact for every organization, and a per-tenant
    // copy is one more place for them to disagree). A properly declared exemption failing its
    // own gate is the shape hard rule 7 warns about -- assert the closed PROPERTY, not the size
    // of the set.
    //
    // The property has not been weakened. What must hold is unchanged and now holds for all of
    // them: an exemption is a sentence a person wrote on the table, in the form the audit reads,
    // and it is never merely the absence of a tenant column.
    const rows = await audit();
    const exempt = rows.filter((r) => r.verdict.startsWith("exempt-") && r.runtime_grants > 0);
    expect(exempt.length, "no exemption at all -- this assertion would be vacuous").toBeGreaterThan(0);
    expect(exempt.map((r) => r.table_name)).toContain("_kernel_migrations");

    for (const r of exempt) {
      expect(r.verdict, `${r.table_name} is granted to the runtime without a declared exemption`)
        .toBe("exempt-declared-no-tenant-data");
      const comment = await asOwner(async (c) =>
        (
          await c.query<{ d: string | null }>(
            "SELECT obj_description($1::regclass, 'pg_class') AS d",
            [r.table_name],
          )
        ).rows[0]!.d,
      );
      // The exemption has to be a sentence someone wrote, not an entry in a script that was
      // edited while trying to make a gate go green.
      expect(comment, `${r.table_name}`).toMatch(/^kernel-no-tenant-data: .+/);
    }
  });
});

describe("counter-proof: the audit actually detects each way of getting it wrong", () => {
  /**
   * Breaks the schema for real, then rolls back.
   *
   * DDL is transactional in PostgreSQL, so the damage is visible to this transaction and
   * to nothing else -- other test files running against the same database never see it.
   * Doing it as a committed change plus cleanup would be a race, and the symptom of losing
   * that race is another file's isolation assertion failing for no reason.
   */
  const withBrokenSchema = async (ddl: string[], table: string): Promise<AuditRow | undefined> =>
    asOwner(async (c) => {
      await c.query("BEGIN");
      try {
        for (const s of ddl) await c.query(s);
        const r = await c.query<AuditRow>("SELECT * FROM kernel_tenant_table_audit() WHERE table_name = $1", [table]);
        return r.rows[0];
      } finally {
        await c.query("ROLLBACK");
      }
    });

  it("a tenant table with no RLS at all -- the case the old gate could not see", async () => {
    const row = await withBrokenSchema(
      ["CREATE TABLE f02_probe_norls (id int, org_id text NOT NULL REFERENCES organizations (id))"],
      "f02_probe_norls",
    );
    expect(row?.tenant_column).toBe("org_id");
    expect(row?.verdict).toBe("RLS_DISABLED");
  });

  it("RLS enabled but not FORCEd -- the owner reads everything", async () => {
    const row = await withBrokenSchema(
      [
        "CREATE TABLE f02_probe_unforced (id int, org_id text NOT NULL REFERENCES organizations (id))",
        "ALTER TABLE f02_probe_unforced ENABLE ROW LEVEL SECURITY",
        "CREATE POLICY p ON f02_probe_unforced USING (org_id = current_setting('app.current_org', true))",
      ],
      "f02_probe_unforced",
    );
    expect(row?.verdict).toBe("RLS_NOT_FORCED");
  });

  it("FORCEd but with no tenant policy", async () => {
    const row = await withBrokenSchema(
      [
        "CREATE TABLE f02_probe_nopolicy (id int, org_id text NOT NULL REFERENCES organizations (id))",
        "ALTER TABLE f02_probe_nopolicy ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE f02_probe_nopolicy FORCE ROW LEVEL SECURITY",
      ],
      "f02_probe_nopolicy",
    );
    expect(row?.verdict).toBe("NO_TENANT_POLICY");
  });

  it("a policy that exists but keys off the wrong thing still counts as no policy", async () => {
    // The nastiest variant: `\d+` shows a policy, the name looks right, and it filters on
    // something that is not the tenant. A check that counted policies would pass this.
    const row = await withBrokenSchema(
      [
        "CREATE TABLE f02_probe_wrongpolicy (id int, org_id text NOT NULL REFERENCES organizations (id))",
        "ALTER TABLE f02_probe_wrongpolicy ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE f02_probe_wrongpolicy FORCE ROW LEVEL SECURITY",
        "CREATE POLICY f02_probe_wrongpolicy_tenant ON f02_probe_wrongpolicy USING (id > 0)",
      ],
      "f02_probe_wrongpolicy",
    );
    expect(row?.verdict).toBe("NO_TENANT_POLICY");
  });

  it("a table with no tenant key that the runtime role can read", async () => {
    const row = await withBrokenSchema(
      ["CREATE TABLE f02_probe_untenanted (id int, body text)", "GRANT SELECT ON f02_probe_untenanted TO app_rw"],
      "f02_probe_untenanted",
    );
    // Nothing to filter on: no policy could make this table tenant-safe.
    expect(row?.tenant_column).toBeNull();
    expect(row?.verdict).toBe("UNTENANTED_BUT_GRANTED");
  });

  it("...but an untenanted table the runtime role CANNOT read is fine (no over-firing)", async () => {
    const row = await withBrokenSchema(["CREATE TABLE f02_probe_private (id int, body text)"], "f02_probe_private");
    expect(row?.verdict).toBe("exempt-no-tenant-data");
  });
});
