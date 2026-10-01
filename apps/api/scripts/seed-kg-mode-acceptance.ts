// @global-scope-fixture table:credentials: isolated acceptance DB; only the three mode accounts below are replaced.
import { createHash } from "node:crypto";
import { MODE_EVAL } from "../../web/e2e/kg-mode-acceptance.fixture";
import { KG_EVAL } from "../../web/e2e/kg-experience-eval/fixture";
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../tests/support/db";
import { enableExtraction, assertExtractionActive } from "../tests/knowledge-graph/kg-extraction-fixtures";

if (process.env.KG_EVAL_FIXTURE !== "1" || !process.env.PGDATABASE?.startsWith("wsx_kg_")) {
  throw new Error("mode acceptance seeding requires KG_EVAL_FIXTURE=1 and an independently owned wsx_kg_ database");
}
ensureDatabase();
await migrateOnce();
await resetOrgs(MODE_EVAL.cloudOrgId, MODE_EVAL.localOrgId);
const a = MODE_EVAL.account;
for (const account of [a, MODE_EVAL.member, MODE_EVAL.outsider]) {
  const passwordHash = await new BcryptPasswordHasher().hash(account.password);
  await asOwner(async (c) => {
    await c.query("DELETE FROM credentials WHERE user_id=$1 OR email=$2", [account.userId, account.email]);
    await c.query("INSERT INTO credentials(user_id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())", [account.userId, account.email, account.name, passwordHash]);
  });
}
for (const [orgId, local] of [[MODE_EVAL.cloudOrgId, false], [MODE_EVAL.localOrgId, true]] as const) {
  await seedOrg({ orgId, projectId: `${orgId}-project`, ...(local ? { kind: "personal-local", ownerUserId: a.userId } : {}) });
  await addOrgMember(orgId, a.userId, "lead", null);
  await addProjectMember(orgId, `${orgId}-project`, a.userId, "facilitator", null, true);
  if (!local) {
    await addOrgMember(orgId, MODE_EVAL.member.userId, "consultant", null);
    await addProjectMember(orgId, `${orgId}-project`, MODE_EVAL.member.userId, "member", null);
    await addOrgMember(orgId, MODE_EVAL.outsider.userId, "consultant", null);
  }
  await enableExtraction(orgId);
  await assertExtractionActive(orgId);
  const id = `${orgId}-agent`;
  const version = `${id}-v1`;
  const instructions = "你是用户的工作助手。只依据本组织内对话与记忆回答，不使用其他组织的知识。";
  const digest = createHash("sha256").update(instructions).digest("hex");
  await asApp(orgId, async (c) => {
    await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,$1,'工作助手','enabled',$3,now(),now())", [id,orgId,a.userId]);
    await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'1.0.0',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())", [version,orgId,id,digest,instructions,KG_EVAL.modelProvider,KG_EVAL.modelId,a.userId]);
    await c.query("UPDATE agents SET published_version_id=$1 WHERE org_id=$2 AND id=$3", [version,orgId,id]);
    await c.query("INSERT INTO capability_listings(id,org_id,kind,name,scope,enabled,abbr,duty) VALUES($1,$2,'agent','工作助手','org-wide',true,'助','日常工作助手')", [id,orgId]);
  });
}
console.log("[seed-kg-mode-acceptance] cloud organization and personal-local organization seeded; no memories preloaded");
