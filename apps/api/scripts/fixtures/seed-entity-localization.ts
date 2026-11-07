import { randomUUID, randomBytes } from "node:crypto";
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { seedOrg, resetOrgs, addOrgMember, asOwner, asApp } from "../../tests/support/db";
import { instanceTelemetry as T } from "@repo/contracts";
import { instanceIdFromSecret } from "../../src/application/telemetry/run-telemetry-cycle";
/** Scoped identity and pre-existing profile authorization prerequisites.
 * Packages, translations and publication are created by real browser/API flows,
 * never pre-filled as expected outcomes. The profile grant is an existing row to
 * revoke, not evidence that HITL approval creation was exercised. */
export async function seedEntityLocalizationFixture(env: NodeJS.ProcessEnv = process.env) {
  if (env.FULLSTACK_E2E_FIXTURE !== "1") throw new Error("FULLSTACK_E2E_FIXTURE=1 is required");
  await seedTelemetryHistoryFixture(env);
  await seedPlatformMembersFixture(env);
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

async function seedTelemetryHistoryFixture(env: NodeJS.ProcessEnv) {
  const raw = env.FULLSTACK_ENTITY_LOCALIZATION_TELEMETRY_HISTORY;
  if (raw === undefined) return; // Legacy callers do not touch instance state.
  // Full strict contract validation precedes every SQL statement owned here.
  const history = T.operations.getLastTelemetryReport.out.parse(JSON.parse(raw));
  if (!history.last?.report) throw new Error("Telemetry history fixture requires a past report");
  const last = history.last;
  const defaults = T.TELEMETRY_CONSENT_DEFAULTS;
  await asOwner(async c => {
    await c.query(`INSERT INTO instance_telemetry_state
      (singleton, install_secret, consent_health, consent_usage, consent_diagnostics, consent_benchmark)
      VALUES(true,$1,$2,$3,$4,$5) ON CONFLICT(singleton) DO NOTHING`,
    [randomBytes(32).toString("hex"), defaults.health, defaults.usage, defaults.diagnostics, defaults.benchmark]);
    const state = await c.query<{ install_secret: string }>("SELECT install_secret FROM instance_telemetry_state WHERE singleton");
    const secret = state.rows[0]?.install_secret;
    if (!secret) throw new Error("Telemetry fixture singleton missing");
    const report = T.InstanceTelemetryReport.parse({ ...last.report, instanceId: instanceIdFromSecret(secret) });
    await c.query(`UPDATE instance_telemetry_state SET
      consent_health=$1, consent_usage=$2, consent_diagnostics=$3, consent_benchmark=$4,
      last_attempted_at=$5, last_outcome=$6, last_omitted=$7::jsonb, last_report=$8::jsonb,
      updated_at=now() WHERE singleton`,
    [defaults.health, defaults.usage, defaults.diagnostics, defaults.benchmark,
      last.attemptedAt, last.outcome, JSON.stringify(last.omittedForLackOfData), JSON.stringify(report)]);
  });
}

/** Initial identities and two normal organizations only. Runtime UI/API writes
 * must produce every role change and platform administrator grant/revoke. */
async function seedPlatformMembersFixture(env: NodeJS.ProcessEnv) {
  const prefix = "FULLSTACK_ENTITY_LOCALIZATION_PLATFORM_";
  // Legacy fixture callers remain valid; partial new wiring fails before SQL.
  if (!Object.keys(env).some(key => key.startsWith(prefix))) return;
  const required = (key: string) => {
    const value = env[prefix + key];
    if (!value) throw new Error(`Missing platform members fixture ${key}`);
    return value;
  };
  const accounts = [
    { id: required("SUPERUSER_ID"), email: required("SUPERUSER_EMAIL"), name: required("SUPERUSER_NAME"), password: required("SUPERUSER_PASSWORD"), role: "admin" },
    { id: required("TARGET_ID"), email: required("TARGET_EMAIL"), name: required("TARGET_NAME"), password: required("TARGET_PASSWORD"), role: "consultant" },
  ];
  const orgs = [
    { id: required("ORG_A_ID"), name: required("ORG_A_NAME"), projectId: required("PROJECT_A_ID") },
    { id: required("ORG_B_ID"), name: required("ORG_B_NAME"), projectId: required("PROJECT_B_ID") },
  ];
  await resetOrgs(orgs.map(org => org.id));
  // An interrupted prior UI grant may reference either private actor through
  // platform_admins.user_id/granted_by (both credential FKs have no cascade).
  // Reset only those prior fixture effects; this run must grant/revoke via UI.
  await asOwner(c => c.query("DELETE FROM platform_admins WHERE user_id=ANY($1::text[]) OR granted_by=ANY($1::text[])", [accounts.map(account => account.id)]));
  await asOwner(c => c.query("DELETE FROM credentials WHERE user_id=ANY($1::text[]) OR email=ANY($2::text[])", [accounts.map(account => account.id), accounts.map(account => account.email)]));
  const hasher = new BcryptPasswordHasher();
  for (const account of accounts) {
    const hash = await hasher.hash(account.password);
    await asOwner(c => c.query("INSERT INTO credentials(user_id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())", [account.id, account.email, account.name, hash]));
  }
  for (const org of orgs) {
    await seedOrg({ orgId: org.id, projectId: org.projectId, kind: "organization", teamNames: [], groupNames: [] });
    await asApp(org.id, c => c.query("UPDATE organizations SET name=$2 WHERE id=$1", [org.id, org.name]));
    for (const account of accounts) await addOrgMember(org.id, account.id, account.role, null);
  }
}
