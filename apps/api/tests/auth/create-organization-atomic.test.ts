// @global-scope-fixture table:credentials: only org-create-5494-* users; removed in afterAll.
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgOrganizationCreationRepository, organizationCreationId } from "../../src/infrastructure/auth/pg-organization-creation-repository";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { asOwner, migrateOnce, ensureDatabase } from "../support/db";
const userId = `org-create-5494-${randomUUID()}`;
const orgs: string[] = [];
let db: PgDatabase;
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig());
  await asOwner(c => c.query("INSERT INTO credentials (user_id,email,display_name,password_hash,email_verified_at) VALUES ($1,$2,'Creator',$3,now())", [userId, `${userId}@org-create.test`, "$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZabcde"]));
});
afterAll(async () => {
  await asOwner(async c => {
    await c.query("DELETE FROM organizations WHERE id=ANY($1::text[])", [orgs]);
    await c.query("DELETE FROM credentials WHERE user_id=$1", [userId]);
  });
  await db?.close();
});
function input() {
  const value = { userId, orgName: "Atomic organization", requestId: randomUUID() };
  orgs.push(organizationCreationId(value.userId, value.requestId)); return value;
}
describe("real PostgreSQL organization creation", () => {
  it("concurrent retries create one organization, one owner and three standard agents; no account or tenant data copied", async () => {
    const value = input(); const repo = new PgOrganizationCreationRepository(db);
    const results = await Promise.all(Array.from({ length: 4 }, () => repo.create(value)));
    expect(new Set(results.map(r => r.orgId)).size).toBe(1);
    await asOwner(async c => {
      const org = results[0]!.orgId;
      expect((await c.query("SELECT id FROM organizations WHERE id=$1", [org])).rowCount).toBe(1);
      expect((await c.query("SELECT user_id,org_role,team_id FROM org_memberships WHERE org_id=$1", [org])).rows).toEqual([{ user_id: userId, org_role: "admin", team_id: null }]);
      expect((await c.query("SELECT id FROM agents WHERE org_id=$1", [org])).rowCount).toBe(3);
      expect((await c.query("SELECT user_id FROM credentials WHERE user_id=$1", [userId])).rowCount).toBe(1);
      for (const table of ["projects", "organization_plans", "organization_core_models", "org_token_budget"]) {
        expect((await c.query(`SELECT * FROM ${table} WHERE org_id=$1`, [org])).rowCount).toBe(0);
      }
    });
    const other = input();
    await db.withTenant(organizationCreationId(other.userId, other.requestId), async s => {
      expect((await s.query("SELECT * FROM organization_creation_requests")).rows).toHaveLength(0);
    });
    await expect(repo.create({ ...value, orgName: "different" })).rejects.toThrow();
  });
  it("agent initialization failure rolls back all writes; identical request succeeds on retry", async () => {
    const value = input();
    const failing: DatabasePort = {
      withTenant: (org, fn) => db.withTenant(org, s => fn({ query: async (sql, params) => {
        if (sql.includes("INSERT INTO agent_versions")) throw new Error("injected agent failure");
        return s.query(sql, params);
      } })),
      withoutTenant: fn => db.withoutTenant(fn), close: async () => {},
    };
    await expect(new PgOrganizationCreationRepository(failing).create(value)).rejects.toThrow("injected agent failure");
    await asOwner(async c => {
      expect((await c.query("SELECT id FROM organizations WHERE id=$1", [organizationCreationId(value.userId, value.requestId)])).rowCount).toBe(0);
    });
    await expect(new PgOrganizationCreationRepository(db).create(value)).resolves.toMatchObject({ orgName: value.orgName });
  });
});
