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
/** #467: the one **enabled** Skill core-loop step 8a mounts. See the fixture for why it is seeded. */
const mountableSkillId = required("FULLSTACK_E2E_MOUNTABLE_SKILL_ID");
const mountableSkillName = required("FULLSTACK_E2E_MOUNTABLE_SKILL_NAME");

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

/**
 * #467 —— 第 8a 步要挂载的那个 **已启用** Skill。
 *
 * ⚠ 种的是**前置条件**（本组织有一个可挂载的 skill），与上面 #435 种 `agents` /
 *   `org_agents` 完全同型。挂载与卸载这两个动作由用例现场做：`thread_skill_mounts`
 *   **一行都不种**，所以「挂载没生效」时第 8a 步照样红。
 *
 * ⚠ 为什么不能让用例自己建：`skill.controller.ts` 逐字没有启用路由
 *   （`SKILLS_FORBIDDEN_ROUTES` 禁 `POST /skills/:id/enable`），而 `草稿 → 已启用`
 *   只能由 `reviewSkillVersion` 产生，那条用例**今天没有 HTTP 边界**。
 *   ⇒ 目前不存在任何产品路径能造出一个「已启用」的 skill。这是已上报的真实缺口。
 *
 * ⚠ `current_version_id` **必须**指向下面那条版本行：`mountSkillToThread` 把它钉进
 *   `ThreadSkillMount.versionId`，而 controller 对 `currentVersionId === null` 折成
 *   `SKILL_NOT_FOUND`（挂上去就说不出「当时挂的是哪一版」）。
 *
 * ⚠ **`team-only` 归 `fullstack` 团队，不是 `org-wide`**，而这不是随手选的：
 *   `skill-create-smoke.spec.ts:94` 逐字断言管理员打开目录时 `skill-catalog-empty`
 *   可见（「种子没有预置声明式契约 skill，界面不生成示例」）——那是一条**反空转**
 *   断言，不许为了让本条种子进去而放宽它。管理员是 `addOrgMember(…, "admin", null)`，
 *   **不属于任何团队**，而 `decide()`（`domain/identity/permission-decision.ts:98`）
 *   对 `team-only` 要求 `org.teamId === scope.ownerTeamId`，且**管理员不是超级用户**
 *   （同文件 `ADMIN_NOT_SUPERUSER`）。⇒ 这条 skill 对管理员不可见，那条空态断言原样成立；
 *   对本项目的引导师（team=fullstack）可见，第 8a 步挂得上。
 *   两条断言各自考验的东西都没有被削弱，而且这条种子更贴近真实形态：
 *   一个团队自己的 skill，而不是全组织广播的示例。
 */
{
  const versionId = `${mountableSkillId}-v1`;
  const mountableSkillTeamId = fixture.teams.fullstack;
  if (!mountableSkillTeamId) throw new Error("fixture.teams.fullstack is required for #467 seed");
  const { createHash } = await import("node:crypto");
  const promptTemplate = "把讨论拆成 MECE 的假设树。";
  const contentHash = createHash("sha256").update(promptTemplate).digest("hex");
  await asApp(orgId, async (client) => {
    await client.query(
      `INSERT INTO skill_contracts
         (id, org_id, name, duty, source, status, visibility, owner_team_id,
          current_version_id, archived, created_by)
       VALUES ($1,$2,$3,'把讨论拆成 MECE 的假设树','自建','已启用','team-only',$4,$5,false,$6)
       ON CONFLICT (id) DO NOTHING`,
      [mountableSkillId, orgId, mountableSkillName, mountableSkillTeamId, versionId, adminUserId],
    );
    await client.query(
      `INSERT INTO skill_contract_versions
         (id, org_id, skill_id, version_number, state, prompt_template, input_schema,
          output_schema, data_scope, reads_raw_transcript, fallback_declaration,
          model_ref, content_hash, created_by)
       VALUES ($1,$2,$3,1,'已生效',$4,'{}','{}','[]'::jsonb,false,'不确定时明说不确定',
               'fullstack-loopback/loopback-echo',$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [versionId, orgId, mountableSkillId, promptTemplate, contentHash, adminUserId],
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
