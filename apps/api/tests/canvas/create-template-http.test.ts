/**
 * #496 — `POST /canvas/templates`：模板注册表**第一次有了造一行的能力**，端到端。
 *
 * ## 这个文件为什么单独存在
 *
 * `template-lifecycle-http.test.ts` 的文件头逐字写着：签过的契约里没有创建操作，所以那份
 * fixture 只能用 SQL 把 draft 行**种**进去，并明说「不在这里发明一个 `POST
 * /canvas/templates`」。#496 把那条缺口按 design-delta 补上了（**待人类补签**，见
 * `canvas.ts` 里 `createTemplate` 的文件头与 `KNOWN_CONTRACT_GAPS.C_CANVAS_8`）。
 * 断言另起一份而不是塞进那份，是为了让「哪些断言依赖一个尚未签核的契约面」一眼可分——
 * 人类若推翻 #496，要回退的是本文件，而不是去一份混着五个已签操作的文件里挑。
 *
 * ## 每一条都走真 HTTP → controller → application → repository → PostgreSQL
 *
 * 持久面一律用 `asApp`（RLS 下的应用角色）**重新读一遍**，不信响应体：一个把入参原样
 * 回显的实现与一次真的写入，在响应体上完全同形。这正是 #463 那份文件头点名的失效方式。
 *
 * ## 最重要的一条是「新建不绕过发布流程」
 *
 * 新建出来的行是 `draft`，因此 `forBinding: true` 的绑定选择器**看不见它**（I-5）；
 * 只有再走 `publishTemplate` 之后才看得见。少了这条，`createTemplate` 就可能被实现成
 * 「建出来直接能用」，而那会把已签核的三段发布流程整个绕开，且列表断言照样全绿。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-496-create-tpl";
const OTHER_ORG = "org-496-create-tpl-other";
const PROJECT = `${ORG}-workshop`;
const OTHER_PROJECT = `${OTHER_ORG}-workshop`;
const ADMIN = "u-496-admin";
/** 有团队的管理员：`team-only` 的 owner_team_id 取创建者的团队（C_CANVAS_8 ①）。 */
const ADMIN_NO_TEAM = "u-496-admin-noteam";
const MEMBER = "u-496-member";

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

/** 契约 `createTemplate.in` 的一份合法值。逐条测试只覆盖它想改的那一栏。 */
function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "swot",
    displayName: "SWOT 画布",
    underlyingType: "canvas",
    sections: SECTIONS,
    visibility: "org-wide",
    ...over,
  };
}

const createTemplate = (body: unknown, userId = ADMIN, orgId = ORG) =>
  fetch(`${BASE}${C.operations.createTemplate.path}`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });

const post = (path: string, body: unknown, userId = ADMIN, orgId = ORG) =>
  fetch(`${BASE}/canvas${path}`, {
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
  archived_from: string | null;
  builtin: boolean;
  visibility: string;
  owner_team_id: string | null;
  underlying_type: string;
  sections: unknown;
}

/** 从库里重新读，不信响应体。 */
async function readAll(orgId = ORG): Promise<StoredTemplate[]> {
  return asApp(orgId, async (c) => {
    const r = await c.query<StoredTemplate>(
      `SELECT key, version, display_name, status, archived_from, builtin, visibility,
              owner_team_id, underlying_type, sections
         FROM canvas_templates WHERE org_id = $1 ORDER BY key, version`,
      [orgId],
    );
    return r.rows;
  });
}

/** 直接种一行，用来构造「key 已被别的版本占用」这种本操作造不出来的前置状态。 */
async function seedTemplate(t: {
  key: string;
  version: number;
  status: "draft" | "trial" | "published" | "archived";
  archivedFrom?: string | null;
  orgId?: string;
}): Promise<void> {
  const orgId = t.orgId ?? ORG;
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, archived_from, builtin, visibility,
          underlying_type, sections)
       VALUES ($1,$2,$3,$4,$5,$6,false,'org-wide','canvas',$7::jsonb)`,
      [orgId, t.key, t.version, t.key, t.status, t.archivedFrom ?? null, JSON.stringify(SECTIONS)],
    ),
  );
}

let adminTeamId: string | null = null;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  // 端口 0：OS 挑一个空闲的，并行的测试文件不会互撞，也不会被上一次没退干净的进程占住。
  await app.listen(0);
  const address = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER_ORG, projectId: OTHER_PROJECT });
  adminTeamId = fixture.teams.energy ?? null;
  await addOrgMember(ORG, ADMIN, "admin", adminTeamId);
  // 无团队的管理员：C_CANVAS_8 ① 那条 fail-closed 后果的载体。
  await addOrgMember(ORG, ADMIN_NO_TEAM, "admin", null);
  // `consultant` 而不是 `lead`：普通成员才是这条门要挡的人，而 `lead` 资历够高，
  // 一个写错的角色判定用 `lead` 去测**仍可能看起来是对的**。
  await addOrgMember(ORG, MEMBER, "consultant", adminTeamId);
});

describe("#496 · POST /canvas/templates 真的造出一行", () => {
  it("201，响应体逐字过契约的 strict 校验，且库里真多了一行", async () => {
    const res = await createTemplate(createBody());
    expect(res.status).toBe(201);

    // ⚠ `.parse` 用的是契约自己的 `.strict()` schema：多一个契约没描述的字段在这里当场红，
    //   而不是等前端联调时才发现。zod 默认剥未知键，不 strict 等于没校验。
    const parsed = C.operations.createTemplate.out.parse(await res.json());
    expect(parsed).toEqual({
      key: "swot",
      displayName: "SWOT 画布",
      version: 1,
      status: "draft",
      builtin: false,
      visibility: "org-wide",
      underlyingType: "canvas",
      sections: SECTIONS,
      // 2026-08-25：`createBody()` 不传 `tags`——省略与显式 `[]` 在契约层同义，
      // 落库前用例已归一成真数组，出门永远是 `[]` 而不是 `undefined`。
      tags: [],
    });

    // 持久面重新读一遍——响应体可以只是把入参回显了一遍。
    const rows = await readAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "swot",
      version: 1,
      display_name: "SWOT 画布",
      status: "draft",
      archived_from: null,
      builtin: false,
      visibility: "org-wide",
      underlying_type: "canvas",
    });
    expect(rows[0]!.sections).toEqual(SECTIONS);
  });

  it("新建出来的行在 listTemplates 里读得到，且状态是草稿", async () => {
    await createTemplate(createBody());
    const parsed = C.operations.listTemplates.out.parse(await (await listTemplates("")).json());
    expect(parsed.templates).toHaveLength(1);
    expect(parsed.templates[0]).toMatchObject({
      key: "swot", version: 1, status: "draft", builtin: false, usageCount: 0,
    });
  });

  /**
   * 本文件最重要的一条。新建**不是**发布：绑定选择器（`forBinding: true`）看不见草稿，
   * 走完 `publishTemplate` 之后才看得见。
   */
  it("新建即草稿，必须经 publishTemplate 才进得了绑定选择器", async () => {
    await createTemplate(createBody());

    const beforePublish = C.operations.listTemplates.out.parse(
      await (await listTemplates("forBinding=true")).json(),
    );
    expect(beforePublish.templates).toEqual([]);

    const published = await post("/templates/swot/publish", {
      key: "swot", version: 1, visibility: "org-wide",
    });
    expect(published.status).toBe(200);

    const afterPublish = C.operations.listTemplates.out.parse(
      await (await listTemplates("forBinding=true")).json(),
    );
    expect(afterPublish.templates).toHaveLength(1);
    expect(afterPublish.templates[0]).toMatchObject({ key: "swot", version: 1, status: "published" });

    // 库里也确实变成了 published，不只是列表过滤看起来对。
    expect((await readAll())[0]).toMatchObject({ status: "published" });
  });

  it("publishTemplate 的 TEMPLATE_NOT_FOUND 仍然可达 —— 创建没有被做成 upsert", async () => {
    // 没有这一条，「把 publish 改成不存在就创建」这个被明令禁止的实现会毫无声息地通过：
    // 所有创建断言照样绿，而契约里那个错误码变成不可达（C_CANVAS_3 点名的形状）。
    const res = await post("/templates/never-created/publish", {
      key: "never-created", version: 1, visibility: "org-wide",
    });
    expect(res.status).toBe(404);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_NOT_FOUND");
    expect(await readAll()).toEqual([]); // 更没有顺手造出一行
  });
});

describe("#496 · key 冲突 —— TEMPLATE_KEY_CONFLICT 第一次可达", () => {
  it("同一个 key 建第二次 ⇒ 409 TEMPLATE_KEY_CONFLICT，且不产生第二行", async () => {
    expect((await createTemplate(createBody())).status).toBe(201);

    const again = await createTemplate(createBody({ displayName: "另一个名字" }));
    expect(again.status).toBe(409);
    expect(await reasonCodeOf(again)).toBe("TEMPLATE_KEY_CONFLICT");

    const rows = await readAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.display_name).toBe("SWOT 画布"); // 第二次也没有把第一行改掉
  });

  it("key 被**别的版本**占用时同样冲突 —— 冲突判据是 key，不是 (key, 1)", async () => {
    // 本操作只铸 v1，所以「已存在 v2」这种前置状态它自己造不出来，只能种进去。
    // 少了这条，实现写成 `ON CONFLICT (org_id,key,version) DO NOTHING` 会漏掉它，
    // 结果是同一个 key 冒出两条互不相干的谱系。
    await seedTemplate({ key: "swot", version: 2, status: "published" });

    const res = await createTemplate(createBody());
    expect(res.status).toBe(409);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_KEY_CONFLICT");
    expect(await readAll()).toHaveLength(1);
  });

  it("别的组织占用了同一个 key 不构成冲突 —— key 的作用域是组织", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published", orgId: OTHER_ORG });
    expect((await createTemplate(createBody())).status).toBe(201);
    expect(await readAll(ORG)).toHaveLength(1);
    expect(await readAll(OTHER_ORG)).toHaveLength(1);
  });
});

describe("#496 · 谁能建 —— 判定在服务端", () => {
  it("普通成员 ⇒ 403 ROLE_INSUFFICIENT，且一行都没造出来", async () => {
    const res = await createTemplate(createBody(), MEMBER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readAll()).toEqual([]);
  });

  it("非本组织成员 ⇒ 同一个 ROLE_INSUFFICIENT，不泄露组织是否存在", async () => {
    const res = await createTemplate(createBody(), "u-496-outsider");
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readAll()).toEqual([]);
  });
});

describe("#496 · 入参形状 —— 契约的 .strict() 真的生效", () => {
  it("契约没描述的字段 ⇒ 400，而不是被悄悄剥掉", async () => {
    // 尤其是 `status` / `builtin` / `version`：它们是**服务端决定的**，
    // 剥掉未知键会让一个试图自封 published / builtin 的请求安静地成功一半。
    for (const extra of [{ status: "published" }, { builtin: true }, { version: 9 }, { orgId: OTHER_ORG }]) {
      const res = await createTemplate(createBody(extra));
      expect(res.status, `多余字段 ${JSON.stringify(extra)} 应被拒`).toBe(400);
    }
    expect(await readAll()).toEqual([]);
  });

  it("空 key / 空 displayName / 非法 visibility ⇒ 400", async () => {
    for (const bad of [{ key: "" }, { displayName: "" }, { visibility: "everyone" }]) {
      expect((await createTemplate(createBody(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await readAll()).toEqual([]);
  });

  it("分区可以为空数组 —— 空模板是合法起点，不是错误", async () => {
    const res = await createTemplate(createBody({ sections: [] }));
    expect(res.status).toBe(201);
    expect(C.operations.createTemplate.out.parse(await res.json()).sections).toEqual([]);
  });
});

describe("#496 · 租户隔离与 team-only 的已知缺口（C_CANVAS_8 ①）", () => {
  it("建在 A 组织的模板不落到 B 组织，且 A 的管理员读 B 时先被身份判定拦下", async () => {
    expect((await createTemplate(createBody())).status).toBe(201);

    // 持久面：B 组织**一行都没有**（RLS + WHERE org_id 两道）。
    expect(await readAll(OTHER_ORG)).toEqual([]);

    // 读路径：A 的管理员不是 B 的成员 ⇒ `NO_PROJECT_ROLE`，而不是「一个空列表」。
    // ⚠ 断的是 403 而不是 `templates: []`：后者会让「越权被拒」与「B 确实没有模板」
    //   在断言上同形，那正是隔离失效时最容易被误读成通过的那一种。
    const res = await listTemplates("", ADMIN, OTHER_ORG);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("NO_PROJECT_ROLE");
  });

  it("team-only 的 owner_team_id 取创建者的团队", async () => {
    expect(adminTeamId, "fixture 没给出团队，本条会空转").not.toBeNull();
    expect((await createTemplate(createBody({ visibility: "team-only" }))).status).toBe(201);
    expect((await readAll())[0]).toMatchObject({ visibility: "team-only", owner_team_id: adminTeamId });
  });

  /**
   * 缺口的**后果**，如实钉住而不是假装不存在：契约 `createTemplate.in` 没有 `ownerTeamId`，
   * 创建者又没有团队 ⇒ 这一行 owner 为 null ⇒ 对所有人不可见（fail-closed）。
   * 人类补签 #496 时要一并裁决这一条，见 KNOWN_CONTRACT_GAPS.C_CANVAS_8。
   */
  it("无团队的管理员建 team-only ⇒ 行建出来了，但连他自己都列不到（fail-closed）", async () => {
    expect((await createTemplate(createBody({ visibility: "team-only" }), ADMIN_NO_TEAM)).status).toBe(201);
    expect((await readAll())[0]).toMatchObject({ visibility: "team-only", owner_team_id: null });

    const listed = C.operations.listTemplates.out.parse(
      await (await listTemplates("", ADMIN_NO_TEAM)).json(),
    );
    expect(listed.templates).toEqual([]);
  });
});
