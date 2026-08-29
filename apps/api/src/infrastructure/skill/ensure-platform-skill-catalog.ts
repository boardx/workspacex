/**
 * issue #2343 —— 让"平台组织 + 四个官方 skill 存在"这件事不再依赖任何人手动
 * SSH 上真实部署机重跑一次脚本。
 *
 * ## 真实事故经过（不是预防性设计，是复盘出来的）
 *
 * design-delta `platform-owned-skills` 把四个官方 skill（pptx/docx/xlsx/pdf-create）
 * 的种子数据设计成"人类明确要求上线时手动跑一次" —— `backfill-platform-org.ts` /
 * `backfill-platform-skills.ts` 两个 CLI 脚本，`deploy.sh` 4i/4j 两步调它们。
 *
 * 但 `deploy.sh` 本身不是每次部署都执行仓库里的版本：`backend-gates.yml` 的部署 job
 * 走 `sudo /usr/local/bin/workspacex-deploy`——一份由 `provision.sh` 第 7 步手动
 * `install` 上真实 VM 的特权副本，**不会**随 `git push` 自动刷新。#2296 把 4i/4j
 * 两步加进了仓库里的 `deploy.sh`，但没有人再手动 SSH 上去刷新那份特权副本，于是
 * 这两步在 devapp 上从未真正执行过一次——`GET /skills` 查询逻辑本身完全正确
 * （`pg-skill-contract-repository.ts` 的 `listAll` 早就把 `PLATFORM_ORG_ID` 纳入
 * OR 条件），只是数据从来没被种进去。人类实测：chat 里的 `#` 挂载候选、composer
 * 挂载浮层，`pdf-create` 一个都看不到。
 *
 * 这与 #2296 本身要修的问题同源（"合并后忘了手动做一件事"），只是换了一层——
 * 这次不能再指望"下一次别忘了"，得让它在**不需要任何人手动介入**的路径上自愈。
 *
 * ## 修法：从"部署脚本里的一步"搬到"应用进程自己的启动逻辑"
 *
 * `deploy.sh` 的 4i/4j 两步依赖的是"部署脚本被刷新"这件事——这正是会漂移、会被
 * 忘记的一环。`apps/api`（`workspacex-api` 进程）本身的代码，每次部署的第 1-6 步
 * （拉代码、装依赖、构建、重启服务）**从来没有过这个问题**——那几步年年都在正确
 * 执行，devapp 上跑的 API 进程一直是当次提交的最新代码。
 *
 * 把这两个 backfill 挂到 `main.ts` 的进程入口（`isProcessEntry()` 为真、也就是
 * `workspacex-api` 真的作为独立进程启动时，见该文件own doc），API 进程每次真实
 * 启动都会自愈一次——不再依赖部署脚本的哪个版本在跑，不再依赖有没有人记得刷新
 * 特权副本，不再依赖有没有人记得手动 SSH。两个函数本来就幂等（`ON CONFLICT DO
 * NOTHING`），重复调用与只调用一次的最终状态完全相同。
 *
 * ⚠ **不在这里改变 CLI 脚本的对外行为**：`apps/api/scripts/backfill-platform-
 * org.ts`/`backfill-platform-skills.ts` 两个文件保留原有的 `backfillPlatformOrg`/
 * `backfillPlatformSkills`/`OFFICIAL_SKILLS` 导出（真实测试 `platform-owned-
 * skills-real-stack.test.ts`/`platform-template-visibility.test.ts` 都从那两个
 * 路径 import），只是把查询实现搬到这里、脚本本身改成薄封装——避免同一段 SQL
 * 逐字声明两份（AGENTS.md 反复提醒的那条纪律）。`deploy.sh` 4i/4j 两步保留不删：
 * 一旦将来有人真的刷新了那份特权副本，两条自愈路径同时生效也完全无害（都是
 * `ON CONFLICT DO NOTHING`）——这是双保险，不是互斥的两个方案。
 */
import { createHash } from "node:crypto";
import { migrationConfig } from "../db/pg-config";
import { PgDatabase } from "../db/pg-database";
import { PLATFORM_ORG_ID, toOrgId } from "../../domain/org-id";
// 跨 src/scripts 边界只搬四段 skill 正文常量，不是逻辑——`lint-arch-deps.mjs` 只扫
// domain/application/infrastructure/interface 四个已知分层目录名，`scripts/` 不在
// 其中，`layerOf()` 对非分层路径返回 null 时直接放行，不会被判违规。
import {
  DOCX_CREATE_SKILL_MD, PDF_CREATE_SKILL_MD, PPTX_CREATE_SKILL_MD, XLSX_CREATE_SKILL_MD,
} from "../../../scripts/office-docs-skill-content";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/** 两个 backfill 共用的服务身份——`org-platform` 唯一成员，结构上不可登录
 *  （见下方 `ensurePlatformOrgSeeded` 的头注）。 */
const SERVICE_ACTOR_ID = "svc-platform-templates";

export interface PlatformOrgBackfillReport {
  readonly orgCreated: boolean;
  readonly membershipCreated: boolean;
}

/**
 * `new PgDatabase(migrationConfig())` + `withoutTenant`：与 `seed-dev-account.ts`
 * 同一个模式——写 `organizations`/`org_memberships` 这类跨租户根表必须用 owner
 * 连接（RLS 按 `app.current_org` 隔离，而这两张表本身就是在定义"什么是租户"，
 * 此刻还没有租户上下文可设）。`app_rw` 角色走不了这条路径。
 */
export async function ensurePlatformOrgSeeded(): Promise<PlatformOrgBackfillReport> {
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

interface OfficialSkillSpec {
  readonly skillId: string;
  readonly stableName: string;
  readonly displayName: string;
  readonly content: string;
}

/** 四个官方 skill 的定义——唯一事实源。id 写死，幂等靠"同一个 id 第二次
 *  `ON CONFLICT DO NOTHING`"。 */
export const OFFICIAL_SKILLS: readonly OfficialSkillSpec[] = [
  { skillId: "skill-platform-pptx-create", stableName: "pptx-create", displayName: "演示文稿生成", content: PPTX_CREATE_SKILL_MD },
  { skillId: "skill-platform-docx-create", stableName: "docx-create", displayName: "Word 文档生成", content: DOCX_CREATE_SKILL_MD },
  { skillId: "skill-platform-xlsx-create", stableName: "xlsx-create", displayName: "Excel 表格生成", content: XLSX_CREATE_SKILL_MD },
  { skillId: "skill-platform-pdf-create", stableName: "pdf-create", displayName: "PDF 文档生成", content: PDF_CREATE_SKILL_MD },
];

export interface PlatformSkillsBackfillReport {
  readonly created: readonly string[];
  readonly alreadyExisted: readonly string[];
}

/** 前置条件：`ensurePlatformOrgSeeded()` 必须先跑过（`skills.org_id` 外键指向
 *  `organizations.id`，顺序反过来会被外键诚实拒绝，不是这个函数自己校验）。 */
export async function ensurePlatformSkillsSeeded(): Promise<PlatformSkillsBackfillReport> {
  const db = new PgDatabase(migrationConfig());
  const created: string[] = [];
  const alreadyExisted: string[] = [];
  try {
    // ⚠ `withoutTenant` 在这里不够——`skill_version_files` 有一条显式触发器
    // （`wave2_skill_file_insert_before_publish`）直接读 `current_setting
    // ('app.current_org', true)` 校验，不经过 RLS。改用 `withTenant` 显式把
    // 租户设成 `PLATFORM_ORG_ID`。
    await db.withTenant(toOrgId(PLATFORM_ORG_ID), async (s) => {
      for (const spec of OFFICIAL_SKILLS) {
        const versionId = `${spec.skillId}-v1`;
        const now = new Date().toISOString();

        const skillInsert = await s.query(
          `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [spec.skillId, PLATFORM_ORG_ID, spec.stableName, spec.displayName, SERVICE_ACTOR_ID, now],
        );
        if (skillInsert.rows.length === 0) {
          alreadyExisted.push(spec.stableName);
          continue;
        }

        await s.query(
          `INSERT INTO skill_versions
             (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
           VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,$6,false)
           ON CONFLICT (id) DO NOTHING`,
          [versionId, PLATFORM_ORG_ID, spec.skillId, sha256(spec.content), SERVICE_ACTOR_ID, now],
        );
        await s.query(
          `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
           VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)
           ON CONFLICT (version_id, path) DO NOTHING`,
          [PLATFORM_ORG_ID, versionId, Buffer.from(spec.content, "utf8"), sha256(spec.content)],
        );
        // 与真实发布用例走同一个数据库函数——不在这里手写第二份"怎样发布一个版本"。
        await s.query("SELECT wave2_publish_skill_version($1,$2)", [PLATFORM_ORG_ID, versionId]);

        await s.query(
          `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
           VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)
           ON CONFLICT (id) DO NOTHING`,
          [`cap-${spec.skillId}`, PLATFORM_ORG_ID, spec.displayName],
        );

        created.push(spec.stableName);
      }
    });
    return { created, alreadyExisted };
  } finally {
    await db.close();
  }
}

export interface PlatformSkillCatalogSeedReport {
  readonly org: PlatformOrgBackfillReport;
  readonly skills: PlatformSkillsBackfillReport;
}

/**
 * `main.ts` 进程入口调用的唯一入口——两步顺序执行（org 必须先于 skills，见
 * `ensurePlatformSkillsSeeded` 的前置条件注释）。**从不 throw**：调用方（应用
 * 启动路径）不该因为这段自愈逻辑一次性失败就整个进程起不来——那样一次数据库
 * 抖动就会把"平台 skill 缺失"换成"API 整个打不开"，后果更糟。失败原样记录在
 * 返回值里，调用方决定怎么记日志。
 */
export async function ensurePlatformSkillCatalogSeeded(): Promise<
  { readonly ok: true; readonly report: PlatformSkillCatalogSeedReport } | { readonly ok: false; readonly error: unknown }
> {
  try {
    const org = await ensurePlatformOrgSeeded();
    const skills = await ensurePlatformSkillsSeeded();
    return { ok: true, report: { org, skills } };
  } catch (error) {
    return { ok: false, error };
  }
}
