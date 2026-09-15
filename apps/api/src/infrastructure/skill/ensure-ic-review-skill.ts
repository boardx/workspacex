/**
 * 「上会审阅」平台内置 Skill 的自愈种子——与四个官方 Office skill
 * （`ensure-platform-skill-catalog.ts`）同一条机制，但**刻意独立成一个文件**，
 * 不并进那四个：
 *
 * 1. 那四个是本仓永久基础设施（PPT/Word/Excel/PDF 生成，任何 Agent 都可能用到），
 *    这一个是 team1（上会材料智能审阅助手）临时 ad-hoc MVP 的专属内容——
 *    `docs/agents/team1-ic-review-mvp.md` 讲得很清楚这个 Agent 用完即删；
 *    混进永久目录（`PLATFORM_SKILL_CATALOG`）会让删除时牵连到不该动的代码。
 * 2. `officeSkillPackage()` 打包的是"预装库 + 有限编辑脚本"那一整套 Office 编辑
 *    协议文本，对一份纯方法论 markdown 完全用不上，硬套等于给这个 skill 塞一堆
 *    不相关的 Office 编辑指令。这里单独写一个只打包 `SKILL.md` 一个文件的最小版本。
 *
 * ## 为什么这是"代码层面"、不受运行时双人审核约束
 *
 * `createSkillDraft` → `submitSkillForReview` → `reviewSkillVersion` 那条运行时
 * 路径审的是"一个用户在界面上临时提交的 skill 该不该被授予能力"（`SELF_REVIEW_
 * FORBIDDEN`/`NO_SECOND_REVIEWER` 防的是这个人自己批准自己）。这里走的是四个
 * 官方 skill 那条路：内容在代码里、随 git PR 走人类 code review、用
 * `migrationConfig()`（owner/迁移身份）直接写库、`main.ts` 进程启动时自愈——
 * 审核已经在"这段代码该不该合入仓库"这一步完成了，运行时那道门审的是另一件事，
 * 不是同一张门的两把锁，不存在"绕过"。
 *
 * ## id/版本号单源
 *
 * `IC_REVIEW_SKILL_ID`/`IC_REVIEW_SKILL_VERSION_ID` 声明在
 * `apps/web/lib/ic-review/skill-identity.ts`（浏览器安全，前端挂载时也要用），
 * 这里反过来 import，不在两侧各自声明一次。
 */
import { createHash } from "node:crypto";
import { migrationConfig } from "../db/pg-config";
import { PgDatabase } from "../db/pg-database";
import { PLATFORM_ORG_ID, toOrgId } from "../../domain/org-id";
// 跨 src/scripts 与跨 apps/web 边界只搬正文/id 常量，不是逻辑——与
// ensure-platform-skill-catalog.ts 的同一条注释同一个理由（这两处都不在
// lint-arch-deps.mjs 的分层扫描范围内：一个是 `scripts/`，一个是另一个 app）。
import { IC_REVIEW_SKILL_MD } from "../../../scripts/ic-review-skill-content";
import { IC_REVIEW_SKILL_ID, IC_REVIEW_SKILL_VERSION_ID } from "../../../../web/lib/ic-review/skill-identity";

export { IC_REVIEW_SKILL_ID, IC_REVIEW_SKILL_VERSION_ID };

const SERVICE_ACTOR_ID = "svc-platform-templates";
const IC_REVIEW_STABLE_NAME = "ic-review-standard";
const IC_REVIEW_DISPLAY_NAME = "上会审阅";

export interface IcReviewSkillSeedReport {
  readonly created: boolean;
  readonly alreadyExisted: boolean;
}

/**
 * 前置条件同 `ensurePlatformSkillsSeeded`：`PLATFORM_ORG_ID` 这个组织必须已存在
 * （`ensurePlatformOrgSeeded()` 先跑过）——本函数不建组织本体。
 */
export async function ensureIcReviewSkillSeeded(): Promise<IcReviewSkillSeedReport> {
  const db = new PgDatabase(migrationConfig());
  try {
    return await db.withTenant(toOrgId(PLATFORM_ORG_ID), async (s) => {
      const now = new Date().toISOString();

      await s.query(
        `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
         VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)
         ON CONFLICT (id) DO NOTHING`,
        [IC_REVIEW_SKILL_ID, PLATFORM_ORG_ID, IC_REVIEW_DISPLAY_NAME],
      );

      const skillInsert = await s.query(
        `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [IC_REVIEW_SKILL_ID, PLATFORM_ORG_ID, IC_REVIEW_STABLE_NAME, IC_REVIEW_DISPLAY_NAME, SERVICE_ACTOR_ID, now],
      );

      const digest = createHash("sha256").update(IC_REVIEW_SKILL_MD).digest("hex");
      const existing = await s.query(
        `SELECT id, content_digest FROM skill_versions WHERE org_id=$1 AND skill_id=$2 AND id=$3`,
        [PLATFORM_ORG_ID, IC_REVIEW_SKILL_ID, IC_REVIEW_SKILL_VERSION_ID],
      );
      if (existing.rows.length > 0) {
        // 同一个版本 id 内容摘要不一致 ⇒ 有人改了正文却没同步升版本号（skill-identity.ts
        // 头注要求实质变化手动升 -v2），fail closed 而不是静默让线上停在旧内容。
        const row = existing.rows[0] as { content_digest: string };
        if (row.content_digest !== digest) {
          throw new Error(
            `ic-review skill version ${IC_REVIEW_SKILL_VERSION_ID} already exists with a different content digest ` +
            `— bump IC_REVIEW_SKILL_VERSION_ID in apps/web/lib/ic-review/skill-identity.ts before shipping this content change`,
          );
        }
        return { created: false, alreadyExisted: true };
      }

      await s.query(
        `INSERT INTO skill_versions
           (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
         VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,$7,false)
         ON CONFLICT (id) DO NOTHING`,
        [IC_REVIEW_SKILL_VERSION_ID, PLATFORM_ORG_ID, IC_REVIEW_SKILL_ID, `pkg-${digest}`, digest, SERVICE_ACTOR_ID, now],
      );
      await s.query(
        `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
         VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4) ON CONFLICT (version_id,path) DO NOTHING`,
        [PLATFORM_ORG_ID, IC_REVIEW_SKILL_VERSION_ID, Buffer.from(IC_REVIEW_SKILL_MD), digest],
      );
      // 与真实发布用例走同一个数据库函数——不在这里手写第二份"怎样发布一个版本"。
      await s.query("SELECT wave2_publish_skill_version($1,$2)", [PLATFORM_ORG_ID, IC_REVIEW_SKILL_VERSION_ID]);

      return { created: skillInsert.rows.length > 0, alreadyExisted: false };
    });
  } finally {
    await db.close();
  }
}
