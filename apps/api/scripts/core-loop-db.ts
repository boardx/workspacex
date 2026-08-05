/**
 * #492 步骤 1「注册**第一个**用户」的库侧支撑。
 *
 * ## 为什么需要它
 *
 * `core-loop.spec.ts` 的第一步要验的是「**第一个**用户自动成为管理员」。这件事一旦
 * 库里已经有账号就永远验不了 —— `PgRegistrationRepository.isFirstUserBootstrapAvailable()`
 * 的条件是 `auth_bootstrap_state` 无行 **且** `credentials` 无行，两者任一非空就永久关门。
 * 而 `playwright.fullstack-smoke.config.ts` 的 `webServer[0].command` 里写死了
 * `seed-fullstack-smoke.ts`，`webServer` 又是 **config 级**而不是 project 级，
 * 因此「让某个 project 不跑 seed」在那一层做不到。
 *
 * ⇒ 换个做法：让 seed 照跑，然后在 Playwright 的 `core-loop-reset` setup project 里
 *   **把库清回零用户**，并用 project `dependencies` 保证它排在依赖种子的 spec **之后**。
 *   清库这件事必须在 `apps/api` 侧做（`apps/web/e2e/**` 里没有也不该有 PG 客户端），
 *   本脚本就是那个入口。
 *
 * ## 为什么必须以 OWNER 身份跑
 *
 * `auth_bootstrap_state` 的迁移里 `REVOKE UPDATE, DELETE ... FROM app_rw` —— 应用角色
 * **无权**清掉那个一次性标记（这是对的：账号清理不许重新打开公开的 seed-admin 通道）。
 * 所以复位只能走 `asOwner`（迁移角色 = 超级用户，绕过 RLS）。这也正是为什么复位
 * 是一件**测试装置**而不是产品能力。
 *
 * ## 用法
 *
 *   tsx scripts/core-loop-db.ts reset          # 清成零用户，重新打开 bootstrap 门
 *   tsx scripts/core-loop-db.ts stat <email>   # 打印当前库态，供 spec 断言
 *
 * `stat` 的输出前缀是 `__CORE_LOOP_DB__`，后面跟一行 JSON —— 调用方从**噪声很多的**
 * pnpm 输出里按这个前缀抠，而不是假设 stdout 只有 JSON。
 *
 * ## ⚠ 反证开关（#492 硬性验收第 2 条）
 *
 *   CORE_LOOP_COUNTERPROOF=1 tsx scripts/core-loop-db.ts reset
 *
 * 清完之后**故意再种回一个用户**。这时步骤 1 必须变红 —— 它若还绿，说明那条断言
 * 验的不是「第一个」而是「恰好没人注册过」，从第一天起就是空转的。
 * 复现整条门控：`CORE_LOOP_COUNTERPROOF=1 pnpm run verify:fullstack-smoke`。
 */
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import { asOwner, ensureDatabase, migrateOnce } from "../tests/support/db";

/** 反证用的假账号。名字带 COUNTERPROOF，任何人在库里看见它都知道这是干什么的。 */
const COUNTERPROOF_USER = {
  userId: "user-core-loop-counterproof",
  email: "core-loop-counterproof@example.test",
  displayName: "CORE_LOOP_COUNTERPROOF",
  password: "Core-Loop-counterproof-492!",
} as const;

interface CoreLoopDbStat {
  /** 全库账号数。步骤 1 的前提断言就是它 === 0。 */
  readonly credentials: number;
  /** 一次性 bootstrap 标记是否已被消费。已消费 = 门永久关闭。 */
  readonly bootstrapConsumed: boolean;
  /** 该邮箱在 `kind='organization'` 的组织里的角色。「自动成为管理员」= 它是 `["admin"]`。 */
  readonly orgRoles: readonly string[];
  /** 该邮箱所属正式组织的名字。用来证明注册出来的是**表单里填的那个**组织。 */
  readonly orgNames: readonly string[];
}

/**
 * #435 步骤 8b 的库侧证据。
 *
 * ## 为什么必须数库，而不是数「成功了几次」
 *
 * 「恰好一条回复」的反面不是「一次也没成功」，而是**成功了但写了两条**。
 * 只断言「出现了一条 agent 回复」或「run succeeded」，在一个每次重试都追加一行的
 * 坏实现下**照样全绿**（本仓 #19 就是这么踩的）。所以这里取的是**最终条数**。
 *
 * ## 为什么不在 `apps/web/e2e/**` 里直连 PG
 *
 * 同 `core-loop-fixture.ts` 文件头：schema、角色划分、RLS 策略都住在 `apps/api`，
 * 在 web 侧另起一个 pg 客户端等于把这些事实抄第二份。
 */
interface CoreLoopRunStat {
  /** `agent_runs.status` 的原值；run 不存在时为 null。 */
  readonly runStatus: string | null;
  readonly runError: string | null;
  /** **这一条就是 exactly-once 的证据**：挂在该 run 上的 agent 消息条数。 */
  readonly assistantMessages: number;
  /** 回复正文，用来证明它确实出自被显式选中的那个 provider，而不是前端合成的。 */
  readonly assistantTexts: readonly string[];
  /** 每条回复回指的 human 消息，证明 `replyToMessageId` 链是接上的。 */
  readonly replyToMessageIds: readonly string[];
  /** 该 run 所属线程里的消息总数。用来抓「回复写对了但顺手多插了别的行」。 */
  readonly threadMessages: number;
}

async function runStat(runId: string): Promise<CoreLoopRunStat> {
  return asOwner(async (client) => {
    const run = await client.query<{ status: string; error_code: string | null; thread_id: string }>(
      "SELECT status, error_code, thread_id FROM agent_runs WHERE id = $1",
      [runId],
    );
    const found = run.rows[0];
    const replies = await client.query<{ body: string; reply_to_message_id: string | null }>(
      `SELECT body, reply_to_message_id FROM chat_messages
        WHERE agent_run_id = $1 AND author_kind = 'agent'
        ORDER BY id`,
      [runId],
    );
    const threadMessages = found === undefined ? 0 : Number((await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM chat_messages WHERE thread_id = $1",
      [found.thread_id],
    )).rows[0]?.n ?? "0");
    return {
      runStatus: found?.status ?? null,
      runError: found?.error_code ?? null,
      assistantMessages: replies.rowCount ?? 0,
      assistantTexts: replies.rows.map((r) => r.body),
      replyToMessageIds: replies.rows.map((r) => r.reply_to_message_id ?? ""),
      threadMessages,
    };
  });
}

/**
 * ⚠ #435 的**反证装置**：把「恰好一条」故意变成两条。
 *
 * 承载 exactly-once 的是那条唯一索引：
 *   `chat_messages_agent_run_idx ON chat_messages (org_id, agent_run_id)
 *      WHERE author_kind='agent' AND agent_run_id IS NOT NULL`
 *   （`migrations/20260804060000_wave2_chat_message_acceptance.sql:16-18`）
 *
 * 所以反证必须**先把索引摘掉**再插第二条 —— 索引还在的话 Postgres 会直接拒绝，
 * 那证明的是「库拦得住」，却证明不了「**断言**抓得住」。而后者才是这次要验的东西：
 * 一条抓不住重复的断言，在索引哪天被人误删时会安静地放行。
 *
 * 这只跑在 `CORE_LOOP_COUNTERPROOF_8B=1` 下，且改的是**用完即弃的隔离库**
 * （每个 worker 有自己的 `WORKSPACEX_DB`，跑完 `docker compose down -v` 整个销毁）。
 * 它**不**碰产品代码，也不改迁移文件。
 */
async function counterproofDuplicateReply(runId: string): Promise<void> {
  await asOwner(async (client) => {
    const existing = await client.query<{
      org_id: string; thread_id: string; author_id: string; agent_id: string | null;
      body: string; reply_to_message_id: string | null;
    }>(
      `SELECT org_id, thread_id, author_id, agent_id, body, reply_to_message_id
         FROM chat_messages WHERE agent_run_id = $1 AND author_kind = 'agent'`,
      [runId],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      throw new Error(
        `COUNTERPROOF 8b: run ${runId} 上没有任何 agent 回复，无法制造重复。` +
        "这说明红点在写回**之前**就发生了 —— 那不是本反证要验的东西。",
      );
    }
    await client.query("DROP INDEX IF EXISTS chat_messages_agent_run_idx");
    await client.query(
      `INSERT INTO chat_messages
         (id,org_id,thread_id,author_kind,author_id,agent_id,body,agent_run_id,reply_to_message_id)
       VALUES (gen_random_uuid()::text,$1,$2,'agent',$3,$4,$5,$6,$7)`,
      [row.org_id, row.thread_id, row.author_id, row.agent_id,
        `${row.body} [COUNTERPROOF DUPLICATE]`, runId, row.reply_to_message_id],
    );
  });
  process.stdout.write(
    `[core-loop-db] COUNTERPROOF 8b: 已摘掉 chat_messages_agent_run_idx 并给 run ${runId} ` +
    "插入第二条回复，步骤 8b 的 exactly-once 断言必须变红\n",
  );
}

async function reset(): Promise<void> {
  ensureDatabase();
  await migrateOnce();
  await asOwner(async (client) => {
    // 顺序无关紧要（两张表之间没有外键），但都得清：
    // 只清 credentials 而留着标记，门依然是关的 —— 那会让步骤 1 红得毫无信息量。
    await client.query("DELETE FROM auth_bootstrap_state");
    // ON DELETE CASCADE 带走 sessions / devices 等挂在 credentials 上的行。
    await client.query("DELETE FROM credentials");
    // 组织不挂在 credentials 上，得单独清；CASCADE 带走 teams / projects / memberships。
    await client.query("DELETE FROM organizations");
  });

  if (process.env.CORE_LOOP_COUNTERPROOF === "1") {
    const passwordHash = await new BcryptPasswordHasher().hash(COUNTERPROOF_USER.password);
    await asOwner((client) => client.query(
      `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4, now())`,
      [COUNTERPROOF_USER.userId, COUNTERPROOF_USER.email, COUNTERPROOF_USER.displayName, passwordHash],
    ));
    process.stdout.write("[core-loop-db] COUNTERPROOF: 复位后又种回一个用户，步骤 1 必须变红\n");
  }
}

async function stat(email: string): Promise<CoreLoopDbStat> {
  return asOwner(async (client) => {
    const credentials = await client.query<{ n: string }>("SELECT count(*) AS n FROM credentials");
    const marker = await client.query<{ consumed: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM auth_bootstrap_state WHERE singleton = true) AS consumed",
    );
    // 只看 kind='organization'。bootstrap 同时还会建一个 personal-local 组织并把人放进去
    // （见 `insertPersonalLocalOrg`），把两者混在一起断言等于把「他在自己的本地组织里当然是
    // admin」也算成证据 —— 那条恒真，不能拿来证明「自动成为**组织**管理员」。
    const rows = await client.query<{ org_role: string; name: string }>(
      `SELECT m.org_role, o.name
         FROM org_memberships m
         JOIN credentials c ON c.user_id = m.user_id
         JOIN organizations o ON o.id = m.org_id
        WHERE c.email = $1 AND o.kind = 'organization'
        ORDER BY m.org_role, o.name`,
      [email],
    );
    return {
      credentials: Number(credentials.rows[0]?.n ?? "0"),
      bootstrapConsumed: marker.rows[0]?.consumed === true,
      orgRoles: rows.rows.map((r) => r.org_role),
      orgNames: rows.rows.map((r) => r.name),
    };
  });
}

const command = process.argv[2] ?? "";
if (command === "reset") {
  await reset();
  const after = await stat("");
  process.stdout.write(`__CORE_LOOP_DB__${JSON.stringify(after)}\n`);
} else if (command === "stat") {
  process.stdout.write(`__CORE_LOOP_DB__${JSON.stringify(await stat(process.argv[3] ?? ""))}\n`);
} else if (command === "run-stat") {
  ensureDatabase();
  process.stdout.write(`__CORE_LOOP_DB__${JSON.stringify(await runStat(process.argv[3] ?? ""))}\n`);
} else if (command === "counterproof-duplicate-reply") {
  ensureDatabase();
  await counterproofDuplicateReply(process.argv[3] ?? "");
  process.stdout.write(`__CORE_LOOP_DB__${JSON.stringify(await runStat(process.argv[3] ?? ""))}\n`);
} else {
  throw new Error(
    "usage: core-loop-db.ts <reset|stat|run-stat|counterproof-duplicate-reply> [email|runId]; " +
    `got ${JSON.stringify(command)}`,
  );
}
