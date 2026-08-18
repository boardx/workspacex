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
/**
 * #1310 —— 「agent/skill/context 配置 → chat 出结果」主流程 e2e 的两份**前置条件**。
 * 与上面 agent 那几条同型：种的是「这个组织里有一个可挂载的 skill」「这条线程里有一份
 * 已抽取正文的附件」，**动作本身**（挂载、发问、召回）全部由用例现场做——
 * `thread_skill_mounts` 一行都不种，所以「挂载没生效」时用例照样红。
 */
const MOUNTABLE_SKILL_ID = required("CHAT_E2E_MOUNTABLE_SKILL_ID");
const MOUNTABLE_SKILL_NAME = required("CHAT_E2E_MOUNTABLE_SKILL_NAME");
const RETRIEVAL_ATTACHMENT_FILENAME = required("CHAT_E2E_RETRIEVAL_ATTACHMENT_FILENAME");
const RETRIEVAL_EXCERPT = required("CHAT_E2E_RETRIEVAL_EXCERPT");
/**
 * #1324 —— #1310/#1314 复核重构的三条专属线程（见 `chat-read-fixture.ts` 同名字段的头注）：
 * 各自零预置消息，不共享 `THREAD_ID` 那 51 条历史，用例发的第一条消息天然落在第一页。
 */
const SKILL_MOUNT_THREAD_ID = required("CHAT_E2E_SKILL_MOUNT_THREAD_ID");
const CAUSAL_CHECK_THREAD_ID = required("CHAT_E2E_CAUSAL_CHECK_THREAD_ID");
const CONTEXT_CHECK_THREAD_ID = required("CHAT_E2E_CONTEXT_CHECK_THREAD_ID");
const RESTRUCTURE_PROJECT_ID = required("CHAT_E2E_RESTRUCTURE_PROJECT_ID");
/**
 * #1560 P1 e2e —— 图片附件走 VLM、无 key 诚实降级的专属线程。零预置消息，同一套理由
 * 见上面三条 #1324 线程的头注：发出去的第一条消息天然落在第一页，不需要翻页。
 */
const IMAGE_VISION_THREAD_ID = required("CHAT_E2E_IMAGE_VISION_THREAD_ID");

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

/**
 * #1324 —— 一个**独立的第二个项目**，专门装下面三条零预置消息的线程（见
 * `chat-read-fixture.ts` 里 `restructureProjectId` 的头注）。`seedOrg` 一个 org 只能调
 * 一次（`INSERT INTO organizations` 撞主键），所以这里手写第二条 `projects` +
 * `workshops` 子类型行——逐字照抄 `seedOrg` 内部对 `PROJECT_ID` 做的那两条 INSERT
 * （F116 要求 `projects` 与子类型表 1:1，见 `db.ts` 里 `seedOrg` 自己的头注），
 * 不是发明第二套建项目的方式。
 */
await asApp(ORG_ID, async (client) => {
  await client.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, $3, 'workshop')", [
    RESTRUCTURE_PROJECT_ID, ORG_ID, `project ${RESTRUCTURE_PROJECT_ID}`,
  ]);
  await client.query("INSERT INTO workshops (id, org_id) VALUES ($1, $2)", [RESTRUCTURE_PROJECT_ID, ORG_ID]);
});
await addProjectMember(ORG_ID, RESTRUCTURE_PROJECT_ID, USER_ID, "facilitator", null);

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

/**
 * #1324 —— 三条零预置消息的专属线程，种在**独立的第二个项目**
 * `RESTRUCTURE_PROJECT_ID`（不是 `PROJECT_ID`）。刻意**不**在这里调用
 * `addChatMessage`：每条测试自己发的第一条消息就是这条线程的第一条消息，
 * 落在第一页，用例不需要 `chat-messages-load-more`。
 *
 * ⚠ 为什么必须是独立项目，不能塞进 `PROJECT_ID`——本轮实测踩过两版才定下来：
 *   · 塞进同一个项目：`chat-read.spec.ts:41` 有一条显式断言「这个项目只有一条会话」
 *     （数 `chat-thread-card-list` 里的按钮，注释原话「夹具里只有一条会话，
 *     列表就只列一条」），三条线程一进去，数字从 1 变 4，那条断言红。
 *   · 塞进同一个项目 + 把这三条线程的 `lastActivityAt` 往回钉：能避开上一条，
 *     但 `ChatReadScreen` 在 URL 不带 `?thread=` 时默认选中列表第一条
 *     （`chat-read-screen.tsx:137`），`listThreads` 又按 `last_activity_at DESC`
 *     排序——稍不注意就会顶替 `THREAD_ID` 成为默认项，把 `chat-read.spec.ts` 里
 *     8 条依赖「默认落在 51 条消息那条线程」的既有用例全部带红；往回钉太远（如
 *     2020-01-01）又会撞上 `threadGroupLabel`（`thread-grouping.ts`）「只认今天/
 *     本周两组、更早的线程直接不出现在返回值里」这条已知功能缺失，线程从侧栏
 *     整个消失。两个坑本质上都是「同一个项目内的线程列表互相干扰」。
 *   放进独立项目，两个问题一次性消失：`chat-read.spec.ts` 数的是 `PROJECT_ID`
 *   下的会话数，与这里无关；默认选中也是各项目独立计算，互不竞争。
 */
for (const [id, title] of [
  [SKILL_MOUNT_THREAD_ID, "Skill mount check fixture thread"],
  [CAUSAL_CHECK_THREAD_ID, "Causal check fixture thread"],
  [CONTEXT_CHECK_THREAD_ID, "Context check fixture thread"],
  [IMAGE_VISION_THREAD_ID, "Image vision extraction fixture thread"],
] as const) {
  await addChatThread({
    orgId: ORG_ID,
    id,
    projectId: RESTRUCTURE_PROJECT_ID,
    visibilityScope: "plenary",
    createdBy: USER_ID,
    phase: "research",
    title,
  });
}

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
  // #1324 —— 三条专属线程也各自把同一个可运行 agent 种进编制：用例发消息时不需要
  // 先走「加进编制」那一步，`chat-live-message-panel.tsx` 默认选中唯一在场的 agent。
  for (const threadId of [
    SKILL_MOUNT_THREAD_ID, CAUSAL_CHECK_THREAD_ID, CONTEXT_CHECK_THREAD_ID, IMAGE_VISION_THREAD_ID,
  ]) {
    await client.query(
      "INSERT INTO chat_thread_agents (thread_id, org_id, agent_id, presence) VALUES ($1,$2,$3,'present')",
      [threadId, ORG_ID, AGENT_ID],
    );
  }

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
 *
 * ⚠ `AGENT_ID` **不在这里再种一次**——PR #650（#619 编制收敛）把上面 `asApp` 块里
 * 原来写 `org_agents` 的那两行改成了直接写 `capability_listings`（`id=AGENT_ID`,
 * `kind='agent'`, `enabled=true`），这行本来是那次改动之前、`capability_listings`
 * 还没有这行数据时补的。两处现在写同一个主键，`capability_listings_pkey` 撞车——
 * 实测复现：`pnpm run verify:chat-read` 在 API webServer 启动阶段就崩，
 * `duplicate key value violates unique constraint "capability_listings_pkey"`，
 * 两次干净重跑（不同 with-test-isolation 隔离 DB）都在同一行复现，确认不是
 * 负载/环境假阴性。PR #650 那次插入本身已经带上个人对话下拉需要的
 * `enabled=true`，这里的调用纯属多余，删掉，不是"两边都保留、改成 upsert"——
 * 同一件事只该有一个写点。
 *
 * `DEEP_AGENT_ID` 这个第二个 agent 是本 issue（#728 P6/P7）独有的，PR #650
 * 没有它的等价写入，保留。
 */
await addCapability({
  orgId: ORG_ID,
  id: DEEP_AGENT_ID,
  kind: "agent",
  name: DEEP_AGENT_DISPLAY_NAME,
  enabled: true,
});

/**
 * #1310 ① —— F65 要挂载的那个**已启用** skill。
 *
 * ⚠ 种 `skill_contracts` 而**不是** wave2 的 `skills` 表，这不是随手选的：挂载判据走
 *   `SkillVisibilityPort` → `PgSkillContractRepository.loadDetail`，而 `loadDetail` **只**读
 *   `skill_contracts`（`listAll` 那侧才合并了 wave2 表）。种进 wave2 表的话，skill 会出现在
 *   选择器池子里却挂不上（`loadDetail` 返回 null ⇒ `SKILL_NOT_FOUND`）——那是一个真实的
 *   产品缺口（列表读合并了两套模型、详情读没有），本条测试刻意避开它，不把它掩盖成「挂载坏了」。
 *
 * ⚠ 为什么必须种、不能让用例自己建：`skill.controller.ts` 逐字没有启用路由
 *   （`SKILLS_FORBIDDEN_ROUTES` 禁 `POST /skills/:id/enable`），`草稿 → 已启用` 只能由
 *   `reviewSkillVersion` 产生，而那条用例今天没有 HTTP 边界。同 `seed-fullstack-smoke.ts`
 *   里 #467 那份种子的处境，一字不差。
 *
 * `visibility='org-wide'`：本夹具用户是 `addOrgMember(..., "lead", null)`，**不属于任何团队**，
 * 而 `decide()` 对 `team-only` 要求 `org.teamId === scope.ownerTeamId` ⇒ 种成 team-only
 * 它对自己都不可见、挂不上。本夹具也没有 `skill-create-smoke.spec.ts` 那条「目录空态」
 * 断言需要保护（那正是 fullstack-smoke 那份种子必须选 team-only 的理由）。
 */
{
  const { createHash } = await import("node:crypto");
  const versionId = `${MOUNTABLE_SKILL_ID}-v1`;
  const promptTemplate = "把讨论拆成 MECE 的假设树。";
  const contentHash = createHash("sha256").update(promptTemplate).digest("hex");
  await asApp(ORG_ID, async (client) => {
    await client.query(
      `INSERT INTO skill_contracts
         (id, org_id, name, duty, source, status, visibility, owner_team_id,
          current_version_id, archived, created_by)
       VALUES ($1,$2,$3,'把讨论拆成 MECE 的假设树','自建','已启用','org-wide',NULL,$4,false,$5)
       ON CONFLICT (id) DO NOTHING`,
      [MOUNTABLE_SKILL_ID, ORG_ID, MOUNTABLE_SKILL_NAME, versionId, USER_ID],
    );
    await client.query(
      `INSERT INTO skill_contract_versions
         (id, org_id, skill_id, version_number, state, prompt_template, input_schema,
          output_schema, data_scope, reads_raw_transcript, fallback_declaration,
          model_ref, content_hash, created_by)
       VALUES ($1,$2,$3,1,'已生效',$4,'{}','{}','[]'::jsonb,false,'不确定时明说不确定',
               $5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [versionId, ORG_ID, MOUNTABLE_SKILL_ID, promptTemplate,
        `${AGENT_MODEL_PROVIDER}/${AGENT_MODEL_ID}`, contentHash, USER_ID],
    );
  });
}

/**
 * #1310 ② / #1324 —— F155 L3 文件检索的**素材**：一份已抽出正文的聊天附件。
 *
 * `message_id` 刻意留 NULL（「已上传、尚未挂到任何消息」的 pending 态）：
 * `pg-file-retrieval.ts` 的检索只 `JOIN chat_threads ON t.id = a.thread_id`，**不看**
 * `message_id`，所以 pending 行照样被召回；而不挂消息就不会在消息列表里多渲染一个附件 chip，
 * 本 config 上另外八条既有 chat-read 用例的断言一条都不会被这份种子动到。
 *
 * `extraction_status='extracted'` ∧ `extracted_excerpt` 非空是检索 WHERE 里的硬条件
 * （pending/failed/unsupported 的附件没有可检索内容，实现刻意不召回它们）。
 * `search_tsv` 是**生成列**（migration `20260814120000_f155_file_retrieval_fts.sql`），
 * 不在这里写——写它会是「同一事实声明在两处」，而且那列根本不可写。
 *
 * ⚠ #1324 —— `thread_id` 从共享的 `THREAD_ID`（51 条消息那条）**改成**
 *   `CONTEXT_CHECK_THREAD_ID`（专属、零预置消息）。这是搬家不是复制：全仓只有
 *   `chat-agent-skill-context.spec.ts` 用到这份附件，`chat-read.spec.ts` 那八条既有用例
 *   从未依赖过它，搬过去不影响它们；context 命中/未命中那条用例也因此不再需要
 *   翻 `THREAD_ID` 那 51 条历史去找自己发的消息。
 */
await asApp(ORG_ID, async (client) => {
  await client.query(
    `INSERT INTO chat_message_attachments
       (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes,
        extraction_status, extracted_excerpt)
     VALUES ($1,$2,$3,NULL,$4,$5,'text/markdown',$6,'extracted',$7)
     ON CONFLICT (id) DO UPDATE
       SET extraction_status = 'extracted', extracted_excerpt = EXCLUDED.extracted_excerpt`,
    [
      "attachment-chat-read-e2e-retrieval",
      ORG_ID,
      CONTEXT_CHECK_THREAD_ID,
      "chat-read-e2e/retrieval-fixture.md",
      RETRIEVAL_ATTACHMENT_FILENAME,
      Buffer.byteLength(RETRIEVAL_EXCERPT, "utf8"),
      RETRIEVAL_EXCERPT,
    ],
  );
});

process.stdout.write(
  `[chat-read-e2e-fixture] seeded org=${ORG_ID} project=${PROJECT_ID} thread=${THREAD_ID} messages=51 `
  + `roster=1 publishedAgent=1 catalogOnlyAgent=1 deepAgent=1 mountableSkill=1 retrievableAttachment=1 `
  + `skillMountThread=${SKILL_MOUNT_THREAD_ID} causalCheckThread=${CAUSAL_CHECK_THREAD_ID} `
  + `contextCheckThread=${CONTEXT_CHECK_THREAD_ID} imageVisionThread=${IMAGE_VISION_THREAD_ID}\n`,
);
