/** Controlled PG fixture for #387's login -> projects -> overview -> Files browser gate. */
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import {
  addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../tests/support/db";
import { addBrowserArtifact } from "../tests/support/files-db";
import { recording as C } from "@repo/contracts";

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
/** #552: a real `security-reviewer`. See the fixture for why none of the other three fits. */
const securityReviewerEmail = required("FULLSTACK_E2E_SECURITY_REVIEWER_EMAIL");
const securityReviewerPassword = required("FULLSTACK_E2E_SECURITY_REVIEWER_PASSWORD");
const securityReviewerUserId = required("FULLSTACK_E2E_SECURITY_REVIEWER_USER_ID");
/** #435: the one agent core-loop step 8b actually RUNS. See the fixture for the two-worlds note. */
const agentId = required("FULLSTACK_E2E_AGENT_ID");
const agentDisplayName = required("FULLSTACK_E2E_AGENT_NAME");
const agentModelProvider = required("FULLSTACK_E2E_AGENT_MODEL_PROVIDER");
const agentModelId = required("FULLSTACK_E2E_AGENT_MODEL_ID");
/** #467: the one **enabled** Skill core-loop step 8a mounts. See the fixture for why it is seeded. */
const mountableSkillId = required("FULLSTACK_E2E_MOUNTABLE_SKILL_ID");
const mountableSkillName = required("FULLSTACK_E2E_MOUNTABLE_SKILL_NAME");
/** #493: the one **published** template and the one **active** agenda segment step 8c uses. */
const boundTemplateKey = required("FULLSTACK_E2E_BOUND_TEMPLATE_KEY");
const boundTemplateName = required("FULLSTACK_E2E_BOUND_TEMPLATE_NAME");
const agendaSegmentId = required("FULLSTACK_E2E_AGENDA_SEGMENT_ID");
const agendaSegmentTitle = required("FULLSTACK_E2E_AGENDA_SEGMENT_TITLE");

ensureDatabase();
await migrateOnce();
await resetOrgs(orgId);
await asOwner(async (client) => {
  await client.query(
    "DELETE FROM credentials WHERE user_id = ANY($1::text[]) OR email = ANY($2::text[])",
    [
      [userId, adminUserId, memberUserId, securityReviewerUserId],
      [email, adminEmail, memberEmail, securityReviewerEmail],
    ],
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
// #552: the security reviewer lives in the SAME team as the submitter, otherwise the
// `team-only` Skill would be invisible to him and the assertion would go red on a 404
// instead of on `REVIEWER_FUNCTION_MISMATCH` -- red, but not for the right reason.
await addOrgMember(orgId, securityReviewerUserId, "consultant", fixture.teams.fullstack ?? null);

const hasher = new BcryptPasswordHasher();
const passwordHash = await hasher.hash(password);
const adminPasswordHash = await hasher.hash(adminPassword);
const memberPasswordHash = await hasher.hash(memberPassword);
const securityReviewerPasswordHash = await hasher.hash(securityReviewerPassword);
await asOwner(async (client) => {
  await client.query(
    `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
     VALUES ($1,$2,$3,$4,now()), ($5,$6,$7,$8,now()), ($9,$10,$11,$12,now()), ($13,$14,$15,$16,now())`,
    [
      userId, email, "Fullstack E2E", passwordHash,
      adminUserId, adminEmail, "Fullstack E2E admin", adminPasswordHash,
      memberUserId, memberEmail, "Fullstack E2E member", memberPasswordHash,
      securityReviewerUserId, securityReviewerEmail, "Fullstack E2E security reviewer",
      securityReviewerPasswordHash,
    ],
  );
});

/**
 * 🟢 #552 —— **谁能审**（`skill_reviewer_functions`，I-5）。
 *
 * ## 这里种的是前置条件，不是被断言的东西
 *
 * 与 #467 种一条**已启用的 skill** 恰好相反：那条当年必须种，因为不存在任何产品路径能
 * 启用一个 skill；#552 补的就是那条路径，所以 `skill_contracts` 这里**一行都不种** ——
 * 走完扫描 → 提交 → 批准是用例现场的事，种了就等于把结论预置掉。
 *
 * 「职能由组织管理员指派」（契约 `ReviewerFunction` 逐字：**不是自助申领**），而指派动作
 * 属 identity/auth 域、本束不建那个操作。⇒ 在系统里它只能来自组织管理，用例造不出来，
 * 只能种。这与 #493 种「已发布模板 ＋ active 环节」是同一类前置条件。
 *
 * ## ⚠ 提交人自己也是方法论审核人，这是刻意的
 *
 * 否则「自己审自己」会落在 `REVIEWER_FUNCTION_MISMATCH`（你根本没职能）上，而 I-4 要断言的
 * 是 `SELF_REVIEW_FORBIDDEN`（你有职能，但不能审自己这一份）。两码分开正是 A4 的要求，
 * 而种子决定了断言能不能碰到那条分支。
 * ⚠ 同时存在**第二位**方法论审核人（member），所以自审落 `SELF_REVIEW_FORBIDDEN` 而不是
 *   `NO_SECOND_REVIEWER` —— 后者是「组织配置问题」，不是本条要验的东西。
 */
await asApp(orgId, async (client) => {
  await client.query(
    `INSERT INTO skill_reviewer_functions (org_id, principal_id, reviewer_function, assigned_by)
     VALUES ($1,$2,'methodology-reviewer',$5),
            ($1,$3,'methodology-reviewer',$5),
            ($1,$4,'security-reviewer',$5)
     ON CONFLICT (org_id, principal_id)
       DO UPDATE SET reviewer_function = EXCLUDED.reviewer_function`,
    [orgId, userId, memberUserId, securityReviewerUserId, adminUserId],
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

/**
 * 🟡 #466 —— 核心闭环第 7 步「会话内录音」的**两个前置条件**。
 *
 * ## ① 保留期（`retention_policies`）
 *
 * `startRecording` 在开始时就解析生效保留期，解析不出来一律
 * `RETENTION_POLICY_MISSING` 并**拒绝开始** —— E5 的 fail-closed，
 * `pg-recording-repository.ts` 的 `retentionResolver` 里写着「不发明常量」。
 * 而 `resolvedFrom: "org"` 今天不可达（schema 里没有组织级天数，已登记为缺口），
 * 所以唯一能让录音开始的路是给项目配一条 override。这是**配置**，不是绕过门禁：
 * 门禁照常判定，只是这个项目确实有保留期。
 *
 * ## ② 授权矩阵（`recording_consent_cells`）—— ⚠ 这是一个真实缺口
 *
 * `blocksStart` 要求**每个在场者的每一项**都是 `granted`，缺行按 0 算。
 * 而契约里**没有任何写授权格子的操作**（#465 的迁移文件头逐字写着这件事），
 * 也就是说**这套系统今天不存在任何产品路径能让一个人完成录音授权**。
 * 与 #467 的「没有产品路径能把 skill 变成已启用」是同型缺口，随 #466 上报。
 *
 * 于是第 7 步的形状被这个缺口决定了：
 *
 *   · **线程必须预置**（`FULLSTACK_E2E_RECORDING_THREAD_ID`）。授权格子按
 *     `source_ref_id` 存，而用例现场新建的线程 id 在种子跑的时候还不存在 ——
 *     没有第二种办法。
 *   · **录音本身一行都不种。** `recording_sessions` / `recording_tracks` /
 *     `recording_segments` 全部由用例现场走真实链路产生。所以「开始录音没生效」
 *     「转录没落库」时第 7 步照样红。
 *
 * ⚠ **不得**为了省掉这段种子去放宽 `blocksStart` 的判定。那条门禁是
 *   「任一在场者的任一项为 pending ⇒ 那一路不采集」的唯一落点。
 */
{
  const recordingThreadId = required("FULLSTACK_E2E_RECORDING_THREAD_ID");
  const recordingThreadTitle = required("FULLSTACK_E2E_RECORDING_THREAD_TITLE");
  await asApp(orgId, async (client) => {
    await client.query(
      `INSERT INTO retention_policies (project_id, org_id, material_days, updated_by)
       VALUES ($1,$2,180,$3)
       ON CONFLICT (project_id) DO UPDATE SET material_days = EXCLUDED.material_days`,
      [projectId, orgId, adminUserId],
    );
    await client.query(
      // `plenary` = 全场（项目内全员可见）。取自契约 `ChatVisibility`，
      // 不是随手选：`member-private` / `group-shared` 会把这条线程的可见性
      // 绑到组关系上，而第 7 步验的是录音，不该顺带引入一个组可见性变量。
      `INSERT INTO chat_threads (id, org_id, project_id, visibility_scope, title, created_by)
       VALUES ($1,$2,$3,'plenary',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [recordingThreadId, orgId, projectId, recordingThreadTitle, userId],
    );
    /**
     * 一条消息 —— **转录的锚点**，不是装饰。
     *
     * 已签 recording 束的 I-1（`ANCHOR_RULES.thread === "message"`）要求
     * `thread` 载体的段落必须锚在一条消息上，且不得携带时间码。没有消息的会话
     * 因此**录不了**（`ANCHOR_MISSING`）—— 实测红过一次。
     *
     * ⚠ 种的仍然是**前置条件**：录音会话、音轨、转写段一行都不种。
     */
    await client.query(
      `INSERT INTO chat_messages (id, org_id, thread_id, author_kind, author_id, body)
       VALUES ($1,$2,$3,'human',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [`${recordingThreadId}-msg-1`, orgId, recordingThreadId, userId, "录音锚点消息"],
    );
    // 全部授权项 granted，只给**这一个** participant —— `trackPlan` 里也只有他。
    // 项目里的另外两个账号刻意不给：`blocksStart` 只对**在场者**求全，
    // 给所有人发一遍会让「只问在场的人」这条语义在种子里消失。
    //
    // ⚠ **2026-08-06，issue #533 CI 实测抓到（PR #585）：这里原来是字面量
    //   `["record", "transcript", "ai_analysis"]`** —— #465 铺路时在 `blocksStart`
    //   里堵住的那个「穿着数字外衣的枚举基数」，这份种子脚本没有同步：它是
    //   `blocksStart` 判定的**上游数据**，不是判定本身，`recording-consent-single-source
    //   .test.ts` 的扫描器和迁移 CHECK 对账都够不着它。
    //   X-7/XC-18 裁成四项后，`blocksStart` 的基数自动跟到 4（这正是裁决要的行为），
    //   而这份种子仍只种 3 项 ⇒ `fullstack-smoke` 第 7 步在 CI 上从 `data-phase="recording"`
    //   变成 `data-phase="failed"`（`CONSENT_NOT_COMPLETED`，403）。
    //   ⇒ 改为直接读 `C.RecordingConsentItem.options`：种子的项数**恒等于**契约当前的项数，
    //   不会再因为裁决改变项数而重新漂移。
    await client.query(
      `INSERT INTO recording_consent_cells (org_id, source_ref_id, participant_id, item, state)
       SELECT $1, $2, $3, item, 'granted' FROM unnest($4::text[]) AS item
       ON CONFLICT (org_id, source_ref_id, participant_id, item) DO UPDATE SET state = 'granted'`,
      [orgId, recordingThreadId, userId, [...C.RecordingConsentItem.options]],
    );
  });
  process.stdout.write(
    `[fullstack-fixture] recording thread=${recordingThreadId} title=${recordingThreadTitle}\n`,
  );
}

/**
 * 🟡 #493 —— 第 8c 步「**使用**一个 canvas 模板」的两个前置条件。
 *
 * 种的是前置条件，**绑定本身一行都不种**（`canvas_template_bindings` 保持空表）——
 * 与上面 #435 / #467 同型。所以第 8c 步在「绑定没落库」时照样红：`usageCount` 停在 0。
 *
 * ① `published` 模板。绑定的判定只接受 `published`（`domain/canvas/segment-binding.ts`），
 *    而闭环第 4 步在界面上建出来的是**草稿**，发布它要 org admin、用它要项目引导师——
 *    两个身份刻意不是同一个人（`application/canvas/bind-template-to-segment.ts` 文件头）。
 *    ⚠ `builtin=false` / `archived_from=NULL`：`canvas_templates_archived_from_shape`
 *      要求非 archived 行的 `archived_from` 为空。
 *    ⚠ **`team-only` 归 `fullstack` 团队，不是 `org-wide`**，理由与 #467 那条 skill 种子
 *      逐字同型（见 `fullstack-smoke-fixture.ts` 里 `mountableSkillId` 的那段）：
 *      `canvas-template-create-smoke.spec.ts:87` 断言**管理员**打开模板库时
 *      `tpladmin-empty` 可见（「种子刻意没有预置任何模板行」）——那是一条**反空转**断言，
 *      不许为了让本条种子进去而放宽它。管理员 `addOrgMember(…, "admin", null)` 不属于
 *      任何团队，而 `decide()` 对 `team-only` 要求 `org.teamId === ownerTeamId`，且
 *      管理员不是超级用户 ⇒ 这一行对他不可见，那条空态断言原样成立；对本项目的引导师
 *      （team=fullstack）可见，第 8c 步用得上。实测：先写成 `org-wide`，那条断言当场红。
 *
 * ② `active` 议程环节。`GET /projects/:id/overview` 只回 `state='active'` 的那一条
 *    （`pg-project-overview-repository.ts`），它是界面上唯一有真实来源的环节。
 *    ⚠ 这里直接写库，因为**没有任何产品路径能造出一个议程环节**：契约有
 *      `createAgendaSegment`，但全仓没有任何 controller 挂它（`project.controller.ts`
 *      只有 `.../advance`）。这是随 #493 上报的真实缺口，与 #467 那条「没有产品路径
 *      能启用 skill」同型，不是本脚本图省事。
 */
const boundTemplateTeamId = fixture.teams.fullstack;
if (!boundTemplateTeamId) throw new Error("fixture.teams.fullstack is required for the #493 seed");
await asApp(orgId, async (client) => {
  await client.query(
    `INSERT INTO canvas_templates
       (org_id, key, version, display_name, status, archived_from, builtin,
        visibility, owner_team_id, underlying_type, sections)
     VALUES ($1,$2,1,$3,'published',NULL,false,'team-only',$5,'canvas',$4::jsonb)
     ON CONFLICT (org_id, key, version) DO NOTHING`,
    [
      orgId, boundTemplateKey, boundTemplateName,
      JSON.stringify([
        { sectionId: "s1", name: "假设", order: 0, required: false, capacity: null },
        { sectionId: "s2", name: "证据", order: 1, required: false, capacity: null },
      ]),
      boundTemplateTeamId,
    ],
  );
  await client.query(
    `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
     VALUES ($1,$2,$3,0,$4,45,'active')
     ON CONFLICT (id) DO NOTHING`,
    [agendaSegmentId, orgId, projectId, agendaSegmentTitle],
  );
});

// ⚠ 刻意**没有**预置任何 capability_listings 行。#458 的浏览器门控要证的正是
// 「界面新建出来的那一条真的落进了 PostgreSQL」——先塞一条进去，
// 那条断言就会在「新建根本没生效」时照样绿。
await addBrowserArtifact({
  orgId, id: artifactId, projectId, source: "upload", title: sentinelFile,
  ingestionStatus: "READY", creator: { kind: "user", id: userId },
  text: `unique sentinel ${sentinelFile}`, sizeBytes: 387, mime: "text/markdown",
});

process.stdout.write(`[fullstack-fixture] db=${required("WORKSPACEX_DB")} project=${projectId} sentinel=${sentinelFile}\n`);
