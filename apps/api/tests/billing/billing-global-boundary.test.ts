import { describe, expect, it } from "vitest";
import { assertBillingGlobalStatement, BILLING_GLOBAL_SQL } from "../../src/infrastructure/billing/billing-global-boundary";
describe("verified receipt SQL boundary", () => {
  it("admits only the single-source immutable billing statements", () => {
    for (const sql of Object.values(BILLING_GLOBAL_SQL)) expect(() => assertBillingGlobalStatement(sql)).not.toThrow();
    expect(Object.isFrozen(BILLING_GLOBAL_SQL)).toBe(true);
  });
  it.each([
    "SELECT * FROM billing_orders, organizations",
    "SELECT * FROM public.organizations",
    "SELECT pg_read_file('/etc/passwd') FROM billing_orders",
    "SELECT query_to_xml('SELECT * FROM organizations',true,false,'') FROM billing_orders",
    "WITH x AS (DELETE FROM organizations RETURNING *) SELECT * FROM x",
    "SELECT * FROM billing_orders; DELETE FROM organizations",
    "COPY billing_orders TO PROGRAM 'anything'",
    "UPDATE org_billing_settings SET credit_enabled=true",
  ])("rejects statements outside the registered billing boundary: %s", sql => {
    expect(() => assertBillingGlobalStatement(sql)).toThrow("billing_global_sql_outside_boundary");
  });
});
