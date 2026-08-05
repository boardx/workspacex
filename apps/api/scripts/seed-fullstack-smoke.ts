/** Controlled PG fixture for #387's login -> projects -> overview -> Files browser gate. */
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import {
  addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../tests/support/db";
import { addBrowserArtifact } from "../tests/support/files-db";

if (process.env.FULLSTACK_E2E_FIXTURE !== "1") throw new Error("FULLSTACK_E2E_FIXTURE=1 is required");
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const email = required("FULLSTACK_E2E_EMAIL");
const password = required("FULLSTACK_E2E_PASSWORD");
const orgId = required("FULLSTACK_E2E_ORG_ID");
const userId = required("FULLSTACK_E2E_USER_ID");
const projectId = required("FULLSTACK_E2E_PROJECT_ID");
const projectName = required("FULLSTACK_E2E_PROJECT_NAME");
const artifactId = required("FULLSTACK_E2E_ARTIFACT_ID");
const sentinelFile = required("FULLSTACK_E2E_SENTINEL_FILE");
/** #458: the org ADMIN, a second account -- see the fixture for why it is not the same one. */
const adminEmail = required("FULLSTACK_E2E_ADMIN_EMAIL");
const adminPassword = required("FULLSTACK_E2E_ADMIN_PASSWORD");
const adminUserId = required("FULLSTACK_E2E_ADMIN_USER_ID");
/** #458: a non-admin of its own, so no account is shared across parallel spec files. */
const memberEmail = required("FULLSTACK_E2E_MEMBER_EMAIL");
const memberPassword = required("FULLSTACK_E2E_MEMBER_PASSWORD");
const memberUserId = required("FULLSTACK_E2E_MEMBER_USER_ID");
/** #435: the one agent core-loop step 8b actually RUNS. See the fixture for the two-worlds note. */
const agentId = required("FULLSTACK_E2E_AGENT_ID");
const agentDisplayName = required("FULLSTACK_E2E_AGENT_NAME");
const agentModelProvider = required("FULLSTACK_E2E_AGENT_MODEL_PROVIDER");
const agentModelId = required("FULLSTACK_E2E_AGENT_MODEL_ID");

ensureDatabase();
await migrateOnce();
await resetOrgs(orgId);
await asOwner(async (client) => {
  await client.query(
    "DELETE FROM credentials WHERE user_id = ANY($1::text[]) OR email = ANY($2::text[])",
    [[userId, adminUserId, memberUserId], [email, adminEmail, memberEmail]],
  );
});
const fixture = await seedOrg({ orgId, projectId, teamNames: ["fullstack"], groupNames: ["gate"] });
await asApp(orgId, (client) => client.query(
  "UPDATE projects SET name = $1 WHERE id = $2 AND org_id = $3",
  [projectName, projectId, orgId],
));
await addOrgMember(orgId, userId, "consultant", fixture.teams.fullstack ?? null);
await addProjectMember(orgId, projectId, userId, "facilitator", null, true);

await addOrgMember(orgId, adminUserId, "admin", null);
await addOrgMember(orgId, memberUserId, "consultant", fixture.teams.fullstack ?? null);

const hasher = new BcryptPasswordHasher();
const passwordHash = await hasher.hash(password);
const adminPasswordHash = await hasher.hash(adminPassword);
const memberPasswordHash = await hasher.hash(memberPassword);
await asOwner(async (client) => {
  await client.query(
    `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
     VALUES ($1,$2,$3,$4,now()), ($5,$6,$7,$8,now()), ($9,$10,$11,$12,now())`,
    [
      userId, email, "Fullstack E2E", passwordHash,
      adminUserId, adminEmail, "Fullstack E2E admin", adminPasswordHash,
      memberUserId, memberEmail, "Fullstack E2E member", memberPasswordHash,
    ],
  );
});

/**
 * #435 —— 核心闭环第 8b 步要用的**可运行 Agent**。
 *
 * ## 为什么必须写两组表
 *
 * 「能被 chat 跑起来」与「在编制面板里看得见」在本仓是两张**互不 JOIN** 的网：
 *
 *   · `agents` + `agent_versions` —— `PgPublishedAgentReader.resolvePublished`
 *     （`src/infrastructure/chat/pg-chat-message-command-repository.ts:159-190`）
 *     只读这两张，条件是 `agents.status='enabled'`、`published_version_id` 指向
 *     一条 `published_at IS NOT NULL` 的版本。缺了它 →
 *     `POST /chat/threads/:id/messages` 返回 422 `AGENT_NOT_FOUND`。
 *   · `org_agents` —— 编制面板（`src/infrastructure/chat/pg-chat-repository.ts:343-361`）
 *     与 `updateAgentRoster` 的作用域检查（同文件 :396-402）读它。缺了它 →
 *     用例连把 agent 挂进线程编制都做不到，下拉框恒为「没有可选 Agent」。
 *
 * 线程级的 `chat_thread_agents` **刻意不种**：8b 的线程是用例现场新建的，
 * 由用例自己走 `chat-roster-add-*` 挂载。那一步顺带证明了编制写路径是活的。
 *
 * ## 与 `capability_listings` 的区别（别再搞混第三张网）
 *
 * `/admin/agent` 界面写的是 `capability_listings`，那是**目录**。它既不让 agent
 * 能跑，也不让它出现在编制面板里。下面**没有**写 capability_listings，
 * 理由与本文件末尾 #458 那段一致：预置它会让「新建真的生效了吗」那条断言空转。
 *
 * ## model_provider 为什么必须是外部传进来的
 *
 * 它被**钉进 run 快照**，执行时与 `KERNEL_MODEL_PROVIDER` 做全等比较，不等就
 * `MODEL_PROVIDER_NOT_CONFIGURED`（`src/infrastructure/agent-run/configured-model-provider.ts:66-73`）。
 * 唯一事实源在 `apps/web/e2e/fullstack-smoke-fixture.ts`，由 playwright config
 * 同时下发给本脚本和 API 进程。这里写死字面量 = 把同一事实抄第二份。
 */
{
  const agentVersionId = `${agentId}-v1`;
  const instructions = "You are the core-loop smoke agent. Echo back what you are given.";
  const { createHash } = await import("node:crypto");
  const instructionDigest = createHash("sha256").update(instructions).digest("hex");
  await asApp(orgId, async (client) => {
    await client.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$1,$3,'enabled',$4,now(),now())
       ON CONFLICT (id) DO NOTHING`,
      [agentId, orgId, agentDisplayName, adminUserId],
    );
    await client.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
          skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'1.0.0',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())
       ON CONFLICT (id) DO NOTHING`,
      [agentVersionId, orgId, agentId, instructionDigest, instructions,
        agentModelProvider, agentModelId, adminUserId],
    );
    await client.query(
      "UPDATE agents SET published_version_id = $1 WHERE id = $2 AND org_id = $3",
      [agentVersionId, agentId, orgId],
    );
    // 编制面板的可见性来源。`abbr`/`duty` 非空即可，面板只把它们显示出来。
    await client.query(
      `INSERT INTO org_agents (org_id,agent_id,abbr,name,duty)
       VALUES ($1,$2,'CL',$3,'core-loop smoke')
       ON CONFLICT (org_id,agent_id) DO NOTHING`,
      [orgId, agentId, agentDisplayName],
    );
  });
}

// ⚠ 刻意**没有**预置任何 capability_listings 行。#458 的浏览器门控要证的正是
// 「界面新建出来的那一条真的落进了 PostgreSQL」——先塞一条进去，
// 那条断言就会在「新建根本没生效」时照样绿。
await addBrowserArtifact({
  orgId, id: artifactId, projectId, source: "upload", title: sentinelFile,
  ingestionStatus: "READY", creator: { kind: "user", id: userId },
  text: `unique sentinel ${sentinelFile}`, sizeBytes: 387, mime: "text/markdown",
});

process.stdout.write(`[fullstack-fixture] db=${required("WORKSPACEX_DB")} project=${projectId} sentinel=${sentinelFile}\n`);
