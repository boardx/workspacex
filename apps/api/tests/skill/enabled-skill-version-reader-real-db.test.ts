/**
 * #2514（2026-09-02 人类裁决）—— `PgEnabledSkillVersionReader` 的真库门：agent 默认加载的
 * 「组织全部已启用 skill 的当前生效版本」这条 SQL 到底吐什么、不吐什么。
 *
 * 四条判据各有一条反证行：
 *   · 已启用 + 有已发布版本 ⇒ 进（取**最新**已发布版本，不是最早的）。
 *   · `status = 'disabled'` ⇒ 不进（目录里也不显示为「已启用」，口径同 `listAll()`）。
 *   · 只有草稿、没有已发布版本 ⇒ 不进（塞进去 run 会 `SKILL_VERSION_UNAVAILABLE` 整体失败）。
 *   · 模型 B `skill_contracts` 的「已启用」行 ⇒ 不进（`readPinnedSkills` 读不到它的正文）。
 *   · 顺序按 `skills.created_at ASC, id ASC`。
 *
 * 与 `thread-mount-run-injection-real-db.test.ts` 同一套夹具写法（先 draft 后
 * `wave2_publish_skill_version`），同一个恒允许判定只为拆 `Guarded` 封套。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgEnabledSkillVersionReader } from "../../src/infrastructure/skill/pg-enabled-skill-version-reader";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { discloseDecided } from "../../src/application/security/permission-filter";
import type { PermissionDecision } from "../../src/domain/identity/permission-decision";

const ORG = "org-i2514-enabled";
const OTHER_ORG = "org-i2514-other";
const ACTOR = "u-i2514-actor";
const THREAD = "thread-i2514";
const PROJECT = "project-i2514";
const DIGEST = "b".repeat(64);

const ALLOW_ALL = { allowed: true, decisionId: "decision-i2514" } as unknown as PermissionDecision;

async function seedSkill(input: {
  org?: string; skillId: string; status?: "enabled" | "disabled"; createdAt: string;
  versions: readonly { id: string; publish: boolean; createdAt: string }[];
}): Promise<void> {
  const org = input.org ?? ORG;
  await asApp(org, async (c) => {
    await c.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6::timestamptz,$6::timestamptz) ON CONFLICT (id) DO NOTHING`,
      [input.skillId, org, input.skillId, input.status ?? "enabled", ACTOR, input.createdAt],
    );
    for (const v of input.versions) {
      await c.query(
        `INSERT INTO skill_versions
           (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
         VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,$7::timestamptz,false) ON CONFLICT (id) DO NOTHING`,
        [v.id, org, input.skillId, v.id, DIGEST, ACTOR, v.createdAt],
      );
      await c.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,$2,'SKILL.md',$3,'text/markdown',$4) ON CONFLICT (version_id, path) DO NOTHING`,
        [org, v.id, Buffer.from(`# ${v.id}`, "utf8"), DIGEST],
      );
      if (v.publish) await c.query("SELECT wave2_publish_skill_version($1, $2)", [org, v.id]);
    }
  });
}

async function seedContractSkill(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skill_contracts
         (id, org_id, name, duty, source, status, visibility, owner_team_id,
          current_version_id, archived, created_by)
       VALUES ($1,$2,$1,'d','自建','已启用','org-wide',NULL,$3,false,$4)
       ON CONFLICT (id) DO NOTHING`,
      ["skill-i2514-contract", ORG, "skill-i2514-contract-v1", ACTOR],
    );
    await c.query(
      `INSERT INTO skill_contract_versions
         (id, org_id, skill_id, version_number, state, prompt_template, input_schema,
          output_schema, data_scope, reads_raw_transcript, fallback_declaration,
          model_ref, content_hash, created_by)
       VALUES ($1,$2,$3,1,'已生效','p','{}','{}','[]'::jsonb,false,'f','m/x',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      ["skill-i2514-contract-v1", ORG, "skill-i2514-contract", DIGEST, ACTOR],
    );
  });
}


/**
 * 平台组织（`org-platform`）已启用 skill 的当前版本集合——用一条独立 SQL（平台组织视角、
 * 不经被测读口）现场算出来当对照。这个集合由人工触发的 backfill 或同一测试库里别的
 * 真栈测试（`platform-owned-skills-real-stack.test.ts` 会种平台 skill）决定，可能为空也
 * 可能是四个官方 skill；写死任何一种都会在另一种库上假红（CI `verify-affected` 实测：
 * 同一库先跑过平台 skill 测试，这里读回 6 个而不是 2 个）。
 */
async function platformEnabledVersionIds(): Promise<readonly string[]> {
  return asApp("org-platform", async (c) => {
    const r = await c.query<{ version_id: string | null }>(
      `SELECT (SELECT sv.id FROM skill_versions sv
                WHERE sv.skill_id = sk.id AND sv.org_id = sk.org_id AND sv.published
                ORDER BY sv.created_at DESC LIMIT 1) AS version_id
         FROM skills sk WHERE sk.org_id = 'org-platform' AND sk.status = 'enabled'
        ORDER BY sk.created_at ASC, sk.id ASC`,
    );
    return r.rows.map((row) => row.version_id).filter((v): v is string => v !== null);
  });
}

describe("#2514 agent 默认加载：组织全部已启用 skill 的当前生效版本读口", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    await resetOrgs(ORG, OTHER_ORG);
    await seedOrg({ orgId: ORG, projectId: PROJECT });
    await seedOrg({ orgId: OTHER_ORG, projectId: "project-i2514-other" });
    // 先建的在前；两个已发布版本，最新的那个才是「当前生效」。
    await seedSkill({
      skillId: "skill-i2514-b", createdAt: "2026-09-01T00:00:00Z",
      versions: [
        { id: "skill-i2514-b-v1", publish: true, createdAt: "2026-09-01T00:00:00Z" },
        { id: "skill-i2514-b-v2", publish: true, createdAt: "2026-09-01T01:00:00Z" },
      ],
    });
    await seedSkill({
      skillId: "skill-i2514-a", createdAt: "2026-09-02T00:00:00Z",
      versions: [{ id: "skill-i2514-a-v1", publish: true, createdAt: "2026-09-02T00:00:00Z" }],
    });
    // 反证行 1：已停用。
    await seedSkill({
      skillId: "skill-i2514-disabled", status: "disabled", createdAt: "2026-09-02T01:00:00Z",
      versions: [{ id: "skill-i2514-disabled-v1", publish: true, createdAt: "2026-09-02T01:00:00Z" }],
    });
    // 反证行 2：只有草稿。
    await seedSkill({
      skillId: "skill-i2514-draft", createdAt: "2026-09-02T02:00:00Z",
      versions: [{ id: "skill-i2514-draft-v1", publish: false, createdAt: "2026-09-02T02:00:00Z" }],
    });
    // 反证行 3：别的组织的已启用 skill（RLS + WHERE 双重挡住）。
    await seedSkill({
      org: OTHER_ORG, skillId: "skill-i2514-foreign", createdAt: "2026-09-02T03:00:00Z",
      versions: [{ id: "skill-i2514-foreign-v1", publish: true, createdAt: "2026-09-02T03:00:00Z" }],
    });
    // 反证行 4：模型 B 的「已启用」。
    await seedContractSkill();
  }, 120_000);

  it("只吐已启用 + 有已发布版本的模型 A skill，各取最新已发布版本，按建立顺序", async () => {
    const db = new PgDatabase(appConfig());
    try {
      const reader = new PgEnabledSkillVersionReader(db);
      const guarded = await reader.currentEnabledSkillVersionIds(
        toOrgId(ORG), { projectId: PROJECT, threadId: THREAD },
      );
      const disclosed = discloseDecided(guarded, ALLOW_ALL);
      expect("payload" in disclosed, "恒允许的判定下应该拿得到载荷").toBe(true);
      const ids = (disclosed as { payload: readonly string[] }).payload;
      // 本组织的行逐字相等（含顺序）：b 先建所以在前、且是 v2 不是 v1；disabled / draft /
      // foreign / 模型 B 全不在。平台组织的行另算（见 `platformEnabledVersionIds`）。
      const own = ids.filter((id) => id.startsWith("skill-i2514-"));
      expect(own).toEqual(["skill-i2514-b-v2", "skill-i2514-a-v1"]);
      const platform = await platformEnabledVersionIds();
      expect([...ids.filter((id) => !id.startsWith("skill-i2514-"))].sort())
        .toEqual([...platform].sort());
      expect(ids).toHaveLength(own.length + platform.length);
    } finally {
      await db.close();
    }
  });

  it("组织一个已启用 skill 都没有时，结果恰好等于平台组织的已启用集合（可能为空），不伪造", async () => {
    await resetOrgs("org-i2514-empty");
    await seedOrg({ orgId: "org-i2514-empty", projectId: "project-i2514-empty" });
    const db = new PgDatabase(appConfig());
    try {
      const reader = new PgEnabledSkillVersionReader(db);
      const guarded = await reader.currentEnabledSkillVersionIds(
        toOrgId("org-i2514-empty"), { projectId: null, threadId: "thread-i2514-empty" },
      );
      const disclosed = discloseDecided(guarded, ALLOW_ALL);
      const ids = (disclosed as { payload: readonly string[] }).payload;
      // 精确集合，不是「不含本组织的」：本组织零已启用 ⇒ 结果**恰好等于**平台组织
      // （`org-platform`）已启用 skill 的当前版本集合——那个集合本身由人工触发的
      // backfill 决定（design-delta `platform-owned-skills` ④），可能为空也可能是四个
      // 官方 skill，所以在这里用一条独立 SQL（平台组织视角、不经本读口）现场算出来
      // 当对照，而不是写死。平台之外任何组织的行混进来，这条都会红。
      const platformExpected = await platformEnabledVersionIds();
      expect(ids).toEqual(platformExpected);
    } finally {
      await db.close();
    }
  });
});
