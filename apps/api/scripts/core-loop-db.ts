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
} else {
  throw new Error(`usage: core-loop-db.ts <reset|stat> [email]; got ${JSON.stringify(command)}`);
}
