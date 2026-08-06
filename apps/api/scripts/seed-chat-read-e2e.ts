/**
 * Controlled database fixture for issue #405's browser read-path verification.
 *
 * This is deliberately not a product fallback. It runs only when CHAT_E2E_FIXTURE=1,
 * writes a dedicated tenant, and the browser still reads every value through the real
 * login, identity and Chat HTTP controllers.
 */
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  resetOrgs,
  seedOrg,
} from "../tests/support/db";
import { addChatMessage, addChatThread } from "../tests/support/chat-db";
import { addCapability } from "../tests/support/db";
import { createChatWave2FixtureSchema } from "../tests/support/chat-wave2-fixture-schema";

if (process.env.CHAT_E2E_FIXTURE !== "1") {
  throw new Error("CHAT_E2E_FIXTURE=1 is required");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const password = required("CHAT_E2E_PASSWORD");
const ORG_ID = required("CHAT_E2E_ORG_ID");
const USER_ID = required("CHAT_E2E_USER_ID");
const PROJECT_ID = required("CHAT_E2E_PROJECT_ID");
const THREAD_ID = required("CHAT_E2E_THREAD_ID");
const EMAIL = required("CHAT_E2E_EMAIL");
const AGENT_ID = required("CHAT_E2E_AGENT_ID");
const AGENT_VERSION_ID = `${AGENT_ID}-version-1`;
/**
 * #467：只进**组织 agent 目录**、不进本线程编制的第二个 agent。
 * 「把一个 agent 加进会话」这条用例需要一个当前不在编制里、但服务端认可的 agent；
 * 拿已在编制里的 `AGENT_ID` 去做，什么都不做的实现也会绿。
 */
const CATALOG_ONLY_AGENT_ID = required("CHAT_E2E_CATALOG_ONLY_AGENT_ID");
/**
 * #728 P6/P7 —— 与 `apps/web/e2e/chat-read-fixture.ts` 的 `agentModelProvider`/
 * `agentModelId` 是**同一份事实**，两头都从环境变量读，不各自写一份字面量。
 * `playwright.chat-read.config.ts` 下发这两个变量给本脚本，也下发
 * `KERNEL_MODEL_PROVIDER` 给 API 进程——三处对齐，run 才不会撞上
 * `MODEL_PROVIDER_NOT_CONFIGURED`。
 */
const AGENT_MODEL_PROVIDER = required("CHAT_E2E_AGENT_MODEL_PROVIDER");
const AGENT_MODEL_ID = required("CHAT_E2E_AGENT_MODEL_ID");
/**
 * #728 P6/P7 —— 第二个 agent，走真实 `deep-agent` provider 代码路径（上游是
 * `loopback-deep-agent-provider.ts` 这个确定性替身，不是本脚本里的第三套逻辑）。
 * 见 `chat-read-fixture.ts` 里 `deepAgentModelProvider` 的头注：这个值不是任意
 * 字符串，必须逐字等于 `DEEP_AGENT_PROVIDER_NAME`。
 */
const DEEP_AGENT_ID = required("CHAT_E2E_DEEP_AGENT_ID");
const DEEP_AGENT_VERSION_ID = `${DEEP_AGENT_ID}-version-1`;
const DEEP_AGENT_MODEL_PROVIDER = required("CHAT_E2E_DEEP_AGENT_MODEL_PROVIDER");
const DEEP_AGENT_MODEL_ID = required("CHAT_E2E_DEEP_AGENT_MODEL_ID");
const DEEP_AGENT_DISPLAY_NAME = required("CHAT_E2E_DEEP_AGENT_DISPLAY_NAME");

await resetOrgs(ORG_ID);
await asOwner(async (client) => {
  await client.query("DELETE FROM credentials WHERE user_id = $1 OR email = $2", [USER_ID, EMAIL]);
  // #651：this used to inline its own copy of the `chat_wave2_fixture` schema, which drifted
  // from the equivalent copy in `message-write-roundtrip.test.ts` (that one got the
  // `instructions` column when #595 Line A needed it; this one didn't). Every real message
  // POST through this E2E fixture then hit `column v.instructions does not exist` and
  // returned 500 instead of the contracted 202. Now there is exactly one declaration
  // (`tests/support/chat-wave2-fixture-schema.ts`) and both callers import it.
  await createChatWave2FixtureSchema(client);
});

await seedOrg({ orgId: ORG_ID, projectId: PROJECT_ID, groupNames: ["readers"] });
await addOrgMember(ORG_ID, USER_ID, "lead", null);
await addProjectMember(ORG_ID, PROJECT_ID, USER_ID, "facilitator", null);

const passwordHash = await new BcryptPasswordHasher().hash(password);
await asOwner(async (client) => {
  await client.query(
    `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
     VALUES ($1,$2,$3,$4,now())`,
    [USER_ID, EMAIL, "Chat Read E2E", passwordHash],
  );
});

await addChatThread({
  orgId: ORG_ID,
  id: THREAD_ID,
  projectId: PROJECT_ID,
  visibilityScope: "plenary",
  createdBy: USER_ID,
  phase: "research",
  title: "Controlled fixture thread",
});

for (let index = 1; index <= 51; index += 1) {
  const suffix = String(index).padStart(2, "0");
  await addChatMessage({
    orgId: ORG_ID,
    id: `message-chat-read-e2e-${suffix}`,
    threadId: THREAD_ID,
    authorId: index % 2 === 0 ? AGENT_ID : USER_ID,
    authorKind: index % 2 === 0 ? "agent" : "human",
    agentId: index % 2 === 0 ? AGENT_ID : null,
    body: `Controlled fixture message ${suffix}`,
  });
}

await asApp(ORG_ID, async (client) => {
  await client.query("DELETE FROM chat_wave2_fixture.agent_versions WHERE org_id=$1", [ORG_ID]);
  await client.query("DELETE FROM chat_wave2_fixture.agents WHERE org_id=$1", [ORG_ID]);
  /**
   * #728 P6/P7 —— `chat_wave2_fixture.agents/agent_versions`（下面紧跟着的两条 INSERT）
   * 只服务**消息接受时**的目录查找（`KERNEL_AGENT_CATALOG_SCHEMA=chat_wave2_fixture`
   * 把那条查询重定向到这个夹具 schema）。**执行**时 `claimQueued` 联的是**生产表**
   * `agent_versions`（`pg-agent-run-repository.ts:90`：`JOIN agent_versions v ON
   * v.id=r.agent_version_id`），不是这个夹具 schema——两张表分别服务两个不同阶段，
   * 只种一张会让 run 卡在 `AGENT_VERSION_UNAVAILABLE`（"unresolvable" claim outcome）。
   * 这条是本轮实测撞出来的：第一版只种了 chat_wave2_fixture，run 稳定推进到
   * failed/AGENT_VERSION_UNAVAILABLE，从未到过 succeeded。
   *
   * 生产表的列形状与 `seed-fullstack-smoke.ts:167-190` 逐字同构（stable_name /
   * semantic_label / instruction_digest / tool_policy），照抄那份已验证成功的模式，
   * 不是另起一套。
   */
  const instructions = "Chat read E2E fixture agent. Echo back what you are given.";
  const { createHash } = await import("node:crypto");
  const instructionDigest = createHash("sha256").update(instructions).digest("hex");
  await client.query(
    `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
     VALUES ($1,$2,$1,$3,'enabled',$4,now(),now())
     ON CONFLICT (id) DO UPDATE SET status='enabled'`,
    [AGENT_ID, ORG_ID, "Controlled Read Agent", USER_ID],
  );
  await client.query(
    `INSERT INTO agent_versions
       (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
        skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
     VALUES ($1,$2,$3,'1.0.0',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())
     ON CONFLICT (id) DO NOTHING`,
    [AGENT_VERSION_ID, ORG_ID, AGENT_ID, instructionDigest, instructions,
      AGENT_MODEL_PROVIDER, AGENT_MODEL_ID, USER_ID],
  );
  await client.query(
    "UPDATE agents SET published_version_id = $1 WHERE id = $2 AND org_id = $3",
    [AGENT_VERSION_ID, AGENT_ID, ORG_ID],
  );
  await client.query(
    `INSERT INTO chat_wave2_fixture.agents (id,org_id,status,published_version_id)
     VALUES ($1,$2,'enabled',$3)`,
    [AGENT_ID, ORG_ID, AGENT_VERSION_ID],
  );
  await client.query(
    `INSERT INTO chat_wave2_fixture.agent_versions
       (id,org_id,agent_id,skill_version_ids,model_provider,model_id,instructions,published_at)
     VALUES ($1,$2,$3,'[]'::jsonb,$4,$5,$6,now())`,
    [
      AGENT_VERSION_ID, ORG_ID, AGENT_ID, AGENT_MODEL_PROVIDER, AGENT_MODEL_ID,
      "Controlled Read E2E fixture agent; replies are produced by the deterministic loopback provider.",
    ],
  );
  // #619：编制合法性判据已收敛到 `capability_listings`（kind='agent', enabled=true）——
  // `chat_thread_agents` 的插入触发器直接查这张表，不再看 `org_agents`（迁移
  // `20260807000000_i619_agent_roster_capability_convergence.sql`）。这里同时也是
  // roster 选择器的真实读源（`GET /capabilities?kind=agent`），所以这两行同时
  // 承担「合法性判据」与「界面下拉可选项」两个角色。
  await client.query(
    `INSERT INTO capability_listings (id, org_id, kind, name, scope, enabled, abbr, duty)
     VALUES ($1,$2,'agent','Controlled Read Agent','org-wide',true,$3,$4)`,
    [AGENT_ID, ORG_ID, "CR", "Read-only E2E roster fixture"],
  );
  // #467：进目录但**不**进 `chat_thread_agents`——它是「加进来」那条用例的素材。
  await client.query(
    `INSERT INTO capability_listings (id, org_id, kind, name, scope, enabled, abbr, duty)
     VALUES ($1,$2,'agent','Catalog Only Agent','org-wide',true,$3,$4)`,
    [CATALOG_ONLY_AGENT_ID, ORG_ID, "CO", "Roster mount E2E fixture"],
  );
  await client.query(
    "INSERT INTO chat_thread_agents (thread_id, org_id, agent_id, presence) VALUES ($1,$2,$3,'present')",
    [THREAD_ID, ORG_ID, AGENT_ID],
  );

  // #728 P6/P7 —— 第二个 agent，同一套生产表 + 夹具表两处种法，唯一不同是
  // model_provider 指向 deep-agent（真实工具调用可见代码路径的取证 agent）。
  const deepAgentInstructions = "Chat read E2E deep-agent fixture agent. Plans, calls a tool, then answers.";
  const deepAgentInstructionDigest = createHash("sha256").update(deepAgentInstructions).digest("hex");
  await client.query(
    `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
     VALUES ($1,$2,$1,$3,'enabled',$4,now(),now())
     ON CONFLICT (id) DO UPDATE SET status='enabled'`,
    [DEEP_AGENT_ID, ORG_ID, DEEP_AGENT_DISPLAY_NAME, USER_ID],
  );
  await client.query(
    `INSERT INTO agent_versions
       (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
        skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
     VALUES ($1,$2,$3,'1.0.0',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())
     ON CONFLICT (id) DO NOTHING`,
    [DEEP_AGENT_VERSION_ID, ORG_ID, DEEP_AGENT_ID, deepAgentInstructionDigest, deepAgentInstructions,
      DEEP_AGENT_MODEL_PROVIDER, DEEP_AGENT_MODEL_ID, USER_ID],
  );
  await client.query(
    "UPDATE agents SET published_version_id = $1 WHERE id = $2 AND org_id = $3",
    [DEEP_AGENT_VERSION_ID, DEEP_AGENT_ID, ORG_ID],
  );
  await client.query(
    `INSERT INTO chat_wave2_fixture.agents (id,org_id,status,published_version_id)
     VALUES ($1,$2,'enabled',$3)`,
    [DEEP_AGENT_ID, ORG_ID, DEEP_AGENT_VERSION_ID],
  );
  await client.query(
    `INSERT INTO chat_wave2_fixture.agent_versions
       (id,org_id,agent_id,skill_version_ids,model_provider,model_id,instructions,published_at)
     VALUES ($1,$2,$3,'[]'::jsonb,$4,$5,$6,now())`,
    [
      DEEP_AGENT_VERSION_ID, ORG_ID, DEEP_AGENT_ID, DEEP_AGENT_MODEL_PROVIDER, DEEP_AGENT_MODEL_ID,
      deepAgentInstructions,
    ],
  );
});

/**
 * #728 —— 个人对话的 agent 下拉走的是**组织能力目录**（`listCapabilities(orgId, "agent")`，
 * `personal-chat-screen.tsx:445`），不是 `org_agents`（项目线程编制走的那张表）。
 * 此前这里没有对应的 `capability_listings` 行，个人对话屏永远显示「这个组织还没有
 * 可用的 Agent」——不是渲染代码缺失，是这个 fixture 从没让它有过可选的 agent。
 *
 * id 复用上面已经在 `chat_wave2_fixture.agents/agent_versions` 里配好、真的可执行的
 * `AGENT_ID`，不新造一个只挂名字的假 agent。
 */
await addCapability({
  orgId: ORG_ID,
  id: AGENT_ID,
  kind: "agent",
  name: "Controlled Read Agent",
  enabled: true,
});
// #728 P6/P7 —— 同一条纪律，第二个 agent 也要进能力目录才会出现在个人对话的
// agent 下拉里。
await addCapability({
  orgId: ORG_ID,
  id: DEEP_AGENT_ID,
  kind: "agent",
  name: DEEP_AGENT_DISPLAY_NAME,
  enabled: true,
});

process.stdout.write(
  `[chat-read-e2e-fixture] seeded org=${ORG_ID} project=${PROJECT_ID} thread=${THREAD_ID} messages=51 roster=1 publishedAgent=1 catalogOnlyAgent=1 deepAgent=1\n`,
);
