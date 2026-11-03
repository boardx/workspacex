import { randomUUID } from "node:crypto";
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { seedOrg, resetOrgs, addOrgMember, asOwner, asApp } from "../../tests/support/db";
/** Scoped identity and pre-existing profile authorization prerequisites.
 * Packages, translations and publication are created by real browser/API flows,
 * never pre-filled as expected outcomes. The profile grant is an existing row to
 * revoke, not evidence that HITL approval creation was exercised. */
export async function seedEntityLocalizationFixture(env: NodeJS.ProcessEnv = process.env) {
  if (env.FULLSTACK_E2E_FIXTURE !== "1") throw new Error("FULLSTACK_E2E_FIXTURE=1 is required");
  if (!env.FULLSTACK_ENTITY_LOCALIZATION_ORG_ID) return;
  const required = (key: string) => { const value = env[`FULLSTACK_ENTITY_LOCALIZATION_${key}`]; if (!value) throw new Error(`Missing entity localization fixture ${key}`); return value; };
  const orgId = required("ORG_ID"), projectId = required("PROJECT_ID");
  const accounts = [
    { id: required("ADMIN_USER_ID"),email: required("ADMIN_EMAIL"),password: required("ADMIN_PASSWORD"),role: "admin" as const },
    { id: required("MEMBER_USER_ID"),email: required("MEMBER_EMAIL"),password: required("MEMBER_PASSWORD"),role: "consultant" as const },
  ];
  await resetOrgs(orgId);
  await asOwner(c => c.query("DELETE FROM credentials WHERE user_id=ANY($1::text[]) OR email=ANY($2::text[])",[accounts.map(a => a.id),accounts.map(a => a.email)]));
  const fixture = await seedOrg({ orgId,projectId,teamNames: ["localization"],groupNames: ["gate"] });
  await asApp(orgId,c => c.query("UPDATE organizations SET name='Localization acceptance' WHERE id=$1",[orgId]));
  const hasher = new BcryptPasswordHasher();
  for (const account of accounts) {
    await addOrgMember(orgId,account.id,account.role,account.role === "admin" ? null : fixture.teams.localization!);
    const hash = await hasher.hash(account.password);
    await asOwner(c => c.query("INSERT INTO credentials(user_id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())",
      [account.id,account.email,`Localization ${account.role}`,hash]));
  }
  // Private tenant prerequisite only; the browser must remove this through the
  // actual admin DELETE path. No tool execution or translated outcome is seeded.
  await asApp(orgId, c => c.query(
    "INSERT INTO tool_permission_grants (id,org_id,scope,run_id,tool_name,granted_by_user_id,granted_at) VALUES($1,$2,'forever',NULL,$3,$4,now())",
    [randomUUID(), orgId, "历史工具原文 {tool}", accounts[0]!.id],
  ));
  // Historical receipt prerequisites for the administration locale journey.
  // These are read through real summary/ledger APIs; they do not prove model
  // execution, quota edits, rule creation or settlement by the browser.
  const receipts = [
    { model: "计量模型原文 {model}", total: 1000, input: 800, output: 200, source: "reported", cost: "1234567", currency: "CNY", unit: null, quantity: null, nativeSource: null },
    { model: "price-usd-raw", total: 5, input: 3, output: 2, source: "reported", cost: "1", currency: "USD", unit: null, quantity: null, nativeSource: null },
    { model: "native-audio-raw", total: 0, input: null, output: null, source: "not-applicable", cost: null, currency: null, unit: "millisecond", quantity: "2000", nativeSource: "estimated" },
    { model: "unreported-raw", total: 0, input: null, output: null, source: "unknown", cost: null, currency: null, unit: null, quantity: null, nativeSource: null },
  ];
  await asApp(orgId, async c => {
    for (const [index, receipt] of receipts.entries()) {
      await c.query(`INSERT INTO token_usage_events
        (id,org_id,user_id,project_id,model_provider,model_id,tokens_total,tokens_prompt,tokens_completion,total_source,outcome,occurred_at,cost_micros,currency,price_version,native_unit,native_quantity,native_source)
        VALUES($1,$2,$3,$4,'locale-fixture',$5,$6,$7,$8,$9,'succeeded',now()-($10::int * interval '1 second'),$11,$12,$13,$14,$15,$16)`,
      [randomUUID(), orgId, accounts[1]!.id, projectId, receipt.model, receipt.total, receipt.input, receipt.output, receipt.source, index + 1, receipt.cost, receipt.currency, receipt.cost === null ? null : "locale-fixture-v1", receipt.unit, receipt.quantity, receipt.nativeSource]);
    }
  });
}
