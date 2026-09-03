/**
 * `PgAssetFileRepository` 对平台官方 skill 的读路径兜底——真栈复现（本次修复的 bug）。
 *
 * 根因：`getDirectory`/`readFile` 原来只按调用方自己的 `orgId` 查 `skill_versions`/
 * `skill_version_files`。四个官方 skill（`org_id = PLATFORM_ORG_ID`）永远不在调用方
 * 自己的组织下，于是「打开 Skill 编辑器」对任何一个平台 skill 都会把 `getDirectory`
 * 折叠成 `null`，前端表现为一路描述过的「接口错误：HTTP 404（已回退 mock）」——
 * 与 `platform-owned-skills-real-stack.test.ts`（V1-V6）覆盖的挂载/执行/目录列表
 * 四条读路径不同，这条读路径（`AssetFileRepository`）当时是唯一漏掉平台兜底的一处。
 *
 * 覆盖：
 *   ① 全新 org（从未导入过任何 skill）能读到平台 skill 的真实目录与文件正文，
 *      `readOnly: true`。
 *   ② 同一个 org 自己创建的 skill 仍然 `readOnly: false`（不是所有 skill 现在都变
 *      只读——这是反证，不能只加「永远 readOnly」这种更简单但错的修法）。
 *   ③ 写路径依然严格拒绝：调用方对平台 skill 的 `writeFile` 返回 `null`（折叠为
 *      `AssetNotFoundError` → 控制器层的 404），不会意外把平台版本发布出一个「组织
 *      自己的」新版本——同 `platform-owned-skills-real-stack.test.ts` V4 的写隔离
 *      结论，这次是从 `AssetFileRepository` 这一层单独证一次。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { backfillPlatformOrg } from "../../scripts/backfill-platform-org";
import { backfillPlatformSkills, OFFICIAL_SKILLS } from "../../scripts/backfill-platform-skills";
import { PgAssetFileRepository } from "../../src/infrastructure/asset/pg-asset-file-repository";
import { FixtureAssetFileRepository } from "../../src/infrastructure/asset/fixture-asset-file-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { sha256 } from "../../src/domain/skill/starter-pack";

const ORG = "org-i-platform-asset-file-repo";
const ACTOR = "u-i-platform-asset-file-repo";
const PLATFORM_SKILL = OFFICIAL_SKILLS.find((s) => s.stableName === "xlsx-create")!;

let repo: PgAssetFileRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  // 同 `platform-owned-skills-real-stack.test.ts`：平台组织/skill 都不由迁移种，
  // 显式跑一次 backfill（2026-08-26 事故先例，见该文件头注）。
  await backfillPlatformOrg();
  await backfillPlatformSkills();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i-platform-asset-file-repo" });
  repo = new PgAssetFileRepository(new PgDatabase(appConfig()), new FixtureAssetFileRepository());
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
  // ⚠ 不清理 org-platform 下的 skill 行——同 `platform-owned-skills-real-stack.test.ts`
  // 头注：发布过的 `skill_versions`/`skill_version_files` 被不可变触发器拒绝
  // DELETE/UPDATE，且 org-platform 是跨测试文件常驻的全局共享事实。
});

describe("PgAssetFileRepository -- 平台官方 skill 对全新 org 只读可见（本次修复）", () => {
  it("① 全新 org 从未导入过任何 skill，getDirectory 仍能读到平台 skill 的真实目录，readOnly=true", async () => {
    const dir = await repo.getDirectory(toOrgId(ORG), "skill", PLATFORM_SKILL.skillId);
    expect(dir).not.toBeNull();
    expect(dir!.rootFile).toBe("SKILL.md");
    expect(dir!.entries.map((e) => e.path)).toContain("SKILL.md");
    expect(dir!.currentVersionId).not.toBeNull();
    expect(dir!.readOnly).toBe(true);
  });

  it("① readFile 读到平台 skill SKILL.md 的真实正文（官方 skill 定义本身，不是 fixture/mock）", async () => {
    const file = await repo.readFile(toOrgId(ORG), "skill", PLATFORM_SKILL.skillId, "SKILL.md");
    expect(file).not.toBeNull();
    expect(file!.body).toContain(PLATFORM_SKILL.displayName);
  });

  it("③ 反证：调用方对平台 skill 的 writeFile 仍然返回 null——不会把平台版本写成组织自己的新版本", async () => {
    const file = await repo.readFile(toOrgId(ORG), "skill", PLATFORM_SKILL.skillId, "SKILL.md");
    const written = await repo.writeFile(
      toOrgId(ORG), "skill", PLATFORM_SKILL.skillId, "SKILL.md", `${file!.body}\n\n<!-- 篡改 -->\n`,
    );
    expect(written).toBeNull();

    // 平台那一份原样未变（不是"写成功了但这个会话看不到"）。
    const after = await repo.readFile(toOrgId(ORG), "skill", PLATFORM_SKILL.skillId, "SKILL.md");
    expect(after!.body).toBe(file!.body);
  });
});

describe("PgAssetFileRepository -- ②对照组：org 自己的 skill 不受这次修复影响，readOnly 仍为 false", () => {
  const SELF_SKILL = "sk-i-platform-asset-file-repo-self";
  const ROOT_BODY = "---\nname: 组织自建技能\n---\n\n# 组织自建技能\n";

  beforeAll(async () => {
    const versionId = `sv_${randomUUID()}`;
    const now = new Date().toISOString();
    await asApp(ORG, async (c) => {
      await c.query(
        `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6)`,
        [SELF_SKILL, ORG, SELF_SKILL, "组织自建技能", ACTOR, now],
      );
      await c.query(
        `INSERT INTO skill_versions
           (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
         VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,$6,false)`,
        [versionId, ORG, SELF_SKILL, sha256(ROOT_BODY), ACTOR, now],
      );
      await c.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,$2,'SKILL.md',$3,'text/markdown',$4)`,
        [ORG, versionId, Buffer.from(ROOT_BODY, "utf8"), sha256(ROOT_BODY)],
      );
      await c.query("SELECT wave2_publish_skill_version($1, $2)", [ORG, versionId]);
    });
  });

  it("getDirectory 对自己组织的 skill 仍然 readOnly=false，且可写", async () => {
    const dir = await repo.getDirectory(toOrgId(ORG), "skill", SELF_SKILL);
    expect(dir).not.toBeNull();
    expect(dir!.readOnly).toBe(false);

    const written = await repo.writeFile(toOrgId(ORG), "skill", SELF_SKILL, "SKILL.md", `${ROOT_BODY}\n改过了\n`);
    expect(written).not.toBeNull();
    expect(written!.body).toContain("改过了");
  });
});
