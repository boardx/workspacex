import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { probeLegacyProjectSql } from "../src/cn-project-compatibility-probe";

/** Local real PostgreSQL engine, partial schema fixture. Not a restored RDS or
 * an old-binary runtime proof; no freeze/archive behavior acceptance is claimed. */
describe("legacy project SQL versus exact W1 migration", () => {
  it("executes old reads/writes before W1 and proves they break after unchanged W1", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE app_rw;
        CREATE TABLE organizations(id text PRIMARY KEY);
        CREATE TABLE projects(id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),name text NOT NULL);
        CREATE FUNCTION kernel_apply_org_freeze_policies() RETURNS void LANGUAGE sql AS 'SELECT';
        CREATE FUNCTION kernel_apply_project_archive_policies() RETURNS void LANGUAGE sql AS 'SELECT';
      `);
      const migrations = new URL("../../../apps/api/migrations/", import.meta.url);
      await db.exec(readFileSync(new URL("0018-f116-project-supertype-subtypes.sql", migrations), "utf8"));
      for (const [table, parent] of [["research_project_members", "research_projects"], ["user_insight_members", "user_insights"]]) {
        await db.exec(`ALTER TABLE ${parent} ADD CONSTRAINT ${parent}_id_org_uniq UNIQUE(id,org_id);
          CREATE TABLE ${table}(user_id text NOT NULL,project_id text NOT NULL,org_id text NOT NULL,
            role text NOT NULL CHECK(role IN ('owner','collaborator')),PRIMARY KEY(user_id,project_id),
            FOREIGN KEY(project_id,org_id) REFERENCES ${parent}(id,org_id));`);
      }
      await db.query("INSERT INTO organizations(id) VALUES($1)", ["fixture-org"]);
      const before = await probeLegacyProjectSql(db, "fixture-org", "fixture-before");
      expect(before.allReads).toBe(true);
      expect(before.allWrites).toBe(true);
      expect(before.rollbackConfirmed).toBe(true);
      expect((await db.query("SELECT count(*)::int n FROM projects")).rows).toEqual([{ n: 0 }]);
      await db.exec("BEGIN");
      await db.exec(readFileSync(new URL("20260929050000_pw_w1_general_project_kind.sql", migrations), "utf8"));
      await db.exec("COMMIT");
      const after = await probeLegacyProjectSql(db, "fixture-org", "fixture-after");
      expect(after.reads).toEqual({ research_project: false, user_insight: false });
      expect(after.writes).toEqual({ research_project: false, user_insight: false });
      expect(after.readFailures).toEqual({ research_project: "42P01", user_insight: "42P01" });
      expect(after.writeFailures).toEqual({ research_project: "23514", user_insight: "23514" });
      expect(after.scope).toBe("isolated-sql-contract");
      await db.query("INSERT INTO projects(id,org_id,name,status,kind) VALUES($1,$2,$3,'active','general')", ["candidate-project", "fixture-org", "fixture"]);
      await db.query("INSERT INTO general_projects(id,org_id) VALUES($1,$2)", ["candidate-project", "fixture-org"]);
      await db.query("INSERT INTO general_project_members(user_id,project_id,org_id,role) VALUES($1,$2,$3,'owner')", ["candidate-user", "candidate-project", "fixture-org"]);
      expect((await db.query("SELECT id FROM general_projects")).rows).toEqual([{ id: "candidate-project" }]);
      expect((await db.query("SELECT user_id FROM general_project_members")).rows).toEqual([{ user_id: "candidate-user" }]);
    } finally { await db.close(); }
  }, 30_000);
});
