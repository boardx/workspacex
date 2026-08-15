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
 *   3. org_memberships（org_role 默认 admin —— 蓝本/画布模板/Skill 这类写路径的
 *      `canMutateCapabilities` 谓词只认 admin，lead 会在第一次真实操作时收到
 *      ROLE_INSUFFICIENT，见 #1315）
 *
 * 默认建 admin 是为了让「建一个能真实登录的账号」这句脚本头描述名副其实——
 * 账号建出来就该能走完常见的写路径，而不是先踩一遍权限坑再去改代码。
 * 如果只需要 list-projects.ts 那种「看得见组织下全部容器但改不了」的场景
 * （历史上 org_role=lead 的用途），传 SEED_ORG_ROLE=lead 显式要回来；
 * 非 admin/lead 的值直接报错退出，不做静默兜底。
 *
 * 幂等：邮箱已存在的账号直接跳过，不覆盖——避免误跑把已经在用的密码冲掉。
 *
 * 用法：
 *   SEED_EMAIL=you@example.com SEED_PASSWORD=<强密码> \
 *   SEED_DISPLAY_NAME=Dev SEED_ORG_NAME="Dev Org" SEED_ORG_ROLE=admin \
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

const VALID_ORG_ROLES = new Set(["admin", "lead"]);

function seedOrgRole(): "admin" | "lead" {
  const v = process.env.SEED_ORG_ROLE ?? "admin";
  if (!VALID_ORG_ROLES.has(v)) {
    throw new Error(
      `invalid SEED_ORG_ROLE "${v}"，只接受 admin 或 lead（默认 admin）`,
    );
  }
  return v as "admin" | "lead";
}

const email = normalizeEmail(req("SEED_EMAIL"));
const password = req("SEED_PASSWORD");
const displayName = process.env.SEED_DISPLAY_NAME ?? "Dev";
const orgName = process.env.SEED_ORG_NAME ?? "Dev Org";
const orgRole = seedOrgRole();

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
      "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, $3, NULL)",
      [userId, orgId, orgRole],
    );
    await s.query("COMMIT");
  } catch (e) {
    await s.query("ROLLBACK");
    throw e;
  }

  console.log(
    `  已建：${email}，org=${orgName}（${orgId}），user_id=${userId}，org_role=${orgRole}`,
  );
});

console.log("done");
process.exit(0);
