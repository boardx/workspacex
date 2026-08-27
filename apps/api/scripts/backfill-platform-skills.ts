/**
 * 一次性（幂等，可安全重跑）backfill：在平台组织（`org-platform`）下直接创建四个
 * 官方 skill 的 `skills`/`skill_versions`/`skill_version_files`/`capability_listings`
 * 行——design-delta `platform-owned-skills`。人类明确要求上线时手动跑一次，
 * **不 wire 进 `deploy.sh`**（同 `backfill-platform-org.ts`/
 * `backfill-canvas-builtin-templates.ts` 先例，理由见那两个文件头注记录过的
 * 2026-08-26 真实事故：迁移里 seed 数据会让每一个跑过迁移的库无条件多出几行）。
 *
 * ## 为什么不走 starter-pack 导入流程
 *
 * `pg-skill-starter-import-repository.ts` 的导入路径要求一个真实 org admin 身份
 * （`input.actorId`），而 `org-platform` 唯一成员 `svc-platform-templates` 结构上
 * 不可登录（`backfill-platform-org.ts` 头注）——没有一个真实会话能以它的身份发起
 * 一次导入请求。这里直接写库，跳过导入用例本身（同 `backfill-canvas-builtin-
 * templates.ts` 对 canvas 模板的做法一致：那也是直接建 `canvas_templates` 行，
 * 不走 `createTemplate`/`publishTemplate` 用例）。
 *
 * ## 前置条件：平台组织必须已存在
 *
 * 先跑 `backfill-platform-org.ts`（若还没跑过）。本脚本不建组织本体，只在
 * `organizations.id = PLATFORM_ORG_ID` 这一行已存在的前提下插 skill 行——外键
 * （`skills.org_id REFERENCES organizations(id)`）会诚实拒绝，不是本脚本自己校验。
 *
 * 用法：`pnpm --filter api exec tsx scripts/backfill-platform-skills.ts`
 */
import { createHash } from "node:crypto";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PLATFORM_ORG_ID, toOrgId } from "../src/domain/org-id";
import {
  DOCX_CREATE_SKILL_MD, PDF_CREATE_SKILL_MD, PPTX_CREATE_SKILL_MD, XLSX_CREATE_SKILL_MD,
} from "./office-docs-skill-content";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/** 服务身份——同 `backfill-platform-org.ts` 用的那一个，四个 skill 的 `creator_id`。 */
const SERVICE_ACTOR_ID = "svc-platform-templates";

interface OfficialSkillSpec {
  readonly skillId: string;
  readonly stableName: string;
  readonly displayName: string;
  readonly content: string;
}

/**
 * 四个官方 skill 的定义——**唯一事实源**。id 写死（不是 `randomUUID()`）：backfill
 * 脚本幂等靠的是"同一个 id 第二次 `ON CONFLICT DO NOTHING`"，一个每次运行都不同的
 * id 做不到这件事。
 */
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

export async function backfillPlatformSkills(): Promise<PlatformSkillsBackfillReport> {
  const db = new PgDatabase(migrationConfig());
  const created: string[] = [];
  const alreadyExisted: string[] = [];
  try {
    // ⚠ 实测纠正过一版：`withoutTenant` 在这里不够——`skill_version_files` 有一条
    // 显式触发器（`wave2_skill_file_insert_before_publish`，`20260804031000_wave2_
    // skill_starter_import.sql`）直接读 `current_setting('app.current_org', true)`
    // 校验，不经过 RLS（RLS 对 `migrationConfig()` 的 `postgres` 超级用户角色本来就
    // 会被绕过，`FORCE ROW LEVEL SECURITY` 管不到它），`withoutTenant` 从不设置这个
    // 会话变量，触发器读到 NULL、判定"租户不匹配"直接拒绝。改用 `withTenant`
    // 显式把租户设成 `PLATFORM_ORG_ID`——既满足这条触发器，也满足 `skills`/
    // `skill_versions` 表 RLS 的 `WITH CHECK`（虽然 `postgres` 角色本来就会绕过它）。
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
        // 与真实发布用例（`wave2_publish_skill_version`）走同一个数据库函数——不在
        // 这里手写第二份"怎样发布一个版本"的逻辑（`f979` 那份真栈测试的
        // `seedSkillVersion` 已经证明过这个函数在这类种子场景下工作正常）。
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
