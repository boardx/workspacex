/**
 * seed-dev-account.ts —— 建一个能真实登录的账号，绕过注册流程。
 *
 * 为什么需要这个：注册（UC-1.5）要走邀请码 + 邮箱验证，那条链路本身还没实现
 * （只有 F19 建组织织那部分做完）。devapp.boardx.us 上线后数据库里没有任何真实
 * 账号，登录页无从测起——不是登录逻辑有 bug，是没有账号可以登录。
 *
 * 只做三件事，走已迁移好的真实表结构，不碰任何应用层用例：
 *   1. organizations（kind=organization）
 *   2. credentials（bcrypt cost=12，跟 BcryptPasswordHasher 完全同一套）
 *   3. org_memberships（org_role=lead —— list-projects.ts 的规则下，lead/admin
 *      不需要 project_memberships 也能看到组织下全部容器的 managed 段）
 *
 * 幂等：邮箱已存在的账号直接跳过，不覆盖——避免误跑把已经在用的密码冲掉。
 *
 * 用法：
 *   SEED_EMAIL=you@example.com SEED_PASSWORD=<强密码> \
 *   SEED_DISPLAY_NAME=Dev SEED_ORG_NAME="Dev Org" \
 *     pnpm --filter api exec tsx scripts/seed-dev-account.ts
 *
 * SEED_PASSWORD 没有默认值——不传就报错退出，不会意外用可猜测的默认密码建账号。
 */
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import { newOrgId, newUserId, normalizeEmail } from "../src/domain/auth/registration";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

const email = normalizeEmail(req("SEED_EMAIL"));
const password = req("SEED_PASSWORD");
const displayName = process.env.SEED_DISPLAY_NAME ?? "Dev";
const orgName = process.env.SEED_ORG_NAME ?? "Dev Org";

const db = new PgDatabase(migrationConfig());
const hasher = new BcryptPasswordHasher();

await db.withoutTenant(async (s) => {
  const existing = await s.query<{ user_id: string }>(
    "SELECT user_id FROM credentials WHERE email = $1",
    [email],
  );
  if (existing.rows[0]) {
    console.log(`  已存在，跳过：${email}（user_id=${existing.rows[0].user_id}）`);
    return;
  }

  const orgId = newOrgId();
  const userId = newUserId();
  const passwordHash = await hasher.hash(password);

  await s.query("BEGIN");
  try {
    await s.query(
      "INSERT INTO organizations (id, name, kind, model_policy) VALUES ($1, $2, 'organization', 'any')",
      [orgId, orgName],
    );
    await s.query(
      `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4, now())`,
      [userId, email, displayName, passwordHash],
    );
    await s.query(
      "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, 'lead', NULL)",
      [userId, orgId],
    );
    await s.query("COMMIT");
  } catch (e) {
    await s.query("ROLLBACK");
    throw e;
  }

  console.log(`  已建：${email}，org=${orgName}（${orgId}），user_id=${userId}`);
});

console.log("done");
process.exit(0);
