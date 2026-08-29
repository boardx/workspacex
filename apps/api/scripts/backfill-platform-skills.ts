/**
 * 一次性（幂等，可安全重跑）backfill CLI：在平台组织（`org-platform`）下直接创建
 * 四个官方 skill 的 `skills`/`skill_versions`/`skill_version_files`/
 * `capability_listings` 行——design-delta `platform-owned-skills`。
 *
 * issue #2343 起，真正的查询实现搬到了
 * `src/infrastructure/skill/ensure-platform-skill-catalog.ts`
 * （`ensurePlatformSkillsSeeded`）——那份文件的头注记录了原因：`deploy.sh` 4j 步
 * 依赖的"部署脚本已刷新到最新"这个前提在真实部署里没有被满足过，`workspacex-api`
 * 进程自己的启动路径（`main.ts`）现在也会调用同一个函数自愈。这个 CLI 脚本保留
 * 下来，供仍需要手动单独跑一次的场景（本地开发、故障排查）使用，导出的
 * `backfillPlatformSkills`/`OFFICIAL_SKILLS` 名字与行为逐字不变——真实测试
 * （`platform-owned-skills-real-stack.test.ts`）从这个路径 import，未受影响。
 *
 * ## 为什么不走 starter-pack 导入流程
 *
 * `pg-skill-starter-import-repository.ts` 的导入路径要求一个真实 org admin 身份
 * （`input.actorId`），而 `org-platform` 唯一成员 `svc-platform-templates` 结构上
 * 不可登录（`backfill-platform-org.ts` 头注）——没有一个真实会话能以它的身份发起
 * 一次导入请求。这里直接写库，跳过导入用例本身。
 *
 * ## 前置条件：平台组织必须已存在
 *
 * 先跑 `backfill-platform-org.ts`（若还没跑过）。本脚本不建组织本体，只在
 * `organizations.id = PLATFORM_ORG_ID` 这一行已存在的前提下插 skill 行——外键
 * （`skills.org_id REFERENCES organizations(id)`）会诚实拒绝，不是本脚本自己校验。
 *
 * 用法：`pnpm --filter api exec tsx scripts/backfill-platform-skills.ts`
 */
import {
  ensurePlatformSkillsSeeded,
  OFFICIAL_SKILLS,
  type PlatformSkillsBackfillReport,
} from "../src/infrastructure/skill/ensure-platform-skill-catalog";

export { OFFICIAL_SKILLS };
export type { PlatformSkillsBackfillReport };
export const backfillPlatformSkills = ensurePlatformSkillsSeeded;

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await backfillPlatformSkills();
  console.log(
    `[backfill-platform-skills] 完成：新建 ${String(report.created.length)} 个` +
    (report.created.length > 0 ? `（${report.created.join(", ")}）` : "") +
    `，${String(report.alreadyExisted.length)} 个已存在跳过` +
    (report.alreadyExisted.length > 0 ? `（${report.alreadyExisted.join(", ")}）` : "") +
    "。",
  );
}
