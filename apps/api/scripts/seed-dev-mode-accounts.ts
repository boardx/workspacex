/**
 * seed-dev-mode-accounts.ts —— 一次性种下"开发模式"的 4 个预设账号,一个 `OrgRole` 一个。
 *
 * ## 解决的问题
 *
 * agent 跑 e2e / 手动验证功能时,经常先卡在账号上:没有账号可登录、要临时建、密码要
 * 现记现传、角色边界靠猜。这个脚本把 `@repo/dev-mode-accounts` 这份唯一事实源真的种进库,
 * 种完之后 admin/lead/consultant/compliance 四个角色各有一个固定邮箱/密码,agent 拿着
 * `@repo/dev-mode-accounts` 的常量就能走真实的 `POST /auth/login` 登录,不用现造账号。
 *
 * 和已有的 `seed-dev-account.ts` 是同一个模式(直接写三张真实表,绕过注册流程),区别是:
 *   · `seed-dev-account.ts` —— 单个账号,邮箱/密码/角色都由调用者用 env 传入,通用工具。
 *   · 这个脚本 —— 固定种 `@repo/dev-mode-accounts` 里那 4 个,不接受自定义邮箱/密码,
 *     专门给"开发模式"用,保证 agent 每次看到的都是同一份账号,不用每次现记。
 *
 * 4 个账号共用同一个组织(`DEV_MODE_ORG_NAME`),这样角色之间的权限边界(比如只有
 * lead 能建项目、admin 不是超级用户)在同一个组织里就能直接对比出来,不用跨组织。
 *
 * ## 生产环境硬门
 *
 * 先过 `assertDevModeAllowed()`——`NODE_ENV=production` 时直接抛错退出,不种任何东西。
 * 这不是可选的安全提示,是与 `KERNEL_ALLOW_TEST_PRINCIPAL` 同一套约定的强制门。
 *
 * ## 幂等
 *
 * 每个邮箱已存在就跳过,不覆盖——避免误跑把已经在用的密码冲掉(与 `seed-dev-account.ts`
 * 同一约定)。
 *
 * ## 用法
 *   WORKSPACEX_DEV_MODE=1 pnpm --filter api exec tsx scripts/seed-dev-mode-accounts.ts
 */
import { DEV_MODE_ACCOUNTS, DEV_MODE_ORG_NAME, assertDevModeAllowed, isDevModeEnabled } from "@repo/dev-mode-accounts";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import { newOrgId, newUserId, normalizeEmail } from "../src/domain/auth/registration";

assertDevModeAllowed();
if (!isDevModeEnabled()) {
  throw new Error(
    "拒绝种子:未显式打开 WORKSPACEX_DEV_MODE=1。开发模式账号只在明确要求时才种,不做静默默认行为。",
  );
}

const db = new PgDatabase(migrationConfig());
const hasher = new BcryptPasswordHasher();

await db.withoutTenant(async (s) => {
  // 4 个账号共用一个组织:同一组织名下第一次跑就建组织,后续跑复用已建好的那个。
  const existingOrg = await s.query<{ id: string }>(
    "SELECT id FROM organizations WHERE name = $1 AND kind = 'organization' LIMIT 1",
    [DEV_MODE_ORG_NAME],
  );
  let orgId = existingOrg.rows[0]?.id;
  if (!orgId) {
    orgId = newOrgId();
    await s.query("INSERT INTO organizations (id, name, kind, model_policy) VALUES ($1, $2, 'organization', 'any')", [
      orgId,
      DEV_MODE_ORG_NAME,
    ]);
    console.log(`  已建组织：${DEV_MODE_ORG_NAME}（${orgId}）`);
  } else {
    console.log(`  组织已存在，复用：${DEV_MODE_ORG_NAME}（${orgId}）`);
  }

  for (const account of DEV_MODE_ACCOUNTS) {
    const email = normalizeEmail(account.email);
    const existing = await s.query<{ user_id: string }>("SELECT user_id FROM credentials WHERE email = $1", [email]);
    if (existing.rows[0]) {
      console.log(`  已存在，跳过：${email}（role=${account.role}，user_id=${existing.rows[0].user_id}）`);
      continue;
    }

    const userId = newUserId();
    const passwordHash = await hasher.hash(account.password);

    await s.query("BEGIN");
    try {
      await s.query(
        `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
         VALUES ($1, $2, $3, $4, now())`,
        [userId, email, account.displayName, passwordHash],
      );
      await s.query("INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, $3, NULL)", [
        userId,
        orgId,
        account.role,
      ]);
      await s.query("COMMIT");
    } catch (e) {
      await s.query("ROLLBACK");
      throw e;
    }

    console.log(`  已建：${email}，role=${account.role}，user_id=${userId}`);
  }
});

console.log("done");
process.exit(0);
