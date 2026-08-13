/**
 * F175（BP-01）—— 蓝本真实落库：`POST /blueprints` 的存储侧。
 *
 * ## 这个文件在钉什么
 *
 * templates 束此前是「34 个契约 operation + 32 个纯用例，零表零仓储零路由」（#991）。
 * 纯用例的单测早就全绿——它们测的是编排，**不碰存储**。所以「蓝本能不能存下来」
 * 这件事在本文件之前**没有任何测试覆盖**，而它正是 track P 的 P1。
 *
 * ⇒ 因此本文件的断言全部落在**真实 Postgres 的行**上，不是返回值。
 *   一个只返回正确 out 形状、却不写库的实现，会在这里全红。
 *
 * ## 三条反证（缺一条，对应的正向断言就是空转的）
 *
 *   ① 唯一写点     —— `INSERT INTO blueprints` 在 `apps/api/src` 里恰好出现一次。
 *                     没有它，「一条创建路径」只是注释；第二个写点出现时没人会发现。
 *   ② 原子性       —— 故障注入在「蓝本行已写、设计环节行还没写」那一刻抛：
 *                     正确实现（一个事务）回滚干净；两次提交的实现会留下一个**空壳蓝本**，
 *                     而用户看到的是「复制成功」。
 *   ③ 注入器不是「让什么都失败」—— 把注入点放到语句总数之外 ⇒ 创建正常成功。
 *                     缺它时，一个永远抛异常的注入器会让 ② 白绿。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PgBlueprintRepository } from "../../src/infrastructure/templates/pg-blueprint-repository";
import { BlueprintController } from "../../src/interface/controllers/blueprint.controller";
import { templates as C } from "@repo/contracts";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { OrgId } from "../../src/domain/org-id";
import { toOrgId } from "../../src/domain/org-id";
import { DESIGN_FACET_DEFINITIONS, designFacetKeys } from "../../src/domain/templates/design-facet-table";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import type { Guarded } from "../../src/application/security/permission-filter";
import { decideCapabilityVisibility } from "../../src/domain/identity/capability-listing";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "f173-bp-org";
const ACTOR = "u-f173-admin";
const HOOK_TIMEOUT_MS = 120_000;

/**
 * 测试里也拿不到裸 payload —— 这正是 `Guarded<T>` 的设计意图：
 * 「读到租户内容」必须伴随一次判定，**连测试都不能绕过**。
 * 这里用 admin + 组织级可见性判一次，等价于生产里 org admin 看自己组织的蓝本。
 */
function discloseAll<T>(rows: readonly { facts: { scope: "org-wide" | "team-only"; ownerTeamId: string | null }; listing: Guarded<T> }[]): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const d = discloseDecided(
      row.listing,
      decideCapabilityVisibility({
        decisionId: "dec-test",
        orgRole: "admin",
        requesterTeamId: null,
        scope: row.facts.scope,
        ownerTeamId: row.facts.ownerTeamId,
      }),
    );
    if (isDisclosed(d)) out.push(d.payload);
  }
  return out;
}

let db: PgDatabase;
let repo: PgBlueprintRepository;

/** 计数并在第 `failAt` 条语句上抛。计数每次 withTenant 重置：注入点谈的是事务内的位置。 */
class FaultyDatabase implements DatabasePort {
  constructor(
    private readonly inner: DatabasePort,
    private readonly failAt: number,
  ) {}

  withTenant<T>(orgId: OrgId, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    let n = 0;
    return this.inner.withTenant(orgId, (s) =>
      fn({
        query: async (sql, params) => {
          n += 1;
          if (n === this.failAt) throw new Error(`injected fault at statement ${n}`);
          return s.query(sql, params);
        },
      }),
    );
  }

  // 故障注入器只改 `withTenant` 这一条路径——业务写入全部走它。
  // 另外两个方法原样转发：**不是**样板，是刻意不去改它们
  // （`withoutTenant` 被本仓明确限定为内核自检/健康探针，业务不许用）。
  withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.inner.withoutTenant(fn);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

async function countBlueprints(orgId: string): Promise<number> {
  const r = await asApp(orgId, (c) =>
    c.query<{ n: string }>(`SELECT count(*) AS n FROM blueprints WHERE org_id = $1`, [orgId]),
  );
  return Number(r.rows[0]?.n ?? "0");
}

async function countFacets(orgId: string, blueprintId: string): Promise<number> {
  const r = await asApp(orgId, (c) =>
    c.query<{ n: string }>(`SELECT count(*) AS n FROM blueprint_design_facets WHERE blueprint_id = $1`, [blueprintId]),
  );
  return Number(r.rows[0]?.n ?? "0");
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgBlueprintRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  // `blueprints.org_id` 是外键 ⇒ 必须先有组织行。建组织的是 `seedOrg`（不是
  // `addOrgMember`，后者只加成员，组织不存在时它自己也会撞外键）。
  // ⚠ 这条外键是有意的：蓝本属于组织，组织没了它不该留着。
  await seedOrg({ orgId: ORG, projectId: "prj-f173-fixture" });
  await addOrgMember(ORG, ACTOR, "admin", null);
}, HOOK_TIMEOUT_MS);

describe("F175 蓝本真实落库", () => {
  /**
   * ⚠ 这条钉住的是**仓储测试钉不住**的那类 bug：本文件所有其它用例都直接调
   * `repo.list()`/`repo.create()`，跳过了控制器把行拼成契约形状那一步——
   * BP-01 实测就在那一步栽过一次（把 `Completeness` 写成 `{filled,total}`，
   * 契约要的是 `{done,denominator}`，`.strict()` 会让前端在生产上直接炸，
   * 而所有仓储测试全绿看不出这个问题）。
   *
   * 不起 HTTP、不 mock 身份服务——直接实例化控制器类，用真实身份仓储
   * （同一个 db），断言返回值能被契约 schema `.parse()` 通过。
   */
  it("控制器的 list 输出逐字段对得上契约 schema（不只是仓储对得上）", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-shape", orgId, actorId: ACTOR, name: "形状校验用",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });

    const identity = new (
      await import("../../src/infrastructure/identity/pg-identity-repository")
    ).PgIdentityRepository(db);
    const ids = { next: (prefix: string) => `${prefix}-test-${Math.random().toString(36).slice(2)}` };
    const controller = new BlueprintController(repo, identity, ids as never);

    const out = await controller.list(ORG, undefined, { userId: ACTOR, orgId: ORG } as never);
    // `.strict()` schema：多一个字段、少一个字段、字段名拼错，`.parse()` 全部会抛。
    expect(() => C.operations.listBlueprints.out.parse(out)).not.toThrow();
    const parsed = C.operations.listBlueprints.out.parse(out);
    expect(parsed.find((r) => r.blueprintId === "bp-shape")?.completeness.denominator).toBeGreaterThan(0);
  });


  it("空白新建：写进 DB，刷新（重新读）后仍在", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-blank-1",
      orgId,
      actorId: ACTOR,
      name: "空白蓝本",
      origin: "blank",
      sourceId: null,
      machineGenerated: false,
      designFacets: new Map(),
    });

    // 断言落在**行**上，不是返回值：只返回不写库的实现在这里红。
    expect(await countBlueprints(ORG)).toBe(1);

    const rows = discloseAll(await repo.list(orgId, null));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      blueprintId: "bp-blank-1",
      name: "空白蓝本",
      state: "draft",
      versionNumber: 0,
      filledDesignFacetCount: 0,
    });
  });

  it("复制：源蓝本已填的设计环节内容跟着进新蓝本", async () => {
    const orgId = toOrgId(ORG);
    const [k1, k2] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    await repo.create({
      blueprintId: "bp-src",
      orgId,
      actorId: ACTOR,
      name: "源蓝本",
      origin: "blank",
      sourceId: null,
      machineGenerated: false,
      designFacets: new Map([
        [k1!, "主题内容"],
        [k2!, "议程内容"],
      ]),
    });

    const copied = await repo.readDesignFacets(orgId, "bp-src");
    expect(copied.size).toBe(2);

    await repo.create({
      blueprintId: "bp-copy",
      orgId,
      actorId: ACTOR,
      name: "复制出来的",
      origin: "copy",
      sourceId: "bp-src",
      machineGenerated: false,
      designFacets: copied,
    });

    expect(await countFacets(ORG, "bp-copy")).toBe(2);
    const rows = discloseAll(await repo.list(orgId, null));
    const copy = rows.find((r) => r.blueprintId === "bp-copy");
    expect(copy?.filledDesignFacetCount).toBe(2);
  });

  it("完成度分母来自定义表本身，而不是任何写死的数字", async () => {
    // 这条不测仓储，测的是「分母的唯一事实源」这条纪律：定义表有几项，分母就是几。
    // ⚠ 这里**不写任何具体数字**——写了它就成了第二处声明，定义表一改这条断言就在撒谎
    //   （`lint-design-facet-single-source` 会直接拦下带数字的写法，它是对的）。
    expect(designFacetKeys(DESIGN_FACET_DEFINITIONS).length).toBe(DESIGN_FACET_DEFINITIONS.length);
    expect(DESIGN_FACET_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it("按状态过滤：草稿态能被单独列出", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-d1", orgId, actorId: ACTOR, name: "草稿一",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    expect(await repo.list(orgId, "draft")).toHaveLength(1);
    // 已发布态本版还没有任何写入路径（BP-04 才发布）⇒ 真实为空，不是「未知」
    expect(await repo.list(orgId, "published")).toHaveLength(0);
  });

  it("组织隔离：读不到别的组织的蓝本", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-mine", orgId, actorId: ACTOR, name: "我的",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const other = toOrgId("f173-other-org");
    await resetOrgs("f173-other-org");
    await seedOrg({ orgId: "f173-other-org", projectId: "prj-f173-other" });
    expect(await repo.list(other, null)).toHaveLength(0);
    expect(await repo.exists(other, "bp-mine")).toBe(false);
  });

  it("反证①：`INSERT INTO blueprints` 在 src 下恰好一处", () => {
    const root = fileURLToPath(new URL("../../src", import.meta.url));
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith(".ts")) continue;
        if (/INSERT\s+INTO\s+blueprints\b/i.test(readFileSync(p, "utf8"))) hits.push(relative(root, p));
      }
    };
    walk(root);
    // 没有这条断言，「一条创建路径」只是注释——第二个写点出现时不会有任何东西报警。
    expect(hits).toEqual(["infrastructure/templates/pg-blueprint-repository.ts"]);
  });

  it("反证②：写到一半崩掉不留空壳蓝本（一个事务）", async () => {
    const orgId = toOrgId(ORG);
    // 语句序：① INSERT blueprints ② INSERT facet ③ INSERT facet
    // 注入点 = 2 ⇒ 蓝本行已写、第一条设计环节还没写的那一刻。
    const faulty = new PgBlueprintRepository(new FaultyDatabase(db, 2));
    const [k1, k2] = designFacetKeys(DESIGN_FACET_DEFINITIONS);

    await expect(
      faulty.create({
        blueprintId: "bp-half", orgId, actorId: ACTOR, name: "半成品",
        origin: "copy", sourceId: null, machineGenerated: false,
        designFacets: new Map([[k1!, "a"], [k2!, "b"]]),
      }),
    ).rejects.toThrow(/injected fault/);

    // 两次提交的实现会在这里留下 1 —— 一个用户看不出问题的空壳蓝本。
    expect(await countBlueprints(ORG)).toBe(0);
    expect(await countFacets(ORG, "bp-half")).toBe(0);
  });

  it("反证③：注入器不是让什么都失败（注入点在语句数之外时正常成功）", async () => {
    const orgId = toOrgId(ORG);
    const faulty = new PgBlueprintRepository(new FaultyDatabase(db, 99));
    await faulty.create({
      blueprintId: "bp-ok", orgId, actorId: ACTOR, name: "正常",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    expect(await countBlueprints(ORG)).toBe(1);
  });
});
