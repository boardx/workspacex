/**
 * 一次性（幂等，可安全重跑）backfill CLI：创建 B2 全局模板母版的**平台组织本体**
 * 及其维护身份。
 *
 * issue #2343 起，真正的查询实现搬到了
 * `src/infrastructure/skill/ensure-platform-skill-catalog.ts`（`ensurePlatformOrgSeeded`）
 * ——那份文件的头注记录了原因：`deploy.sh` 4i 步依赖的"部署脚本已刷新到最新"这个
 * 前提在真实部署里没有被满足过，`workspacex-api` 进程自己的启动路径（`main.ts`）
 * 现在也会调用同一个函数自愈。这个 CLI 脚本保留下来，供仍需要手动单独跑一次的场景
 * （本地开发、故障排查）使用，导出的 `backfillPlatformOrg` 名字与行为逐字不变——
 * 真实测试（`platform-owned-skills-real-stack.test.ts`/
 * `platform-template-visibility.test.ts`）从这个路径 import，未受影响。
 *
 * ## 为什么这一步不能待在迁移里（2026-08-26 实测事故）
 *
 * 曾经放在迁移里，后果是**每一个跑过那份迁移的数据库**（含每一次测试用的隔离库）都
 * 无条件多出一个「有 admin 的组织」。同 `20260805030000_canvas_template_registry.sql`
 * 文件头那条纪律——迁移只留 schema，数据由显式脚本/应用启动路径种。
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
import {
  ensurePlatformOrgSeeded,
  type PlatformOrgBackfillReport,
} from "../src/infrastructure/skill/ensure-platform-skill-catalog";

export type { PlatformOrgBackfillReport };
export const backfillPlatformOrg = ensurePlatformOrgSeeded;

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await backfillPlatformOrg();
  console.log(
    `[backfill-platform-org] 完成：组织${report.orgCreated ? "已新建" : "已存在，跳过"}、` +
    `服务身份${report.membershipCreated ? "已新建" : "已存在，跳过"}。`,
  );
}
