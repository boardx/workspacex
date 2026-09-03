/**
 * 2026-09-03 —— 目录页「停用」对模型 A（wave2：`skills`/`skill_versions`）的 skill
 * 此前是假动作：`POST /capabilities/mutate` 的 `op: "disable"`
 * （`mutate-capability.ts`）只翻 `capability_listings.enabled`，而挂载判定
 * （`loadMountableRow`）与 `GET /skills` 的合并读（`listAll`）走的是完全不同的一张
 * 表、认的是 `skills.status = 'enabled'`——从导入落库那一刻起就再也没人改过它。
 * 管理员点了「停用」，目录页上这一行确实变灰了，这个 skill 在 chat 的 `#` 挂载里
 * 却原样能挂、能执行。
 *
 * 修法在 `pg-capability-repository.ts#setEnabled`：`capability_listings.id` 对
 * `kind === 'skill'` 的 wave2 行就是同一个 `skills.id`（URL/starter-pack 导入落库
 * 时用的同一个 id），`setEnabled` 现在在同一次调用里把两张表一起写。
 *
 * ## 反空转
 * ① 装置自检：`skills.status` 在 disable 之前确实是 `'enabled'`（不是一开始就
 *    `'disabled'`，那样测出来的是"没变"而不是"被停用了"）。
 * ② 对照组：`kind !== 'skill'`（agent/model/mcp）的 disable 不该去碰 `skills` 表
 *    ——用一个提前插好的、id 恰好会被误伤的 `skills` 行反证：disable 一个同名 id
 *    的 agent 能力后，那个不相关的 skills 行必须原样是 `'enabled'`。
 * ③ 端到端确认：disable 之后，`GET /skills`（`listAll`，chat `#` 挂载池与
 *    `/skill` 目录唯一的合并读）不再包含这个 skill——这是用户真正会看到的效果，
 *    不只是内部字段。
 * ④ 模型 B（只有 `capability_listings` 行、没有对应 `skills` 行）disable 后
 *    `skills` 表里天然没有任何行会被影响——用一次不会报错的调用反证空操作是安全的。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-cap-disable-skill-status";
const ADMIN = "u-cap-disable-skill-status-admin";

let BASE: string;
let app: NestExpressApplication;

const auth = (user: string) => ({
  "x-kernel-test-principal": `${user}:${ORG}`,
  "content-type": "application/json",
});

const mutate = (body: unknown): Promise<Response> =>
  fetch(`${BASE}/capabilities/mutate`, { method: "POST", headers: auth(ADMIN), body: JSON.stringify(body) });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", fx.teams.energy!);
});

/** 一个真实的 wave2 skill：`skills` 行 + 同 id 的 `capability_listings` 行（两条写入路径的既有约定）。 */
async function seedWave2Skill(skillId: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  await asApp(ORG, (c) => c.query(
    `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
     VALUES ($1,$2,$1,$3,'enabled',$4,$5,$5)`,
    [skillId, ORG, name, ADMIN, now],
  ));
  await asApp(ORG, (c) => c.query(
    `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
     VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)`,
    [skillId, ORG, name],
  ));
}

async function skillsStatus(skillId: string): Promise<string | null> {
  const rows = await asApp(ORG, (c) => c.query<{ status: string }>(
    `SELECT status FROM skills WHERE org_id = $1 AND id = $2`, [ORG, skillId],
  ));
  return rows.rows[0]?.status ?? null;
}

describe("停用一个 wave2 skill：capability_listings.enabled 与 skills.status 一起变", () => {
  const SKILL_ID = "sk_disable_status_wave2";

  beforeEach(async () => {
    await seedWave2Skill(SKILL_ID, "会真的被停用的 skill");
  });

  it("① 装置自检：disable 之前 skills.status 确实是 'enabled'", async () => {
    expect(await skillsStatus(SKILL_ID)).toBe("enabled");
  });

  it("disable 之后 skills.status 变成 'disabled'——不再是只有 capability_listings 变灰的假动作", async () => {
    const r = await mutate({ orgId: ORG, kind: "skill", op: "disable", payload: { id: SKILL_ID } });
    expect(r.status, await r.clone().text()).toBe(200);
    const body = (await r.json()) as { listing: { enabled: boolean } };
    expect(body.listing.enabled).toBe(false);

    expect(await skillsStatus(SKILL_ID)).toBe("disabled");
  });

  it("③ 端到端确认：disable 之后 GET /skills 不再包含这个 skill", async () => {
    // ⚠ 契约 `SkillListItem`（packages/contracts/src/skills.ts）字段是 `skillId`，
    // 不是 `id`——写成 `.id` 时 `.map` 恒产出 `[undefined, ...]`，第一条装置自检
    // 断言就会假红（`gates-test` 实测复现：expected [ undefined ] to include ...）。
    const before = await fetch(`${BASE}/skills?orgId=${ORG}`, { headers: auth(ADMIN) });
    const beforeBody = (await before.json()) as { items: readonly { skillId: string }[] };
    expect(beforeBody.items.map((s) => s.skillId)).toContain(SKILL_ID);

    await mutate({ orgId: ORG, kind: "skill", op: "disable", payload: { id: SKILL_ID } });

    const after = await fetch(`${BASE}/skills?orgId=${ORG}`, { headers: auth(ADMIN) });
    const afterBody = (await after.json()) as { items: readonly { skillId: string }[] };
    expect(afterBody.items.map((s) => s.skillId)).not.toContain(SKILL_ID);
  });
});

describe("② 对照组：disable 一个非 skill 的能力，不会误伤同 id 的 skills 行", () => {
  it("id 恰好相同、kind='agent' 的 capability 被 disable 后，那个不相关的 skills 行原样是 enabled", async () => {
    const SHARED_ID = "shared-id-agent-not-skill";
    // ⚠ `capability_listings.id` 是全表主键（不是 (id, kind) 复合键），一个 id 只能
    // 对应一条 capability_listings 行——所以这里只直接种 `skills` 表那一行（它是
    // 完全独立的另一张表，不受这条主键约束），capability_listings 只种下面这条
    // kind='agent' 的行，用来发起 disable 调用。
    const now = new Date().toISOString();
    await asApp(ORG, (c) => c.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$1,$3,'enabled',$4,$5,$5)`,
      [SHARED_ID, ORG, "不该被这次 disable 碰到的 skill", ADMIN, now],
    ));
    await asApp(ORG, (c) => c.query(
      `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint, abbr, duty)
       VALUES ($1,$2,'agent',$3,'org-wide',NULL,true,NULL,'AG','test fixture agent')`,
      [SHARED_ID, ORG, "同 id 的 agent 能力"],
    ));

    const r = await mutate({ orgId: ORG, kind: "agent", op: "disable", payload: { id: SHARED_ID } });
    expect(r.status, await r.clone().text()).toBe(200);

    expect(await skillsStatus(SHARED_ID)).toBe("enabled");
  });
});

describe("④ 模型 B（只有 capability_listings、没有 skills 行）disable 是安全的空操作", () => {
  it("declarative-only 的 capability 行 disable 成功，不报错，也不会凭空插出一行 skills", async () => {
    const DECLARATIVE_ID = "skill-contract-only-no-wave2-row";
    await asApp(ORG, (c) => c.query(
      `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
       VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)`,
      [DECLARATIVE_ID, ORG, "只有契约、没有 wave2 行的 skill"],
    ));

    const r = await mutate({ orgId: ORG, kind: "skill", op: "disable", payload: { id: DECLARATIVE_ID } });
    expect(r.status, await r.clone().text()).toBe(200);

    expect(await skillsStatus(DECLARATIVE_ID)).toBeNull();
  });
});
