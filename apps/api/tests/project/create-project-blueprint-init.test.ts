/**
 * BP-08（F190，人类 2026-08-16 裁：最小闭环 B）—— `createProject` 真正校验
 * `blueprintVersionId` 并写入"套用过"的事实。
 *
 * ## 本文件钉的是什么
 *
 * 五个新签核错误码（`design-deltas/createproject-blueprint-error-codes/`）此前
 * 一个都没有被抛出过——`blueprintVersionId` 只原样落库到重放指纹。本文件证明：
 *   ① 真实拒绝（蓝本不存在 / 版本已归档），不静默放行
 *   ② 真实写入（`blueprint_bindings` 一行），不是只返回一个看起来对的响应
 *   ③ 权限口径唯一权威仍是 `createProject` 的 lead-or-admin（#608），不会被
 *     `apply-blueprint.ts` 的 lead-only 挡下——这是本轮范围收紧后仍然承诺钉住的边
 *   ④ 六类摘要（`initialized`）与 `planSixCategoryInit` 同一个 planner，逐项对得上
 *   ⑤ 六类写入部分失败时整体回滚，不留半成品项目行
 *
 * `BLUEPRINT_NOT_VISIBLE` 在真实 DB 路径上今天**不可达**（蓝本 `scope` 恒 `org-wide`，
 * 见 `pg-blueprint-reference-repository.ts` 头注）——用一个手写的假
 * `BlueprintReferenceRepository` 单独钉住 `create-project.ts` 的分支映射本身没写错，
 * 不是通过真实 DB 产生这个结局。`BLUEPRINT_NOT_PUBLISHED`（`KNOWN_CONTRACT_GAPS.P10`）
 * 更进一步：`ResolveBlueprintReferenceOutcome` 这个判别式联合根本没有对应它的成员——
 * `blueprintVersionId` 直接寻址一条 `blueprint_versions` 行，该表 `state` 只有
 * `published`/`archived` 两值，没有第三种"解析到但未发布"的行状态可产生。本文件不为它
 * 硬造一条测试（那会是测一个从未真正被走过的分支，本身就是一种"全绿但空转"）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../../src/application/project/create-project";
import { planSixCategoryInit } from "../../src/domain/templates/apply-blueprint-init";
import { DESIGN_FACET_DEFINITIONS, designFacetKeys } from "../../src/domain/templates/design-facet-table";
import type { BlueprintReferenceRepository } from "../../src/application/project/ports";
import { PgBlueprintReferenceRepository } from "../../src/infrastructure/project/pg-blueprint-reference-repository";
import { PgProjectRepository } from "../../src/infrastructure/project/pg-project-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { OrgId } from "../../src/domain/org-id";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f190-bp08-org";
const LEAD = "u-f190-bp08-lead";
const ADMIN = "u-f190-bp08-admin";
const HOOK_TIMEOUT_MS = 120_000;

/** I-5：从定义表派生，不重抄字面量（同 `create-blueprint-persistence.test.ts` 的既有做法）。 */
const ALL_FACET_KEYS = designFacetKeys(DESIGN_FACET_DEFINITIONS);
const FACET_1 = ALL_FACET_KEYS[0]!;
const FACET_2 = ALL_FACET_KEYS[1]!;
const FACET_3 = ALL_FACET_KEYS[2]!;

let db: PgDatabase;
let repo: PgProjectRepository;
let identity: PgIdentityRepository;
let blueprintReference: PgBlueprintReferenceRepository;

/** 计数并在第 `failAt` 条语句上抛。计数每次 withTenant 重置（同 F117 反证套路）。 */
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
          if (n === this.failAt) {
            // 模拟"蓝本在解析后、写入前被并发删除"：外键违反的驱动错误码。
            const err = new Error("injected FK violation") as Error & { code: string };
            err.code = "23503";
            throw err;
          }
          return s.query(sql, params);
        },
      }),
    );
  }

  withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.inner.withoutTenant(fn);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

async function seedBlueprintVersion(opts: {
  blueprintId: string;
  versionId: string;
  state: "published" | "archived";
  facetKeys: readonly string[];
  tier: string;
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO blueprints (id, org_id, name, origin, created_by, duration_tier)
       VALUES ($1,$2,$3,'blank',$4,$5)`,
      [opts.blueprintId, ORG, `蓝本 ${opts.blueprintId}`, LEAD, opts.tier],
    ),
  );
  const content = Object.fromEntries(opts.facetKeys.map((k) => [k, `内容-${k}`]));
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO blueprint_versions (id, blueprint_id, org_id, version_number, content, state)
       VALUES ($1,$2,$3,1,$4,$5)`,
      [opts.versionId, opts.blueprintId, ORG, JSON.stringify(content), opts.state],
    ),
  );
}

async function countRows(table: string, where: string, params: unknown[]): Promise<number> {
  const r = await asApp(ORG, (c) =>
    c.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, params),
  );
  return Number(r.rows[0]?.n ?? "0");
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  identity = new PgIdentityRepository(db);
  repo = new PgProjectRepository(db, new UuidIdFactory());
  blueprintReference = new PgBlueprintReferenceRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
  );
  await addOrgMember(ORG, LEAD, "lead", null);
  await addOrgMember(ORG, ADMIN, "admin", null);
}, HOOK_TIMEOUT_MS);

describe("BP-08 真实拒绝：五个新码不是猜的", () => {
  it("blueprintVersionId 不存在 ⇒ BLUEPRINT_NOT_FOUND，不建出项目", async () => {
    const before = await countRows("projects", "org_id = $1", [ORG]);
    await expect(
      createProject(
        { repo, identity, blueprintReference },
        { orgId: toOrgId(ORG), actorId: LEAD, name: "不存在的蓝本", kind: "workshop", blueprintVersionId: "bpv-does-not-exist" },
      ),
    ).rejects.toMatchObject({ reasonCode: "BLUEPRINT_NOT_FOUND" });
    expect(await countRows("projects", "org_id = $1", [ORG])).toBe(before);
  });

  it("版本已归档（新增绑定）⇒ BLUEPRINT_VERSION_ARCHIVED，不建出项目", async () => {
    await seedBlueprintVersion({
      blueprintId: "bp-archived-1",
      versionId: "bpv-archived-1",
      state: "archived",
      facetKeys: [FACET_1],
      tier: "one-day",
    });
    const before = await countRows("projects", "org_id = $1", [ORG]);
    await expect(
      createProject(
        { repo, identity, blueprintReference },
        { orgId: toOrgId(ORG), actorId: LEAD, name: "归档版本", kind: "workshop", blueprintVersionId: "bpv-archived-1" },
      ),
    ).rejects.toMatchObject({ reasonCode: "BLUEPRINT_VERSION_ARCHIVED" });
    expect(await countRows("projects", "org_id = $1", [ORG])).toBe(before);
  });

  it("BLUEPRINT_NOT_VISIBLE：分支映射本身正确（真实 DB 路径今天不可达，走假仓储钉映射）", async () => {
    const fake: BlueprintReferenceRepository = { resolve: async () => ({ kind: "not-visible" }) };
    await expect(
      createProject(
        { repo, identity, blueprintReference: fake },
        { orgId: toOrgId(ORG), actorId: LEAD, name: "不可见", kind: "workshop", blueprintVersionId: "bpv-x" },
      ),
    ).rejects.toMatchObject({ reasonCode: "BLUEPRINT_NOT_VISIBLE" });
  });
});

describe("BP-08 真实写入：blueprint_bindings 记录套用过的事实", () => {
  it("成功套用：写出项目行 + 一行 blueprint_bindings(kind='project')", async () => {
    await seedBlueprintVersion({
      blueprintId: "bp-ok-1",
      versionId: "bpv-ok-1",
      state: "published",
      facetKeys: [FACET_1, FACET_2],
      tier: "two-day",
    });
    const out = await createProject(
      { repo, identity, blueprintReference },
      { orgId: toOrgId(ORG), actorId: LEAD, name: "真实套用", kind: "workshop", blueprintVersionId: "bpv-ok-1" },
    );
    expect(out.created).toBe(true);

    const bindingCount = await countRows(
      "blueprint_bindings",
      "blueprint_id = $1 AND org_id = $2 AND kind = 'project'",
      ["bp-ok-1", ORG],
    );
    expect(bindingCount).toBe(1);
  });

  it("initialized 摘要与 planSixCategoryInit 同源，逐项对得上（AC2）", async () => {
    await seedBlueprintVersion({
      blueprintId: "bp-ok-2",
      versionId: "bpv-ok-2",
      state: "published",
      facetKeys: [FACET_1, FACET_2, FACET_3],
      tier: "one-day",
    });
    const out = await createProject(
      { repo, identity, blueprintReference },
      { orgId: toOrgId(ORG), actorId: LEAD, name: "摘要核对", kind: "workshop", blueprintVersionId: "bpv-ok-2" },
    );
    const expected = planSixCategoryInit([FACET_1, FACET_2, FACET_3], "one-day");
    expect(out.initialized).toEqual(expected.initialized);
    // 恒 6 类（I-17），不是"只列非空类目"。
    expect(out.initialized).toHaveLength(6);
  });

  it("空白新建（blueprintVersionId=null）：initialized 不出现，不写任何 blueprint_bindings 行", async () => {
    const before = await countRows("blueprint_bindings", "org_id = $1", [ORG]);
    const out = await createProject(
      { repo, identity, blueprintReference },
      { orgId: toOrgId(ORG), actorId: LEAD, name: "空白", kind: "workshop", blueprintVersionId: null },
    );
    expect(out.initialized).toBeUndefined();
    expect(await countRows("blueprint_bindings", "org_id = $1", [ORG])).toBe(before);
  });

  it("档位读活表当前值，不是版本发布时刻冻结的值（T15 已知缺口的行为化）", async () => {
    await seedBlueprintVersion({
      blueprintId: "bp-tier-drift",
      versionId: "bpv-tier-drift",
      state: "published",
      facetKeys: [FACET_1],
      tier: "half-day",
    });
    // 发布之后，活表档位被改成 three-day——版本快照从未记录过档位，所以这次套用
    // 拿到的是**活表现在的值**，不是发布那一刻的 half-day（KNOWN_CONTRACT_GAPS.T15）。
    await asApp(ORG, (c) =>
      c.query(`UPDATE blueprints SET duration_tier = 'three-day' WHERE id = $1`, ["bp-tier-drift"]),
    );
    const out = await createProject(
      { repo, identity, blueprintReference },
      { orgId: toOrgId(ORG), actorId: LEAD, name: "档位漂移", kind: "workshop", blueprintVersionId: "bpv-tier-drift" },
    );
    const expectedAtLiveTier = planSixCategoryInit([FACET_1], "three-day");
    const expectedAtFrozenTier = planSixCategoryInit([FACET_1], "half-day");
    expect(out.initialized).toEqual(expectedAtLiveTier.initialized);
    expect(out.initialized).not.toEqual(expectedAtFrozenTier.initialized);
  });
});

describe("BP-08 权限口径：createProject 的 lead-or-admin 是唯一权威", () => {
  it("admin（非 lead）套用一个有效已发布蓝本仍然成功——不会被 apply-blueprint.ts 的 lead-only 挡下", async () => {
    await seedBlueprintVersion({
      blueprintId: "bp-admin-1",
      versionId: "bpv-admin-1",
      state: "published",
      facetKeys: [FACET_1],
      tier: "half-day",
    });
    const out = await createProject(
      { repo, identity, blueprintReference },
      { orgId: toOrgId(ORG), actorId: ADMIN, name: "admin 套用", kind: "workshop", blueprintVersionId: "bpv-admin-1" },
    );
    expect(out.created).toBe(true);
    expect(
      await countRows("blueprint_bindings", "blueprint_id = $1 AND kind = 'project'", ["bp-admin-1"]),
    ).toBe(1);
  });
});

describe("BP-08 反证：六类写入失败整体回滚", () => {
  it("blueprint_bindings 写入失败 ⇒ INITIALIZATION_FAILED，projects 一行都不留", async () => {
    await seedBlueprintVersion({
      blueprintId: "bp-fail-1",
      versionId: "bpv-fail-1",
      state: "published",
      facetKeys: [FACET_1],
      tier: "half-day",
    });
    // 语句序：① 占指纹 ② INSERT projects ③ INSERT 子类型表 ④ INSERT project_memberships
    // （2026-08-16 人类裁决新增，Q-4② 推翻）⑤ INSERT blueprint_bindings。卡在 5。
    const faulty = new PgProjectRepository(new FaultyDatabase(db, 5), new UuidIdFactory());
    const before = await countRows("projects", "org_id = $1", [ORG]);

    await expect(
      createProject(
        { repo: faulty, identity, blueprintReference },
        { orgId: toOrgId(ORG), actorId: LEAD, name: "绑定失败", kind: "workshop", blueprintVersionId: "bpv-fail-1" },
      ),
    ).rejects.toMatchObject({ reasonCode: "INITIALIZATION_FAILED" });

    // 🔴 整个事务回滚——不留一个"建了但没绑定成功"的项目行。
    expect(await countRows("projects", "org_id = $1", [ORG])).toBe(before);
    expect(await countRows("workshops", "org_id = $1", [ORG])).toBe(before);
  });

  it("注入器不是「让什么都失败」：注入点在语句数之外时正常成功", async () => {
    await seedBlueprintVersion({
      blueprintId: "bp-fail-2",
      versionId: "bpv-fail-2",
      state: "published",
      facetKeys: [FACET_1],
      tier: "half-day",
    });
    const faulty = new PgProjectRepository(new FaultyDatabase(db, 99), new UuidIdFactory());
    const out = await createProject(
      { repo: faulty, identity, blueprintReference },
      { orgId: toOrgId(ORG), actorId: LEAD, name: "注入器不挡路", kind: "workshop", blueprintVersionId: "bpv-fail-2" },
    );
    expect(out.created).toBe(true);
  });
});
