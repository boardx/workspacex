/**
 * E3 —— `first_value_facts` 真 PostgreSQL（app_rw 身份）：
 *   · 先写者胜：同组织同步第二次写入不改 occurred_at；
 *   · RLS：另一租户读不到；
 *   · 上报函数排除 personal-local、只回序号不回 org_id（先证明有行，空集不算绿）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { PgFirstValueFacts } from "../../src/infrastructure/first-value/pg-first-value-facts";
import { PgTelemetryFacts } from "../../src/infrastructure/telemetry/pg-telemetry-facts";
import type { OrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const STD = "org-fv-std";
const LOCAL = "org-fv-local";
const session = (c: { query: (sql: string, params?: unknown[]) => Promise<unknown> }): TenantSession =>
  ({ query: (sql: string, params?: unknown[]) => c.query(sql, params) }) as unknown as TenantSession;
const db = {
  withTenant: (orgId: string, fn: (s: TenantSession) => Promise<unknown>) => asApp(orgId, (c) => fn(session(c))),
  withoutTenant: (fn: (s: TenantSession) => Promise<unknown>) => asApp(null, (c) => fn(session(c))),
  close: async () => undefined,
} as unknown as DatabasePort;
const store = new PgFirstValueFacts(db);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(STD, LOCAL);
  await seedOrg({ orgId: STD, projectId: "p-fv-std" });
  await seedOrg({ orgId: LOCAL, kind: "personal-local", projectId: "p-fv-local" });
});
afterAll(async () => {
  await resetOrgs(STD, LOCAL);
});

describe("first_value_facts", () => {
  it("先写者胜", async () => {
    await store.recordFirst(STD as OrgId, "first_sign_in", new Date("2026-09-24T00:00:00.000Z"));
    await store.recordFirst(STD as OrgId, "first_sign_in", new Date("2026-09-24T01:00:00.000Z"));
    const rows = await store.listForOrg(STD as OrgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurredAt.toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("RLS：别的租户读不到", async () => {
    const n = await asApp(LOCAL, async (c) => (await c.query("SELECT count(*)::int AS n FROM first_value_facts WHERE org_id = $1", [STD])).rows[0].n);
    expect(n).toBe(0);
  });

  it("上报函数：personal-local 排除，不回 org_id", async () => {
    await store.recordFirst(LOCAL as OrgId, "first_sign_in", new Date("2026-09-24T00:00:00.000Z"));
    const { facts } = await new PgTelemetryFacts(db).firstValueFacts();
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.orgKind === "standard")).toBe(true);
    expect(facts.some((f) => f.orgId === STD || f.orgId === LOCAL)).toBe(false);
  });
});
