/**
 * F117 ④ —— **同一次创建请求重复提交只建出一个容器**（uc-00-1 E5 / V11）。
 *
 * ## 断言的是「只建出一个」，不是「两次返回同一个 id」
 *
 * 「两次的 id 相同」在一个**每次都新建、但 id 由入参派生**的实现下也全绿——
 * 那种实现建了两行容器，只是两行的 id 撞在一起（然后第二行插不进去，或者更糟：
 * 主键不冲突的写法下真的建出了两个）。所以下面每一条都去**数行**：
 * `projects` / 子类型表 / 重放表各多了几行。
 *
 * ## 幂等键是一个**实现判断**，不是已签核的裁决
 *
 * 契约面没有幂等键（`KNOWN_CONTRACT_GAPS.P9` 逐字）。F117 挑的判据是
 * 「同一次请求」= (组织, 发起人, kind, name, 蓝本) 五元组的指纹，
 * 候选与代价写在 `migrations/0026-f117-create-project-idempotency.sql` 头部。
 * ⇒ 所以本文件不只测「重复提交合一」，还逐条测**判据的边界**：
 *   五个分量各改一个，都必须建出**新的**容器。少测一个分量，
 *   那个分量就等于没进指纹，而它的表现是「两个不同的请求被静默合成一个」。
 *
 * ## 并发那一半
 *
 * 两路同时提交同一个请求，必须**恰好一个容器**。这条在「先 SELECT 再决定」的写法下
 * 两路都读到「没有」、两路都去建，而顺序调用测不出来——顺序调用下那种写法
 * 第二次也会读到「有」。与 `tests/auth/one-code-one-org-concurrency.test.ts` 同型。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProject } from "../../src/application/project/create-project";
import { creationFingerprint } from "../../src/domain/project/create-project-rules";
import type { BlueprintReferenceRepository } from "../../src/application/project/ports";
import { PgProjectRepository } from "../../src/infrastructure/project/pg-project-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f117-idem-org";
const ORG_B = "f117-idem-org-b";
const LEAD = "u-f117-idem-lead";
const LEAD_B = "u-f117-idem-lead-b";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgProjectRepository;
let identity: PgIdentityRepository;

const BASE = {
  actorId: LEAD,
  name: "季度复盘",
  kind: "workshop",
  blueprintVersionId: null as string | null,
};

/**
 * 本文件测的是「同一次请求」的指纹判据（含 `blueprintVersionId` 分量），不是 BP-08
 * 真正的蓝本合法性校验（那部分见 `tests/project/create-project-blueprint-init.test.ts`）。
 * ⇒ 任何非 null 的 id 都判"ok"，不查真实存不存在——这里只需要区分「传了不同的
 * blueprintVersionId 是不是产生不同的指纹」，不需要它对应一条真实的 `blueprint_versions` 行。
 */
const stubBlueprintReference: BlueprintReferenceRepository = {
  resolve: async (orgId) => ({
    // 每个组织的固定蓝本行（见 beforeEach 的 `bp-fixture-<org>`），与传入的
    // blueprintVersionId 字面量无关——本文件的指纹分量用的是 createProject 的
    // *输入* blueprintVersionId，不是这里解析出的 blueprintId。
    kind: "ok",
    blueprintId: `bp-fixture-${orgId}`,
    filledFacetKeys: [],
    tier: "custom",
  }),
};

function submit(over: Partial<typeof BASE> & { orgId?: string } = {}) {
  return createProject(
    { repo, identity, blueprintReference: stubBlueprintReference },
    {
      orgId: toOrgId(over.orgId ?? ORG),
      actorId: over.actorId ?? BASE.actorId,
      name: over.name ?? BASE.name,
      kind: over.kind ?? BASE.kind,
      blueprintVersionId: over.blueprintVersionId === undefined ? BASE.blueprintVersionId : over.blueprintVersionId,
    },
  );
}

async function countsIn(orgId: string) {
  return asApp(orgId, async (c) => ({
    projects: Number(
      (await c.query("SELECT count(*)::int AS n FROM projects WHERE org_id = $1", [orgId])).rows[0]!.n,
    ),
    workshops: Number(
      (await c.query("SELECT count(*)::int AS n FROM workshops WHERE org_id = $1", [orgId])).rows[0]!.n,
    ),
    replay: Number(
      (await c.query("SELECT count(*)::int AS n FROM project_creation_requests WHERE org_id = $1", [orgId]))
        .rows[0]!.n,
    ),
  }));
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  identity = new PgIdentityRepository(db);
  repo = new PgProjectRepository(db, new UuidIdFactory());
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, ORG_B);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, ORG_B);
  for (const [org, lead] of [
    [ORG, LEAD],
    [ORG_B, LEAD_B],
  ] as const) {
    await asApp(org, (c) =>
      c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [org, `org ${org}`]),
    );
    await addOrgMember(org, lead, "lead", null);
    // BP-08：stub 解析出的 blueprintId 必须对应一条真实 `blueprints` 行——
    // `blueprint_bindings.blueprint_id` 有外键，否则 submit() 会在写绑定这一步
    // 因 23503 被翻译成 INITIALIZATION_FAILED，而本文件测的是指纹判据，不是这个。
    await asApp(org, (c) =>
      c.query(
        `INSERT INTO blueprints (id, org_id, name, origin, created_by) VALUES ($1,$2,$3,'blank',$4)`,
        [`bp-fixture-${org}`, org, "指纹测试用蓝本", lead],
      ),
    );
  }
  // 同一个人也是 ORG_B 的 lead —— 「换组织」那条边界要能单独动一个分量。
  await addOrgMember(ORG_B, LEAD, "lead", null);
}, HOOK_TIMEOUT_MS);

describe("重复提交", () => {
  it("两次同样的请求 ⇒ 同一个容器，且 `projects` 只多了一行", async () => {
    const first = await submit();
    const second = await submit();

    expect(second.id).toBe(first.id);
    // `created` 是这条断言的关键：只看 id 相等的话，一个「每次新建、id 由 name 派生」
    // 的实现也会绿，而它其实写了两次。
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const c = await countsIn(ORG);
    expect(c.projects).toBe(1);
    expect(c.workshops).toBe(1);
    expect(c.replay).toBe(1);
  });

  it("重放返回的是**先前那个**容器，不是这次新生成的 id", async () => {
    const first = await submit();
    const second = await submit();
    // 反向：库里存在的恰好就是返回的那个 id。返回一个从未落库的 id，
    // 调用方拿到 200 之后去读会 404，而「两次 id 相同」那条断言看不见这件事。
    const exists = await asApp(ORG, async (c) =>
      Number(
        (await c.query("SELECT count(*)::int AS n FROM projects WHERE id = $1", [second.id])).rows[0]!.n,
      ),
    );
    expect(exists).toBe(1);
    expect(second.id).toBe(first.id);
  });

  it("十次重复提交仍然只有一个容器（幂等不是「第二次特判」）", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i += 1) ids.add((await submit()).id);
    expect(ids.size).toBe(1);
    expect((await countsIn(ORG)).projects).toBe(1);
  });
});

describe("判据的边界：五个分量各改一个，都必须建出**新的**容器", () => {
  it("name 不同", async () => {
    const a = await submit();
    const b = await submit({ name: "另一个名字" });
    expect(b.id).not.toBe(a.id);
    expect((await countsIn(ORG)).projects).toBe(2);
  });

  it("kind 不同", async () => {
    const a = await submit();
    const b = await submit({ kind: "research_project" });
    expect(b.id).not.toBe(a.id);
    expect((await countsIn(ORG)).projects).toBe(2);
  });

  it("蓝本不同（null ↔ 有值，以及两个不同的蓝本）", async () => {
    const blank = await submit();
    const bp1 = await submit({ blueprintVersionId: "bp-1" });
    const bp2 = await submit({ blueprintVersionId: "bp-2" });
    expect(new Set([blank.id, bp1.id, bp2.id]).size).toBe(3);
    // ⚠ `""` 是 `z.string().nullable()` 的合法取值，必须与 `null` 分开。
    const empty = await submit({ blueprintVersionId: "" });
    expect(empty.id).not.toBe(blank.id);
    expect((await countsIn(ORG)).projects).toBe(4);
  });

  it("🔴 发起人不同 ⇒ 另一个 lead 提交**逐字相同**的请求，拿到的是新容器", async () => {
    // 这一条同时是 `lint-permission-paths` 白名单那条豁免的载荷断言：
    // 本文件在库里只可能读回**自己**提交过的那次请求的回声。
    await addOrgMember(ORG, "u-f117-idem-lead-2", "lead", null);
    const a = await submit();
    const b = await submit({ actorId: "u-f117-idem-lead-2" });
    expect(b.id).not.toBe(a.id);
    expect(b.created).toBe(true);
    expect((await countsIn(ORG)).projects).toBe(2);
  });

  it("组织不同 ⇒ 同一个人在另一个组织提交同样的请求，拿到的是新容器", async () => {
    const a = await submit();
    const b = await submit({ orgId: ORG_B });
    expect(b.id).not.toBe(a.id);
    expect((await countsIn(ORG)).projects).toBe(1);
    expect((await countsIn(ORG_B)).projects).toBe(1);
  });
});

describe("并发：两路同时提交同一个请求", () => {
  it("恰好一个容器，且两路拿到同一个 id", async () => {
    // 真并发，不是两次顺序调用：顺序调用下「先 SELECT 再决定」的错误写法也会绿。
    const [a, b] = await Promise.all([submit(), submit()]);
    expect(a.id).toBe(b.id);
    // 恰好一路认为自己是新建的。两路都 created=true 意味着两次插入都发生了。
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);

    const c = await countsIn(ORG);
    expect(c.projects).toBe(1);
    expect(c.workshops).toBe(1);
    expect(c.replay).toBe(1);
  });
});

describe("反证：指纹分量真的进了散列（不是一个恒定值）", () => {
  it("五个分量逐个变动，指纹逐个变；同样的入参指纹稳定", () => {
    const base = {
      orgId: ORG,
      actorId: LEAD,
      kind: "workshop",
      name: "季度复盘",
      blueprintVersionId: null as string | null,
    };
    const fp = creationFingerprint(base);
    expect(creationFingerprint({ ...base })).toBe(fp); // 稳定
    for (const over of [
      { orgId: ORG_B },
      { actorId: "someone-else" },
      { kind: "user_insight" },
      { name: "季度复盘 " },
      { blueprintVersionId: "bp-1" },
      { blueprintVersionId: "" },
    ]) {
      expect(creationFingerprint({ ...base, ...over }), JSON.stringify(over)).not.toBe(fp);
    }
  });

  it("拼接不会串位：`{name:'a', bp:'b'}` 与 `{name:'a b', bp:null}` 指纹不同", () => {
    // 用可打印分隔符时这两者会算出同一个串，于是两个**不同**的请求互相幂等掉一个，
    // 而两次调用都返回 200。分隔符是不可打印的 NUL，正是为了这一条。
    const base = { orgId: ORG, actorId: LEAD, kind: "workshop" };
    expect(creationFingerprint({ ...base, name: "a", blueprintVersionId: "b" })).not.toBe(
      creationFingerprint({ ...base, name: "a b", blueprintVersionId: null }),
    );
  });
});

/* ── `lint-permission-paths` 白名单那条豁免的**载荷**（见脚本里的条目） ── */

describe("豁免的前提：仓储对租户表只有 INSERT，加一条 actor 限定的回声 SELECT", () => {
  const SRC = fileURLToPath(
    new URL("../../src/infrastructure/project/pg-project-repository.ts", import.meta.url),
  );

  it("除那条回声 SELECT 外，没有第二条读租户表的语句", () => {
    const body = readFileSync(SRC, "utf8");
    const code = body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

    // 非空转：文件确实被读到了，且它确实在写那三张表。
    expect(code).toMatch(/INSERT INTO projects/);
    expect(code).toMatch(/INSERT INTO project_creation_requests/);

    const selects = [...code.matchAll(/SELECT[\s\S]*?;|SELECT[\s\S]*?`/g)].map((m) => m[0]);
    expect(selects.length, "SELECT 一条都没扫到 —— 本断言在空转").toBe(1);
    // 唯一那条必须同时被指纹与发起人限定。少了 actor_id，豁免的论证就只剩
    // 「另一个文件里的某个函数碰巧把 actorId 拌进了指纹」。
    expect(selects[0]).toMatch(/r\.fingerprint = \$1 AND r\.actor_id = \$2/);
  });
});
