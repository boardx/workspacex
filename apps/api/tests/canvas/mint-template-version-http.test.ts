/**
 * #988 — `POST /canvas/templates/:key/versions`：本束「编辑」的真实语义，端到端。
 *
 * ## 这个文件为什么单独存在
 *
 * 同 `create-template-http.test.ts` 的理由：这条路由的契约面（`mintTemplateVersion`）
 * 是 2026-08-17 才由人类在 `design-signoff.md` 签核确认的（#496 → #988），断言另起一份
 * 而不是塞进 `template-lifecycle-http.test.ts`（那份覆盖的是签核更早的五个操作），是为了
 * 让「哪些断言依赖哪一次签核」一眼可分。
 *
 * ## 每一条都走真 HTTP → controller → application → repository → PostgreSQL
 *
 * 持久面一律用 `asApp` 重新读一遍，不信响应体——同 `create-template-http.test.ts` 那条
 * 「一个把入参原样回显的实现与一次真的写入，在响应体上完全同形」的理由。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-988-mint-tpl";
const ADMIN = "u-988-admin";
/** 有团队的管理员：`team-only` 的 owner_team_id 取调用者的团队（C_CANVAS_8 ①，本操作是显式拒绝）。 */
const ADMIN_NO_TEAM = "u-988-admin-noteam";
const MEMBER = "u-988-member";

let BASE: string;
let app: NestExpressApplication;

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

const SECTIONS = [
  { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
  { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: 5 },
];

const V2_SECTIONS = [
  { sectionId: "s1", name: "优势（v2 改过）", order: 0, required: true, capacity: null },
];

function mintBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "swot",
    displayName: "SWOT 画布 v2",
    underlyingType: "canvas",
    sections: V2_SECTIONS,
    visibility: "org-wide",
    ...over,
  };
}

const mintVersion = (key: string, body: unknown, userId = ADMIN, orgId = ORG) =>
  fetch(`${BASE}${C.operations.mintTemplateVersion.path.replace(":key", encodeURIComponent(key))}`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });

const listTemplates = (query: string, userId = ADMIN, orgId = ORG) =>
  fetch(`${BASE}/canvas/templates?orgId=${orgId}&${query}`, { headers: authFor(userId, orgId) });

async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
}

interface StoredTemplate {
  key: string;
  version: number;
  display_name: string;
  status: string;
  visibility: string;
  owner_team_id: string | null;
  underlying_type: string;
  sections: unknown;
}

async function readAll(orgId = ORG): Promise<StoredTemplate[]> {
  return asApp(orgId, async (c) => {
    const r = await c.query<StoredTemplate>(
      `SELECT key, version, display_name, status, visibility, owner_team_id,
              underlying_type, sections
         FROM canvas_templates WHERE org_id = $1 ORDER BY key, version`,
      [orgId],
    );
    return r.rows;
  });
}

/** v1 · draft 起点。每条测试都先建出这一行，再对它开新版。 */
async function seedV1(orgId = ORG, ownerTeamId: string | null = null): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, archived_from, builtin, visibility,
          owner_team_id, underlying_type, sections)
       VALUES ($1,'swot',1,'SWOT 画布','published',NULL,false,'org-wide',$2,'canvas',$3::jsonb)`,
      [orgId, ownerTeamId, JSON.stringify(SECTIONS)],
    ),
  );
}

let adminTeamId: string | null = null;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-workshop` });
  adminTeamId = fixture.teams.energy ?? null;
  await addOrgMember(ORG, ADMIN, "admin", adminTeamId);
  await addOrgMember(ORG, ADMIN_NO_TEAM, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", adminTeamId);
  await seedV1();
});

describe("#988 · POST /canvas/templates/:key/versions 真的铸出下一版", () => {
  it("201，响应体逐字过契约的 strict 校验，version 是 2 不是 1", async () => {
    const res = await mintVersion("swot", mintBody());
    expect(res.status).toBe(201);

    const parsed = C.operations.mintTemplateVersion.out.parse(await res.json());
    expect(parsed).toEqual({
      key: "swot",
      displayName: "SWOT 画布 v2",
      version: 2,
      status: "draft",
      builtin: false,
      visibility: "org-wide",
      underlyingType: "canvas",
      sections: V2_SECTIONS,
      tags: [],
      // #2221：真实 HTTP「基于此开新版」调用（没有 backfill 内部标记）恒写 user-edited。
      layoutSource: "user-edited",
      // 2026-08-27：请求体不传 `size`——省略**不继承上一版**，归一成 `"A1"`。
      size: "A1",
    });

    const rows = await readAll();
    expect(rows).toHaveLength(2); // v1（种进去的）+ v2（本次铸的）
    const v2 = rows.find((r) => r.version === 2);
    expect(v2).toMatchObject({
      key: "swot", version: 2, display_name: "SWOT 画布 v2", status: "draft",
    });
    expect(v2!.sections).toEqual(V2_SECTIONS);

    // v1 不受影响——「加一段不替一段」，来源版本原地不动。
    const v1 = rows.find((r) => r.version === 1);
    expect(v1).toMatchObject({ status: "published", display_name: "SWOT 画布" });
  });

  it("连续开两次新版 ⇒ v3，不是又一个 v2", async () => {
    expect((await mintVersion("swot", mintBody())).status).toBe(201);
    const second = await mintVersion("swot", mintBody({ displayName: "SWOT 画布 v3" }));
    expect(second.status).toBe(201);
    expect(C.operations.mintTemplateVersion.out.parse(await second.json()).version).toBe(3);
    expect(await readAll()).toHaveLength(3);
  });

  it("新铸出的版本是草稿，不进 forBinding 选择器，需再走 publishTemplate", async () => {
    await mintVersion("swot", mintBody());
    const beforePublish = C.operations.listTemplates.out.parse(
      await (await listTemplates("forBinding=true")).json(),
    );
    // forBinding 只看得到 v1（published），看不到 v2（draft）——同 createTemplate 的既有行为。
    expect(beforePublish.templates.map((t) => t.version)).toEqual([1]);
  });

  it("key 不存在 ⇒ 404 TEMPLATE_NOT_FOUND，且不产生任何行", async () => {
    const res = await mintVersion("never-existed", mintBody({ key: "never-existed" }));
    expect(res.status).toBe(404);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_NOT_FOUND");
    expect(await readAll()).toHaveLength(1); // 仍然只有 fixture 种的 v1
  });
});

describe("#988 · 谁能开新版 —— 判定在服务端", () => {
  it("普通成员 ⇒ 403 ROLE_INSUFFICIENT，且没有新版本被造出来", async () => {
    const res = await mintVersion("swot", mintBody(), MEMBER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readAll()).toHaveLength(1);
  });
});

describe("#988 · 路径参数与 body 打架时拒绝", () => {
  it("路径 key 与 body.key 不一致 ⇒ 400，不静默挑一个", async () => {
    const res = await mintVersion("swot", mintBody({ key: "not-swot" }));
    expect(res.status).toBe(400);
    expect(await readAll()).toHaveLength(1);
  });
});

describe("#988 · 入参形状 —— 契约的 .strict() 真的生效", () => {
  it("契约没描述的字段 ⇒ 400", async () => {
    for (const extra of [{ status: "published" }, { builtin: true }, { version: 9 }]) {
      const res = await mintVersion("swot", mintBody(extra));
      expect(res.status, `多余字段 ${JSON.stringify(extra)} 应被拒`).toBe(400);
    }
    expect(await readAll()).toHaveLength(1);
  });
});

describe("#988 · ownerTeamId 显式拒绝（C_CANVAS_8①，与 createTemplate 唯一的行为差异）", () => {
  it("team-only 的 owner_team_id 取调用者自己的团队", async () => {
    expect(adminTeamId, "fixture 没给出团队，本条会空转").not.toBeNull();
    const res = await mintVersion("swot", mintBody({ visibility: "team-only" }));
    expect(res.status).toBe(201);
    const v2 = (await readAll()).find((r) => r.version === 2);
    expect(v2).toMatchObject({ visibility: "team-only", owner_team_id: adminTeamId });
  });

  /**
   * 与 `createTemplate` 唯一的行为差异（见 `mint-template-version.ts` 文件头）：
   * `createTemplate` 在这里是静默 fail-closed（造出一行谁都看不见）；本操作是造之前
   * 就当场拒绝，调用者能立刻知道「你没有团队」，而不是建完模板才发现它是隐形的。
   */
  it("无团队的调用者开 team-only 新版 ⇒ 400 TEAM_REQUIRED_FOR_TEAM_ONLY，且不产生新行", async () => {
    const res = await mintVersion("swot", mintBody({ visibility: "team-only" }), ADMIN_NO_TEAM);
    expect(res.status).toBe(400);
    expect(await reasonCodeOf(res)).toBe("TEAM_REQUIRED_FOR_TEAM_ONLY");
    expect(await readAll()).toHaveLength(1); // 只有 fixture 种的 v1，没有半成品 v2
  });

  it("org-wide 不受这条限制——无团队的调用者也能开新版", async () => {
    const res = await mintVersion("swot", mintBody({ visibility: "org-wide" }), ADMIN_NO_TEAM);
    expect(res.status).toBe(201);
  });
});
