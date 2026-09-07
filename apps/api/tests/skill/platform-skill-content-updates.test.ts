/**
 * 官方 skill 的 SKILL.md **改了之后，线上要真的能拿到新正文**。
 *
 * ## 事故（2026-09-06 人类实测截图）
 *
 * 沙箱换了 CJK 字体、镜像重建了、部署全绿，chat 里的助手却仍然回复
 * 「pdf-lib 仅支持拉丁字符，无法直接渲染中文，建议改用 Word」——那是**几周前**那份
 * SKILL.md 的原话。模型没做错任何事：它读的就是库里那份正文。
 *
 * 根因在种子逻辑：版本 id 写死成 `<skillId>-v1`，且版本/正文的写入放在
 * 「`skills` 行已存在就 `continue`」之后。合起来 ⇒ **首次种子之后正文永不更新**。
 * 与同一天 deploy.env 那个坑同类：「只在不存在时创建」这种幂等，对**内容会变的
 * 东西**是错的幂等——它把"没更新"伪装成"已经是最新"。
 *
 * ## 这条测试锁什么
 *
 * ① 库里已经有一份**旧正文**（正是 devapp 的状态）时，再跑一次种子，
 *   当前生效版本的 SKILL.md 必须变成**当前代码里的正文**；
 * ② 旧版本行不许被删改（版本是不可变的，历史要留）；
 * ③ 正文没变时不许产生新版本（否则每次进程启动都堆一个版本，且会去 publish
 *   一个已发布的版本而报错）。
 *
 * ③ 同时是 ① 的反证方向：如果实现退回"只在不存在时创建"，① 会红；如果实现变成
 * "每次都插一个新版本"，③ 会红。两条互相夹住，middle ground 才是对的。
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce } from "../support/db";
import { backfillPlatformOrg } from "../../scripts/backfill-platform-org";
import { backfillPlatformSkills, OFFICIAL_SKILLS } from "../../scripts/backfill-platform-skills";
import { PLATFORM_ORG_ID, toOrgId } from "../../src/domain/org-id";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
/*
 * ⚠ 夹具必须用**种子逻辑自己那个 actor id**：实现里有一条"最新版本不是服务种的
 * （= 人手动编辑过）就不覆盖"的保护。夹具若随手写 $5，会误触发那条
 * 保护，测出来的红是夹具的错，不是实现的错——这种假红比假绿更浪费时间。
 */
const SERVICE_ACTOR_ID = "svc-platform-templates";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/** 被测的那一个：pdf-create 正是事故里说错话的那个 skill。 */
const SPEC = OFFICIAL_SKILLS.find((s) => s.stableName === "pdf-create")!;

/** 几周前那份正文的关键句——事故里用户看到的就是它。 */
const STALE_CONTENT = "# PDF 文档生成（pdf-create）\n\npdf-lib 的内置字体不支持中文，建议改用 docx 或 xlsx。\n";
const STALE_VERSION_ID = `${SPEC.skillId}-v1`;

let db: PgDatabase;

/** 当前**生效**版本（= 最新一条 published）的 SKILL.md 正文，与运行时读法一致。 */
async function currentPublishedContent(): Promise<{ versionId: string; content: string }> {
  return db.withTenant(toOrgId(PLATFORM_ORG_ID), async (s) => {
    const row = await s.query<{ id: string; content: Buffer }>(
      `SELECT sv.id, f.content
         FROM skill_versions sv
         JOIN skill_version_files f ON f.version_id = sv.id AND f.org_id = sv.org_id
        WHERE sv.skill_id = $1 AND sv.org_id = $2 AND sv.published AND f.path = 'SKILL.md'
        ORDER BY sv.created_at DESC
        LIMIT 1`,
      [SPEC.skillId, PLATFORM_ORG_ID],
    );
    const first = row.rows[0];
    if (!first) throw new Error("这个 skill 没有任何已发布版本");
    return { versionId: first.id, content: Buffer.from(first.content).toString("utf8") };
  });
}

async function versionIds(): Promise<readonly string[]> {
  return db.withTenant(toOrgId(PLATFORM_ORG_ID), async (s) => {
    const rows = await s.query<{ id: string }>(
      `SELECT id FROM skill_versions WHERE skill_id = $1 AND org_id = $2 ORDER BY created_at ASC`,
      [SPEC.skillId, PLATFORM_ORG_ID],
    );
    return rows.rows.map((r) => r.id);
  });
}

/**
 * 复刻 **devapp 当时的状态**：目录行与 skills 行都在，唯一的已发布版本带的是**旧正文**。
 *
 * ⚠ 不能"先跑一遍正常种子、再把版本删掉改成旧的"——数据库对已发布版本有不可变约束
 *   （`published Skill versions and files are immutable`，实测撞到）。那条约束是对的：
 *   版本一旦发布就不该被改写。所以夹具从**一开始**就只种旧版本，一个字节都不删。
 */
async function seedStaleWorldLikeDevapp(): Promise<void> {
  await db.withTenant(toOrgId(PLATFORM_ORG_ID), async (s) => {
    await s.query(
      `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
       VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)
       ON CONFLICT (id) DO NOTHING`,
      [SPEC.skillId, PLATFORM_ORG_ID, SPEC.displayName],
    );
    await s.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,'2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')
       ON CONFLICT (id) DO NOTHING`,
      [SPEC.skillId, PLATFORM_ORG_ID, SPEC.stableName, SPEC.displayName, SERVICE_ACTOR_ID],
    );
    await s.query(
      `INSERT INTO skill_versions
         (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
       VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,'2026-08-01T00:00:00.000Z',false)
       ON CONFLICT (id) DO NOTHING`,
      [STALE_VERSION_ID, PLATFORM_ORG_ID, SPEC.skillId, sha256(STALE_CONTENT), SERVICE_ACTOR_ID],
    );
    await s.query(
      `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)
       ON CONFLICT (version_id, path) DO NOTHING`,
      [PLATFORM_ORG_ID, STALE_VERSION_ID, Buffer.from(STALE_CONTENT, "utf8"), sha256(STALE_CONTENT)],
    );
    await s.query("SELECT wave2_publish_skill_version($1,$2)", [PLATFORM_ORG_ID, STALE_VERSION_ID]);
  });
}

describe("官方 skill 正文更新后，线上必须拿到新正文", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(migrationConfig());
    await backfillPlatformOrg();
    // ⚠ 这里**不**跑 skills backfill：本文件要测的正是"库里已经是旧正文"那条路径，
    //   所以先把旧世界种出来，再让被测函数去面对它。
    await seedStaleWorldLikeDevapp();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("① 库里是旧正文时（devapp 当时的状态），跑一次种子 ⇒ 生效版本变成当前代码的正文", async () => {
    const before = await currentPublishedContent();
    expect(before.content, "夹具没造对：库里应当先是旧正文").toContain("不支持中文");

    const report = await backfillPlatformSkills();

    const after = await currentPublishedContent();
    /*
     * ⚠ 判据是**行为级**的，不是"字节等于 SPEC.content"：种子逻辑会把正文打成带
     * frontmatter 的包（standard-capabilities 格式），字节级相等会把一次正当的
     * 打包格式变更误报成回归。这里断言的是用户真正在意的两件事——
     * 新正文的关键内容在里面，旧正文那句劝退话术不在里面。
     */
    expect(after.content).toContain("SKILL_SANDBOX_CJK_FONT");
    expect(after.content).toContain("绝对不要写");
    // 事故里那句劝退话术不许还在生效版本里。
    expect(after.content).not.toContain("不支持中文");
    // 新版本必须是**另一条**记录，不是把旧版本原地改写（版本不可变）。
    expect(after.versionId).not.toBe(STALE_VERSION_ID);
    void report;
  }, 120_000);

  it("② 旧版本行不许被删改（版本不可变，历史要留）", async () => {
    const ids = await versionIds();
    expect(ids).toContain(STALE_VERSION_ID);
    const stale = await db.withTenant(toOrgId(PLATFORM_ORG_ID), async (s) =>
      s.query<{ content: Buffer }>(
        `SELECT content FROM skill_version_files WHERE org_id = $1 AND version_id = $2 AND path = 'SKILL.md'`,
        [PLATFORM_ORG_ID, STALE_VERSION_ID],
      ));
    expect(Buffer.from(stale.rows[0]!.content).toString("utf8")).toBe(STALE_CONTENT);
  }, 120_000);

  it("③ 正文没变时不许产生新版本（否则每次进程启动都堆一个，且会去 publish 已发布版本而报错）", async () => {
    const before = await versionIds();
    await backfillPlatformSkills();
    const after = await versionIds();
    expect(after).toEqual(before);
  }, 120_000);
});
