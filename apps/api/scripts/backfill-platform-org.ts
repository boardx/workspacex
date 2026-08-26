/**
 * 一次性（幂等，可安全重跑）backfill：创建 B2 全局模板母版的**平台组织本体**及其
 * 维护身份。人类明确要求上线平台模板库时手动跑一次，**不 wire 进 `deploy.sh`**。
 *
 * ## 为什么这一步不能待在迁移里（2026-08-26 实测事故）
 *
 * 曾经放在迁移里，后果是**每一个跑过那份迁移的数据库**（含每一次测试用的隔离库）都
 * 无条件多出一个「有 admin 的组织」。`backfill-default-agents.ts` /
 * `backfill-deep-research-agent.ts` / `backfill-image-gen-agent.ts` 三个脚本都用
 * `FROM organizations o`（不限定哪个组织）+ `WHERE ... org_role = 'admin'` 找候选组织，
 * 于是这三个脚本的单测断言（"这个库里该有 N 个符合条件的组织"）全部多算一个，三个
 * CI shard 一起红。同 `20260805030000_canvas_template_registry.sql` 文件头那条纪律——
 * 本仓已经为了同一个理由不在迁移里 seed 内置模板，这里犯了一次一模一样的错，改法也一样：
 * 迁移只留 schema（`kind` 枚举、唯一索引、RLS 只读策略），数据由显式脚本种。
 *
 * ## 平台组织与它的维护身份
 *
 * `org-platform`（id 写死，恰好一个——`organizations_single_platform` 唯一索引兜底）。
 * 唯一的成员是 `svc-platform-templates`：`org_memberships.user_id` 没有外键指向任何
 * 用户表，登录凭据在另一张表 `auth_credentials`（`password_hash NOT NULL`）——所以
 * 一个只有成员行、没有凭据行的 user_id **结构上无法登录**，不是约定，是登录路径
 * 根本查不到它。
 *
 * 用法：`pnpm --filter api exec tsx scripts/backfill-platform-org.ts`（无参数——
 * 平台组织只有一个，不像 `backfill-canvas-builtin-templates.ts` 那样按组织传参）。
 */
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PLATFORM_ORG_ID } from "../src/domain/canvas/platform-org";

export interface PlatformOrgBackfillReport {
  readonly orgCreated: boolean;
  readonly membershipCreated: boolean;
}

const SERVICE_ACTOR_ID = "svc-platform-templates";

/**
 * `new PgDatabase(migrationConfig())` + `withoutTenant`：与 `seed-dev-account.ts` 完全
 * 同一个模式——写 `organizations`/`org_memberships` 这类**跨租户根表**必须用 owner
 * 连接（RLS 按 `app.current_org` 隔离，而这两张表本身就是在定义"什么是租户"，此刻
 * 还没有租户上下文可设）。`app_rw` 角色走不了这条路径。
 */
export async function backfillPlatformOrg(): Promise<PlatformOrgBackfillReport> {
  const db = new PgDatabase(migrationConfig());
  try {
    return await db.withoutTenant(async (s) => {
      const org = await s.query(
        `INSERT INTO organizations (id, name, kind, status, model_policy)
         VALUES ($1, '平台模板库', 'platform', 'active', 'any')
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [PLATFORM_ORG_ID],
      );
      const membership = await s.query(
        `INSERT INTO org_memberships (user_id, org_id, org_role, team_id)
         VALUES ($1, $2, 'admin', NULL)
         ON CONFLICT (user_id, org_id) DO NOTHING
         RETURNING user_id`,
        [SERVICE_ACTOR_ID, PLATFORM_ORG_ID],
      );
      return {
        orgCreated: org.rows.length > 0,
        membershipCreated: membership.rows.length > 0,
      };
    });
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await backfillPlatformOrg();
  console.log(
    `[backfill-platform-org] 完成：组织${report.orgCreated ? "已新建" : "已存在，跳过"}、` +
    `服务身份${report.membershipCreated ? "已新建" : "已存在，跳过"}。`,
  );
}
