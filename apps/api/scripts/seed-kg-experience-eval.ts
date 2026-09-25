/**
 * phase-18 F15 记忆体验评测集（`apps/web/e2e/kg-experience-eval/`）的种子：一个组织、四个账号、一个可运行的 Agent。
 *
 * **只种前置条件，不种被评测的东西**：一条记忆都不预置——记忆全部由评测用例在真浏览器里聊出来，
 * 经真实的抽取 worker（`KG_EXTRACTION_ENABLED=1`）→ 执行器 → AGE 投影形成。预置记忆等于把 E1「零负担」
 * 与 E2「记得住」的结论写进种子。
 *
 * Agent 取产品默认 Agent 的名字（`agentDefaults.DEFAULT_AGENT_NAME`）且是组织里唯一的一个：新用户打开对话
 * 不用挑 Agent（E1「不做任何设置」）。它的 provider 由 playwright config 下发，与 API 的
 * `KERNEL_MODEL_PROVIDER` 全等（`configured-model-provider.ts` 的既有纪律：不等就诚实失败，不存在静默兜底）。
 *
 * 每次跑都从空库状态开始：先删掉这个组织（级联）与这四个账号的凭据，再重建。
 */
import { agentDefaults } from "@repo/contracts";
import { createHash } from "node:crypto";
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../tests/support/db";

if (process.env.KG_EVAL_FIXTURE !== "1") throw new Error("KG_EVAL_FIXTURE=1 is required");
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const orgId = required("KG_EVAL_ORG_ID");
const projectId = required("KG_EVAL_PROJECT_ID");
const accounts = JSON.parse(required("KG_EVAL_ACCOUNTS")) as ReadonlyArray<{
  userId: string; email: string; password: string; name: string;
}>;
const agentId = required("KG_EVAL_AGENT_ID");
const provider = required("KG_EVAL_MODEL_PROVIDER");
const modelId = required("KG_EVAL_MODEL_ID");

ensureDatabase();
await migrateOnce();
await resetOrgs(orgId);
// 组织的 AGE 图不随组织行级联删除：上一次评测留下的节点会让这一次的图路变慢、变脏。一起清掉（投影 worker 会按需重建）。
await asOwner(async (c) => {
  await c.query(`DO $$ DECLARE g text := public.kg_org_graph_name('${orgId.replace(/'/g, "''")}'); BEGIN
    IF EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = g) THEN PERFORM ag_catalog.drop_graph(g, true); END IF; END $$`);
});
await asOwner(async (c) => {
  await c.query("DELETE FROM credentials WHERE user_id = ANY($1::text[]) OR email = ANY($2::text[])", [
    accounts.map((a) => a.userId), accounts.map((a) => a.email),
  ]);
});
await seedOrg({ orgId, projectId, teamNames: ["kg-eval"], groupNames: ["g"] });
for (const a of accounts) await addOrgMember(orgId, a.userId, "consultant", null);

const hasher = new BcryptPasswordHasher();
for (const a of accounts) {
  const hash = await hasher.hash(a.password);
  await asOwner((c) => c.query(
    `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at) VALUES ($1,$2,$3,$4,now())`,
    [a.userId, a.email, a.name, hash],
  ));
}

{
  const versionId = `${agentId}-v1`;
  const instructions = "你是用户的工作助手。回答时只依据对话和记忆里真实出现过的内容。";
  const digest = createHash("sha256").update(instructions).digest("hex");
  const creator = accounts[0]!.userId;
  await asApp(orgId, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$1,$3,'enabled',$4,now(),now())`,
      [agentId, orgId, agentDefaults.DEFAULT_AGENT_NAME, creator],
    );
    await c.query(
      `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
         skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'1.0.0',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())`,
      [versionId, orgId, agentId, digest, instructions, provider, modelId, creator],
    );
    await c.query("UPDATE agents SET published_version_id = $1 WHERE id = $2 AND org_id = $3", [versionId, agentId, orgId]);
    await c.query(
      `INSERT INTO capability_listings (id,org_id,kind,name,scope,enabled,abbr,duty)
       VALUES ($1,$2,'agent',$3,'org-wide',true,'助','日常工作助手')`,
      [agentId, orgId, agentDefaults.DEFAULT_AGENT_NAME],
    );
  });
}

process.stdout.write(`[seed-kg-experience-eval] org ${orgId}: ${accounts.length} accounts, agent ${agentId}\n`);
