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
}
