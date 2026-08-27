/**
 * 2026-08-07 真实复现（人类实测报告："我在后台不能看到导入了的 skills"）。
 *
 * `GET /skills`（后台"Skill 目录"页读的那个端口）此前只读 `skill_contracts`（#459 的
 * 声明式契约 skill）。URL 导入（#595/#600）写的是完全独立的另一张表
 * `skills`/`skill_versions`（wave2 模型，agent 执行时唯一真读的那套）——两套模型互不
 * 知道对方存在，导入成功、能在 chat 里真实执行，却在后台列表里彻底不可见。
 *
 * 这份测试直接在库里造一行"URL 导入落库后"的真实形状（不走真实 HTTPS 拉取——那是
 * `skill-url-import.controller.ts` 自己的测试范围，这里只关心"落库之后 GET /skills
 * 能不能看到它"），与一条 `skill_contracts` 的草稿并列存在，断言两者都出现在同一次
 * 列表响应里。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createHash, randomUUID } from "node:crypto";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { OFFICIAL_SKILLS } from "../../scripts/backfill-platform-skills";

/** design-delta `platform-owned-skills`——见 `skill-contract-crud.test.ts` 顶部同名注释。 */
const isOfficialPlatformSkill = (skillId: string): boolean =>
  OFFICIAL_SKILLS.some((s) => s.skillId === skillId);

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i662-skill-catalog-unify";
const ADMIN = "u-i662-skill-catalog-admin";
const WAVE2_SKILL_ID = "sk-i662-catalog-unify-test";
const WAVE2_SKILL_NAME = "手机对话小助手（wave2 导入测试）";

let app: NestExpressApplication;
let BASE = "";

const principal = { "x-kernel-test-principal": `${ADMIN}:${ORG}`, "content-type": "application/json" };
const listPath = `${C.operations.listSkills.path}?orgId=${ORG}&entry=library`;

/**
 * 照抄 `pg-skill-url-import-repository.ts` 落库之后的真实形状：`skills` 一行 +
 * `skill_versions` 一行草稿 + `skill_version_files` 的 `SKILL.md` 一行，再走
 * `wave2_publish_skill_version()`（唯一合法发布路径，见该函数定义：草稿态之外一律拒）
 * 把草稿翻成已发布——不直接 INSERT `published=true`，那条路径本来就不存在。
 */
async function seedWave2Skill(): Promise<void> {
  const versionId = `sv-i662-${randomUUID()}`;
  const content = "# 测试技能\n\n用于验证后台目录能看到 wave2 导入的 skill。";
  const digest = createHash("sha256").update(content).digest("hex");
  await asApp(ORG, async (c) => {
    await c.query(
      "INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())",
      [WAVE2_SKILL_ID, ORG, "i662-catalog-unify-test", WAVE2_SKILL_NAME, ADMIN],
    );
    await c.query(
      `INSERT INTO skill_versions (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
       VALUES ($1,$2,$3,'v1',$4,$5,$6,now(),false)`,
      [versionId, ORG, WAVE2_SKILL_ID, digest, JSON.stringify({ files: ["SKILL.md"] }), ADMIN],
    );
    await c.query(
      "INSERT INTO skill_version_files (version_id, org_id, path, content, media_type, digest) VALUES ($1,$2,'SKILL.md',$3,'text/markdown',$4)",
      [versionId, ORG, Buffer.from(content, "utf8"), digest],
    );
    await c.query("SELECT wave2_publish_skill_version($1, $2)", [ORG, versionId]);
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i662-catalog" });
  await addOrgMember(ORG, ADMIN, "admin", null);
});

describe("2026-08-07：后台 Skill 目录合并显示 wave2（URL 导入）的 skill", () => {
  it("GET /skills 同时列出 skill_contracts 与 wave2 skills 两套来源的记录", async () => {
    await seedWave2Skill();

    const res = await fetch(`${BASE}${listPath}`, { headers: principal });
    expect(res.status, await res.clone().text()).toBe(200);
    const parsed = C.operations.listSkills.out.safeParse(await res.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    const body = parsed.success ? parsed.data : null!;

    const wave2Item = body.items.find((i) => i.skillId === WAVE2_SKILL_ID);
    expect(wave2Item, JSON.stringify(body.items)).toBeDefined();
    expect(wave2Item!.name).toBe(WAVE2_SKILL_NAME);
    expect(wave2Item!.status).toBe("已启用");
    expect(wave2Item!.currentVersionId).not.toBeNull();
  });

  it("没有任何 wave2 skill 时不受影响，行为与合并前一致（回归保护）", async () => {
    const res = await fetch(`${BASE}${listPath}`, { headers: principal });
    expect(res.status).toBe(200);
    const parsed = C.operations.listSkills.out.safeParse(await res.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    const body = parsed.success ? parsed.data : null!;
    // design-delta `platform-owned-skills`：四个官方 skill 对所有 org 可见，过滤掉
    // 再断言"这个 org 自己没有 wave2 skill"——不是本文件要守的性质被破坏。
    expect(body.items.filter((i) => !isOfficialPlatformSkill(i.skillId))).toEqual([]);
    expect(body.total).toBe(body.items.length);
  });
});
