/**
 * F189（BP-07）—— 「套用后会初始化什么」六类一览接真：
 * `GET /blueprints/:blueprintId/initialization-preview`。
 *
 * ## 这个文件在钉什么
 *
 * 契约操作 `getInitializationPreview` 与应用层纯函数 `get-initialization-preview.ts`
 * （`planInitializationPreview`）在本束原始签核范围内早已存在，但此前**没有任何控制器
 * 把它接上电**（#991 勘探）。本文件钉的是控制器接线本身：真实读一个蓝本已填的设计
 * 环节 → 真实生成六类一览，而不是任何写死或猜测的清单。
 *
 * 不起 HTTP、不 mock 身份服务——直接实例化控制器类，用真实身份仓储（同一个 db），
 * 断言返回值能被契约 schema `.parse()` 通过（同 F175 那条「不只是仓储对得上」的先例，
 * 该先例已经钉过一次「仓储测试全绿、控制器拼形状那一步单独出错」的真实缺陷）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgBlueprintRepository } from "../../src/infrastructure/templates/pg-blueprint-repository";
import { BlueprintController } from "../../src/interface/controllers/blueprint.controller";
import { templates as C } from "@repo/contracts";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { DESIGN_FACET_DEFINITIONS, designFacetKeys } from "../../src/domain/templates/design-facet-table";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "f189-preview-org";
const OTHER_ORG = "f189-preview-other-org";
const ADMIN = "u-f189-admin";
const MEMBER = "u-f189-member";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgBlueprintRepository;
let controller: BlueprintController;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgBlueprintRepository(db);
  const identity = new (
    await import("../../src/infrastructure/identity/pg-identity-repository")
  ).PgIdentityRepository(db);
  const ids = { next: (prefix: string) => `${prefix}-test-${Math.random().toString(36).slice(2)}` };
  controller = new BlueprintController(repo, identity, ids as never, {} as never, {} as never, {} as never);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "prj-f189-fixture" });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
}, HOOK_TIMEOUT_MS);

describe("F189 initialization-preview 接真", () => {
  it("空草稿：恒 6 类返回，全部 items 为空（I-17 空类也要出现）", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-empty", orgId, actorId: ADMIN, name: "空草稿",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });

    const out = await controller.getInitializationPreview("bp-empty", {
      userId: MEMBER,
      orgId: ORG,
    } as never);

    expect(() => C.operations.getInitializationPreview.out.parse(out)).not.toThrow();
    expect(out.categories).toHaveLength(C.InitializationCategory.options.length);
    expect(out.categories).toEqual(C.InitializationCategory.options);
    expect(out.items).toEqual([]);
  });

  it("填一项后：一览里真实出现该项对应的类目条目（不是猜的清单）", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-filled", orgId, actorId: ADMIN, name: "填了一项",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    await repo.updateDesignFacet({
      orgId, blueprintId: "bp-filled", designFacetKey: "flow-agenda",
      value: "上午讨论、下午复盘", expectedItemRevision: "",
    });

    const out = await controller.getInitializationPreview("bp-filled", {
      userId: MEMBER,
      orgId: ORG,
    } as never);

    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ key: "flow-agenda", category: "议程环节" });
  });

  it("随配置实时变化（V9）：再填一项后一览同步变化，不需要重新发布或试跑", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-grow", orgId, actorId: ADMIN, name: "逐步填写",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });
    const before = await controller.getInitializationPreview("bp-grow", {
      userId: MEMBER,
      orgId: ORG,
    } as never);
    expect(before.items).toHaveLength(0);

    await repo.updateDesignFacet({
      orgId, blueprintId: "bp-grow", designFacetKey: "grouping-rule",
      value: "按背景分组", expectedItemRevision: "",
    });
    const after = await controller.getInitializationPreview("bp-grow", {
      userId: MEMBER,
      orgId: ORG,
    } as never);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ key: "grouping-rule", category: "分组" });
  });

  it("AC2「一览与实际写入逐项对得上」：与 planInitializationPreview 直接对照，不是控制器另算一套", async () => {
    const orgId = toOrgId(ORG);
    const keys = designFacetKeys(DESIGN_FACET_DEFINITIONS).slice(0, 3);
    await repo.create({
      blueprintId: "bp-cross-check", orgId, actorId: ADMIN, name: "交叉核对",
      origin: "blank", sourceId: null, machineGenerated: false,
      designFacets: new Map(keys.map((k) => [k, `内容-${k}`])),
    });

    const out = await controller.getInitializationPreview("bp-cross-check", {
      userId: MEMBER,
      orgId: ORG,
    } as never);

    const { planInitializationPreview, toContractInitializationPreview } = await import(
      "../../src/domain/templates/initialization-preview"
    );
    const expected = toContractInitializationPreview(planInitializationPreview(keys));
    expect(out).toEqual(expected);
  });

  it("蓝本不存在：BLUEPRINT_NOT_FOUND，不返回任何猜测数据", async () => {
    await expect(
      controller.getInitializationPreview("bp-does-not-exist", {
        userId: MEMBER,
        orgId: ORG,
      } as never),
    ).rejects.toMatchObject({ response: { reasonCode: "BLUEPRINT_NOT_FOUND" } });
  });

  it("非本组织成员：BLUEPRINT_NOT_VISIBLE，不泄漏蓝本是否存在", async () => {
    const orgId = toOrgId(ORG);
    await repo.create({
      blueprintId: "bp-not-visible", orgId, actorId: ADMIN, name: "别人的蓝本",
      origin: "blank", sourceId: null, machineGenerated: false, designFacets: new Map(),
    });

    await resetOrgs(OTHER_ORG);
    await seedOrg({ orgId: OTHER_ORG, projectId: "prj-f189-other" });
    const stranger = "u-f189-stranger";
    await addOrgMember(OTHER_ORG, stranger, "consultant", null);

    // stranger 拿着自己组织的 principal，去读 ORG 组织下的蓝本 id——
    // 控制器按 principal.orgId 做租户查找，stranger 在 OTHER_ORG 里没有 ORG 的成员资格。
    await expect(
      controller.getInitializationPreview("bp-not-visible", {
        userId: stranger,
        orgId: ORG,
      } as never),
    ).rejects.toMatchObject({ response: { reasonCode: "BLUEPRINT_NOT_VISIBLE" } });
  });
});
