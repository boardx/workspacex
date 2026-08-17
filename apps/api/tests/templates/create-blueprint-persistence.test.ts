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
    const controller = new BlueprintController(repo, identity, ids as never, {} as never);

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

/**
 * F174（BP-02）—— 设计环节逐项写入的 compare-and-swap。
 *
 * 判据来源：`updateDesignFacet` 的乐观并发**粒度 = 单项**（契约注释逐字）。
 */
describe("F174 设计环节逐项 CAS", () => {
  it("首次填一项：expected 用哨兵 '' 即成功，完成度分子 +1", async () => {
    const orgId = toOrgId(ORG);
    const [key] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    await repo.create({
      blueprintId: "bp-cas-1", orgId, actorId: ACTOR, name: "CAS 一号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });

    const out = await repo.updateDesignFacet({
      orgId, blueprintId: "bp-cas-1", designFacetKey: key!,
      value: "主题内容", expectedItemRevision: "",
    });
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("unreachable");
    expect(out.itemRevision).not.toBe("");
    expect(out.filledDesignFacetCount).toBe(1);
  });

  it("拿着旧 revision 再写：VERSION_CHANGED，且内容不被覆盖", async () => {
    const orgId = toOrgId(ORG);
    const [key] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    await repo.create({
      blueprintId: "bp-cas-2", orgId, actorId: ACTOR, name: "CAS 二号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const first = await repo.updateDesignFacet({
      orgId, blueprintId: "bp-cas-2", designFacetKey: key!,
      value: "版本一", expectedItemRevision: "",
    });
    if (first.kind !== "ok") throw new Error("setup failed");

    // 第二个写手不知道第一个已经写过——它还拿着「从未填过」的旧信念。
    const stale = await repo.updateDesignFacet({
      orgId, blueprintId: "bp-cas-2", designFacetKey: key!,
      value: "被抢先的写入", expectedItemRevision: "",
    });
    expect(stale.kind).toBe("version-changed");

    const content = await repo.readDesignFacets(orgId, "bp-cas-2");
    expect(content.get(key!)).toBe("版本一"); // 输家没有覆盖赢家
  });

  it("拿着当前 revision 再写：成功，且 revision 轮换（不是原地不变）", async () => {
    const orgId = toOrgId(ORG);
    const [key] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    await repo.create({
      blueprintId: "bp-cas-3", orgId, actorId: ACTOR, name: "CAS 三号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const first = await repo.updateDesignFacet({
      orgId, blueprintId: "bp-cas-3", designFacetKey: key!,
      value: "版本一", expectedItemRevision: "",
    });
    if (first.kind !== "ok") throw new Error("setup failed");

    const second = await repo.updateDesignFacet({
      orgId, blueprintId: "bp-cas-3", designFacetKey: key!,
      value: "版本二", expectedItemRevision: first.itemRevision,
    });
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") throw new Error("unreachable");
    expect(second.itemRevision).not.toBe(first.itemRevision); // 不轮换，第三方就没法判断"这次写有没有真的发生"
    expect(second.filledDesignFacetCount).toBe(1); // 更新不是新增

    const content = await repo.readDesignFacets(orgId, "bp-cas-3");
    expect(content.get(key!)).toBe("版本二");
  });

  it("写空串 = 删掉这一项：完成度分子 -1，revision 回到哨兵", async () => {
    const orgId = toOrgId(ORG);
    const [key] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    await repo.create({
      blueprintId: "bp-cas-4", orgId, actorId: ACTOR, name: "CAS 四号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const filled = await repo.updateDesignFacet({
      orgId, blueprintId: "bp-cas-4", designFacetKey: key!,
      value: "先填上", expectedItemRevision: "",
    });
    if (filled.kind !== "ok") throw new Error("setup failed");

    const cleared = await repo.updateDesignFacet({
      orgId, blueprintId: "bp-cas-4", designFacetKey: key!,
      value: "", expectedItemRevision: filled.itemRevision,
    });
    expect(cleared.kind).toBe("ok");
    if (cleared.kind !== "ok") throw new Error("unreachable");
    expect(cleared.itemRevision).toBe("");
    expect(cleared.filledDesignFacetCount).toBe(0);

    const content = await repo.readDesignFacets(orgId, "bp-cas-4");
    expect(content.has(key!)).toBe(false);
  });

  it("蓝本不存在：BLUEPRINT_NOT_FOUND（不是把它当成一个新键去建）", async () => {
    const orgId = toOrgId(ORG);
    const [key] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    const out = await repo.updateDesignFacet({
      orgId, blueprintId: "bp-does-not-exist", designFacetKey: key!,
      value: "x", expectedItemRevision: "",
    });
    expect(out.kind).toBe("blueprint-not-found");
  });

  it("反证：迁移的易失默认值确实逐行求值（不是全表共享同一个 revision）", async () => {
    // 这条不测应用逻辑，测的是我在迁移文件头注里写下的那句关于 PG 行为的断言——
    // 不能只信记忆，得让真实数据库回答。若这条红，说明所有历史行共享同一个
    // revision，CAS 的「谁先写谁后写」判定会失去意义。
    const orgId = toOrgId(ORG);
    const keys = designFacetKeys(DESIGN_FACET_DEFINITIONS).slice(0, 3);
    const designFacets = new Map(keys.map((k) => [k, `内容-${k}`]));
    await repo.create({
      blueprintId: "bp-revision-distinct", orgId, actorId: ACTOR, name: "revision 分布",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets,
    });
    const rows = await asApp(ORG, (c) =>
      c.query<{ item_revision: string }>(
        `SELECT item_revision FROM blueprint_design_facets WHERE blueprint_id = $1`,
        ["bp-revision-distinct"],
      ),
    );
    const revisions = new Set(rows.rows.map((r) => r.item_revision));
    expect(revisions.size).toBe(keys.length); // 全部互不相同
  });
});

describe("F177 换时长档位", () => {
  /** 测试直接读 revision——见 KNOWN_CONTRACT_GAPS.T13：契约没有给调用方读它的路径,
   *  真库测试只能这样构造合法的第一次 expectedVersion。 */
  async function currentRevision(blueprintId: string): Promise<string> {
    const r = await asApp(ORG, (c) =>
      c.query<{ revision: string }>(`SELECT revision FROM blueprints WHERE id = $1`, [blueprintId]),
    );
    return r.rows[0]!.revision;
  }

  it("首次选档位（当前恒为 custom/未选）：无需确认，agendaSegmentCount 与定义表一致", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-tier-1", orgId, actorId: ACTOR, name: "档位一号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const rev = await currentRevision("bp-tier-1");

    const out = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-1", tier: "two-day", confirmed: false, expectedVersion: rev,
    });
    expect(out.kind).toBe("applied");
    if (out.kind !== "applied") throw new Error("unreachable");
    expect(out.agendaSegmentCount).toBe(14); // R3 主表：两天 = 14（agenda-segment-table.ts 头注）
    expect(out.added.length).toBe(14);
    expect(out.removed.length).toBe(0);
    expect(out.newRevision).not.toBe(rev); // 首次选档位也是一次真实写入，revision 必须轮换
  });

  it("升档（两天→三天）：纯新增，不需要确认即可成功", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-tier-2", orgId, actorId: ACTOR, name: "档位二号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const rev1 = await currentRevision("bp-tier-2");
    const first = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-2", tier: "two-day", confirmed: false, expectedVersion: rev1,
    });
    if (first.kind !== "applied") throw new Error("setup failed");

    const second = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-2", tier: "three-day", confirmed: false, expectedVersion: first.newRevision,
    });
    expect(second.kind).toBe("applied");
    if (second.kind !== "applied") throw new Error("unreachable");
    expect(second.agendaSegmentCount).toBe(19);
    expect(second.removed.length).toBe(0); // 升档不丢东西，不该出现在 removed 里
  });

  it("降档（两天→半天）不带 confirmed：拒绝，返回将被移除的清单，不落库", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-tier-3", orgId, actorId: ACTOR, name: "档位三号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const rev1 = await currentRevision("bp-tier-3");
    const first = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-3", tier: "two-day", confirmed: false, expectedVersion: rev1,
    });
    if (first.kind !== "applied") throw new Error("setup failed");

    const attempt = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-3", tier: "half-day", confirmed: false, expectedVersion: first.newRevision,
    });
    expect(attempt.kind).toBe("confirmation-required");
    if (attempt.kind !== "confirmation-required") throw new Error("unreachable");
    expect(attempt.removed.length).toBe(7); // 两天(14) - 半天(7) = 7 项会被移除

    // 反证：没有 confirmed 就不落库——档位仍是 two-day，revision 没有轮换
    const revAfter = await currentRevision("bp-tier-3");
    expect(revAfter).toBe(first.newRevision);
  });

  it("同一次降档带 confirmed=true：成功，被移除的环节全部进 recoverable（A2 不静默丢弃）", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-tier-4", orgId, actorId: ACTOR, name: "档位四号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const rev1 = await currentRevision("bp-tier-4");
    const first = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-4", tier: "two-day", confirmed: false, expectedVersion: rev1,
    });
    if (first.kind !== "applied") throw new Error("setup failed");

    const confirmed = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-4", tier: "half-day", confirmed: true, expectedVersion: first.newRevision,
    });
    expect(confirmed.kind).toBe("applied");
    if (confirmed.kind !== "applied") throw new Error("unreachable");
    expect(confirmed.agendaSegmentCount).toBe(7);
    expect(confirmed.removed.length).toBe(7);
    expect(confirmed.recoverable.length).toBe(7); // 全部可恢复——被移除的行在定义表里恒 optional:true
  });

  it("拿着过期 revision：VERSION_CHANGED，且落败方不覆盖赢家", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-tier-5", orgId, actorId: ACTOR, name: "档位五号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const rev1 = await currentRevision("bp-tier-5");
    const winner = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-5", tier: "two-day", confirmed: false, expectedVersion: rev1,
    });
    if (winner.kind !== "applied") throw new Error("setup failed");

    // 落败方还拿着建蓝本时的旧 revision
    const loser = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-5", tier: "three-day", confirmed: false, expectedVersion: rev1,
    });
    expect(loser.kind).toBe("version-changed");

    const revAfter = await currentRevision("bp-tier-5");
    expect(revAfter).toBe(winner.newRevision); // 赢家的写入没有被落败方覆盖
  });

  it("目标档位 custom：拒绝，CUSTOM_TIER_RULE_UNDEFINED（D-7，规则本身未定）", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-tier-6", orgId, actorId: ACTOR, name: "档位六号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const rev = await currentRevision("bp-tier-6");
    const out = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-6", tier: "custom", confirmed: true, expectedVersion: rev,
    });
    expect(out.kind).toBe("custom-tier-undefined");
  });

  it("蓝本不存在：blueprint-not-found", async () => {
    const orgId = toOrgId(ORG);
    const out = await repo.setDurationTier({
      orgId, blueprintId: "bp-does-not-exist", tier: "two-day", confirmed: false, expectedVersion: "",
    });
    expect(out.kind).toBe("blueprint-not-found");
  });

  it("list() 的 agendaSegmentCount 随 duration_tier 实时派生，不是写死的 0", async () => {
    // 钉住我在本 feature 里改掉的那处硬编码——反证：换档位前 list() 报 0（未选档位的真实值），
    // 换档位后 list() 必须报与定义表一致的数，不能停留在创建时刻的旧值。
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-tier-list", orgId, actorId: ACTOR, name: "档位与列表",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const before = discloseAll(await repo.list(orgId, null)).find((b) => b.blueprintId === "bp-tier-list");
    expect(before?.agendaSegmentCount).toBe(0);

    const rev = await currentRevision("bp-tier-list");
    const applied = await repo.setDurationTier({
      orgId, blueprintId: "bp-tier-list", tier: "one-day", confirmed: false, expectedVersion: rev,
    });
    if (applied.kind !== "applied") throw new Error("setup failed");

    const after = discloseAll(await repo.list(orgId, null)).find((b) => b.blueprintId === "bp-tier-list");
    expect(after?.agendaSegmentCount).toBe(11); // R3 主表：一天 = 11
  });
});

describe("F179 试跑与发布版本", () => {
  it("没试跑过直接发布：TRIAL_RUN_REQUIRED，且不占版本号（I-3）", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-publish-1", orgId, actorId: ACTOR, name: "发布一号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });

    const out = await repo.publishBlueprintVersion({
      orgId, blueprintId: "bp-publish-1", expectedCurrentVersionNumber: 0, newVersionId: "bpv-1",
    });
    expect(out.kind).toBe("gate-blocked");
    if (out.kind !== "gate-blocked") throw new Error("unreachable");
    expect(out.reasonCode).toBe("TRIAL_RUN_REQUIRED");

    // 反证 I-3「失败不占号」：blueprints.version_number 原地不动，
    // blueprint_versions 没有任何行——不是「生成了但没提交」，是根本没写。
    const bp = await asApp(ORG, (c) =>
      c.query<{ version_number: number; state: string }>(
        `SELECT version_number, state FROM blueprints WHERE id = $1`,
        ["bp-publish-1"],
      ),
    );
    expect(bp.rows[0]!.version_number).toBe(0);
    expect(bp.rows[0]!.state).toBe("draft");
    const versions = await asApp(ORG, (c) =>
      c.query<{ n: string }>(`SELECT count(*) AS n FROM blueprint_versions WHERE blueprint_id = $1`, ["bp-publish-1"]),
    );
    expect(Number(versions.rows[0]!.n)).toBe(0);
  });

  it("试跑一次后发布：成功，版本号从 0 变 1，蓝本转已发布", async () => {
    const orgId = toOrgId(ORG);
    const [key] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    await repo.create({
      blueprintId: "bp-publish-2", orgId, actorId: ACTOR, name: "发布二号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    await repo.updateDesignFacet({
      orgId, blueprintId: "bp-publish-2", designFacetKey: key!,
      value: "主题内容", expectedItemRevision: "",
    });

    const trial = await repo.startTrialRun({ orgId, blueprintId: "bp-publish-2", trialRunId: "trial-1" });
    expect(trial.kind).toBe("ok");

    const out = await repo.publishBlueprintVersion({
      orgId, blueprintId: "bp-publish-2", expectedCurrentVersionNumber: 0, newVersionId: "bpv-2",
    });
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("unreachable");
    expect(out.versionNumber).toBe(1);
    expect(out.archivedVersionId).toBeNull(); // 首发没有旧版可归档
    expect(out.changedDesignFacetKeys).toEqual([key]); // 首发：已填的都算改动

    const bp = await asApp(ORG, (c) =>
      c.query<{ version_number: number; state: string }>(
        `SELECT version_number, state FROM blueprints WHERE id = $1`,
        ["bp-publish-2"],
      ),
    );
    expect(bp.rows[0]!.version_number).toBe(1);
    expect(bp.rows[0]!.state).toBe("published");
  });

  it("拿着过期的 expectedCurrentVersionNumber 发布：VERSION_CHANGED", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-publish-3", orgId, actorId: ACTOR, name: "发布三号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    await repo.startTrialRun({ orgId, blueprintId: "bp-publish-3", trialRunId: "trial-2" });
    const first = await repo.publishBlueprintVersion({
      orgId, blueprintId: "bp-publish-3", expectedCurrentVersionNumber: 0, newVersionId: "bpv-3",
    });
    if (first.kind !== "ok") throw new Error("setup failed");

    // 第二个调用方不知道刚刚已经发布过，还拿着 0（发布前的版本号）
    const stale = await repo.publishBlueprintVersion({
      orgId, blueprintId: "bp-publish-3", expectedCurrentVersionNumber: 0, newVersionId: "bpv-3-stale",
    });
    expect(stale.kind).toBe("version-changed");
  });

  it("发布两次：旧版转 archived，新版 published，版本号单调递增", async () => {
    const orgId = toOrgId(ORG);
    const [key] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    await repo.create({
      blueprintId: "bp-publish-4", orgId, actorId: ACTOR, name: "发布四号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    await repo.startTrialRun({ orgId, blueprintId: "bp-publish-4", trialRunId: "trial-3" });
    const v1 = await repo.publishBlueprintVersion({
      orgId, blueprintId: "bp-publish-4", expectedCurrentVersionNumber: 0, newVersionId: "bpv-4a",
    });
    if (v1.kind !== "ok") throw new Error("setup failed");

    // v2 之前改一项内容，验证 changedDesignFacetKeys 只算真正变了的
    await repo.updateDesignFacet({
      orgId, blueprintId: "bp-publish-4", designFacetKey: key!,
      value: "v2 内容", expectedItemRevision: "",
    });
    const v2 = await repo.publishBlueprintVersion({
      orgId, blueprintId: "bp-publish-4", expectedCurrentVersionNumber: 1, newVersionId: "bpv-4b",
    });
    expect(v2.kind).toBe("ok");
    if (v2.kind !== "ok") throw new Error("unreachable");
    expect(v2.versionNumber).toBe(2);
    expect(v2.archivedVersionId).toBe("bpv-4a");
    expect(v2.changedDesignFacetKeys).toEqual([key]);

    const rows = await asApp(ORG, (c) =>
      c.query<{ id: string; state: string; version_number: number }>(
        `SELECT id, state, version_number FROM blueprint_versions WHERE blueprint_id = $1 ORDER BY version_number`,
        ["bp-publish-4"],
      ),
    );
    expect(rows.rows).toEqual([
      { id: "bpv-4a", state: "archived", version_number: 1 },
      { id: "bpv-4b", state: "published", version_number: 2 },
    ]);
  });

  it("发布不存在的蓝本：BLUEPRINT_NOT_FOUND", async () => {
    const orgId = toOrgId(ORG);
    const out = await repo.publishBlueprintVersion({
      orgId, blueprintId: "bp-does-not-exist", expectedCurrentVersionNumber: 0, newVersionId: "bpv-x",
    });
    expect(out.kind).toBe("blueprint-not-found");
  });

  it("试跑不存在的蓝本：BLUEPRINT_NOT_FOUND", async () => {
    const orgId = toOrgId(ORG);
    const out = await repo.startTrialRun({ orgId, blueprintId: "bp-does-not-exist", trialRunId: "trial-x" });
    expect(out.kind).toBe("blueprint-not-found");
  });

  it("试跑不计入已套用项目数（I-22）——控制器层 list() 的 appliedProjectCount 仍是 0", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-publish-5", orgId, actorId: ACTOR, name: "发布五号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    await repo.startTrialRun({ orgId, blueprintId: "bp-publish-5", trialRunId: "trial-4" });
    await repo.startTrialRun({ orgId, blueprintId: "bp-publish-5", trialRunId: "trial-5" });

    const rows = discloseAll(await repo.list(orgId, null));
    const row = rows.find((r) => r.blueprintId === "bp-publish-5");
    expect(row?.appliedProjectCount).toBe(0); // 两次试跑，一次「套用」都没有
  });

  it("反证：两条并发试跑各自留痕，不互相覆盖（没有 CAS 冲突）", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-publish-6", orgId, actorId: ACTOR, name: "发布六号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const [a, b] = await Promise.all([
      repo.startTrialRun({ orgId, blueprintId: "bp-publish-6", trialRunId: "trial-6a" }),
      repo.startTrialRun({ orgId, blueprintId: "bp-publish-6", trialRunId: "trial-6b" }),
    ]);
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
    const bindings = await asApp(ORG, (c) =>
      c.query<{ n: string }>(
        `SELECT count(*) AS n FROM blueprint_bindings WHERE blueprint_id = $1 AND kind = 'trial-run'`,
        ["bp-publish-6"],
      ),
    );
    expect(Number(bindings.rows[0]!.n)).toBe(2);
  });
});

describe("F186 蓝本读路径缺口 delta —— getBlueprintDesignFacets", () => {
  it("空蓝本读取：designFacets 为空数组，revision 非空", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-read-1", orgId, actorId: ACTOR, name: "读一号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const out = await repo.getBlueprintDesignFacets(orgId, "bp-read-1");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("unreachable");
    expect(out.designFacets).toEqual([]);
    expect(out.revision).not.toBe("");
  });

  it("填了若干项后读取：与写入内容逐项一致", async () => {
    const orgId = toOrgId(ORG);
    const keys = designFacetKeys(DESIGN_FACET_DEFINITIONS).slice(0, 2);
    await repo.create({
      blueprintId: "bp-read-2", orgId, actorId: ACTOR, name: "读二号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const written = await Promise.all(
      keys.map((k) =>
        repo.updateDesignFacet({
          orgId, blueprintId: "bp-read-2", designFacetKey: k, value: `内容-${k}`, expectedItemRevision: "",
        }),
      ),
    );

    const out = await repo.getBlueprintDesignFacets(orgId, "bp-read-2");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("unreachable");
    expect(out.designFacets).toHaveLength(2);
    for (const [i, k] of keys.entries()) {
      const row = out.designFacets.find((f) => f.designFacetKey === k);
      const w = written[i];
      if (w?.kind !== "ok") throw new Error("setup failed");
      expect(row?.content).toBe(`内容-${k}`);
      expect(row?.itemRevision).toBe(w.itemRevision);
    }
  });

  it("revision 随行级写操作（setDurationTier）滚动", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-read-3", orgId, actorId: ACTOR, name: "读三号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const before = await repo.getBlueprintDesignFacets(orgId, "bp-read-3");
    if (before.kind !== "ok") throw new Error("setup failed");

    const tierOut = await repo.setDurationTier({
      orgId, blueprintId: "bp-read-3", tier: "half-day", confirmed: false, expectedVersion: before.revision,
    });
    expect(tierOut.kind).toBe("applied");

    const after = await repo.getBlueprintDesignFacets(orgId, "bp-read-3");
    if (after.kind !== "ok") throw new Error("unreachable");
    expect(after.revision).not.toBe(before.revision); // 不轮换，前端就没法判断这次写有没有真的发生
  });

  it("单条 updateDesignFacet 不影响蓝本级 revision（两个令牌粒度独立）", async () => {
    const orgId = toOrgId(ORG);
    const [key] = designFacetKeys(DESIGN_FACET_DEFINITIONS);
    await repo.create({
      blueprintId: "bp-read-4", orgId, actorId: ACTOR, name: "读四号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const before = await repo.getBlueprintDesignFacets(orgId, "bp-read-4");
    if (before.kind !== "ok") throw new Error("setup failed");

    await repo.updateDesignFacet({
      orgId, blueprintId: "bp-read-4", designFacetKey: key!, value: "内容", expectedItemRevision: "",
    });

    const after = await repo.getBlueprintDesignFacets(orgId, "bp-read-4");
    if (after.kind !== "ok") throw new Error("unreachable");
    expect(after.revision).toBe(before.revision); // 逐项写不该滚动蓝本级令牌——粒度不同，混在一起就分不清谁在动什么
  });

  it("蓝本不存在：BLUEPRINT_NOT_FOUND", async () => {
    const orgId = toOrgId(ORG);
    const out = await repo.getBlueprintDesignFacets(orgId, "bp-does-not-exist-read");
    expect(out.kind).toBe("blueprint-not-found");
  });

  it("反证：并发写不同 key 后读取，itemRevision 互不相同（同 F174 的 revision 分布反证同款套路）", async () => {
    const orgId = toOrgId(ORG);
    const keys = designFacetKeys(DESIGN_FACET_DEFINITIONS).slice(0, 3);
    await repo.create({
      blueprintId: "bp-read-5", orgId, actorId: ACTOR, name: "读五号",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    await Promise.all(
      keys.map((k) =>
        repo.updateDesignFacet({
          orgId, blueprintId: "bp-read-5", designFacetKey: k, value: `内容-${k}`, expectedItemRevision: "",
        }),
      ),
    );
    const out = await repo.getBlueprintDesignFacets(orgId, "bp-read-5");
    if (out.kind !== "ok") throw new Error("unreachable");
    const revisions = new Set(out.designFacets.map((f) => f.itemRevision));
    expect(revisions.size).toBe(keys.length);
  });
});
