import { describe, expect, it } from "vitest";
import {
  canBindNewProject,
  canInstantiateExistingBinding,
  type BlueprintVersion,
} from "../../src/domain/templates/blueprint-version";
import { publishNewVersion } from "../../src/domain/templates/publish-blueprint-version";
import {
  applyBlueprintUseCase,
  ApplyBlueprintError,
} from "../../src/application/templates/apply-blueprint";
import type {
  ApplyBlueprintCommand,
  ApplyBlueprintRepository,
} from "../../src/application/templates/apply-blueprint-ports";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F23 —— **蓝本版本快照绑定**（`uc-2-2` R3 / I-1 I-2 I-4 I-7）。
 *
 * 三条性质：
 *   ① 写入的是 `blueprintVersionId` 的**引用**，不是版本内容的深拷贝（I-1/I-4）。
 *   ② 绑定之后，蓝本一侧再发布多少个新版本都不改写它（快照不漂移，I-2）。
 *   ③ 只允许**新增绑定**挂在已发布版本上；已归档版本不接受新绑定，
 *      但存量绑定的实例化不受影响（I-7，两半刻意是两个函数，见 `blueprint-version.ts`）。
 */

const V1: BlueprintVersion = {
  id: "v-1",
  blueprintId: "bp-1",
  versionNumber: 1,
  content: { "flow-agenda": { anything: "big blob, never read by this feature" } },
  changedDesignFacetKeys: ["flow-agenda"],
  rolledBackFrom: null,
  state: "published",
};

describe("① 引用不是深拷贝：命令里只带 blueprintVersionId，不带 content", () => {
  it("ApplyBlueprintRepository 收到的命令没有 content 字段（类型层面就不允许）", async () => {
    let seen: ApplyBlueprintCommand | null = null;
    const repo: ApplyBlueprintRepository = {
      async apply(cmd) {
        seen = cmd;
        return { projectId: "p-1", blueprintVersionId: cmd.blueprintVersionId, initialized: [], created: true };
      },
    };

    const out = await applyBlueprintUseCase(
      { repo },
      {
        orgId: toOrgId("org-1"),
        actorId: "u-1",
        actorOrgRole: "lead",
        blueprintId: "bp-1",
        blueprintExists: true,
        visibleToActor: true,
        resolvedVersion: V1,
        filledFacetKeys: ["flow-agenda"],
        tier: "half-day",
        projectName: "新项目",
        idempotencyKey: "idem-1",
      },
    );

    expect(out.blueprintVersionId).toBe("v-1");
    expect(seen).not.toBeNull();
    const seenCmd = seen!;
    expect("content" in seenCmd).toBe(false);
    expect(Object.keys(seenCmd).sort()).not.toContain("content");
  });
});

describe("② 快照不漂移：绑定之后蓝本再发布新版本，已绑定的引用不变", () => {
  it("v1 被绑定后，蓝本发布 v2（v1 归档），已发生的绑定值（'v-1'）本身不因此改写", async () => {
    let boundVersionId: string | null = null;
    const repo: ApplyBlueprintRepository = {
      async apply(cmd) {
        boundVersionId = cmd.blueprintVersionId;
        return { projectId: "p-1", blueprintVersionId: cmd.blueprintVersionId, initialized: [], created: true };
      },
    };

    await applyBlueprintUseCase(
      { repo },
      {
        orgId: toOrgId("org-1"),
        actorId: "u-1",
        actorOrgRole: "lead",
        blueprintId: "bp-1",
        blueprintExists: true,
        visibleToActor: true,
        resolvedVersion: V1,
        filledFacetKeys: [],
        tier: "half-day",
        projectName: "新项目",
        idempotencyKey: "idem-2",
      },
    );
    expect(boundVersionId).toBe("v-1");

    // 蓝本这一侧独立地发布 v2 —— 用同一个 publishNewVersion（F22）产生新版 + v1 归档。
    const { newVersion, archivedVersion } = publishNewVersion({
      blueprintId: "bp-1",
      history: [V1],
      currentVersion: V1,
      content: { "flow-agenda": { changed: true } },
      changedDesignFacetKeys: ["flow-agenda"],
      newVersionId: "v-2",
    });
    expect(newVersion.versionNumber).toBe(2);
    expect(archivedVersion!.id).toBe("v-1");
    expect(archivedVersion!.state).toBe("archived");

    // 已绑定的值本身是一个不可变字符串——它不是从 v1 现在的状态重新派生出来的,
    // 所以 v1 归档这件事发生之后，`boundVersionId` 读到的仍然是当初写入的那个引用。
    expect(boundVersionId).toBe("v-1");
  });
});

describe("③ 新增绑定只能挂已发布版本；已归档版本拒绝新绑定，但不影响存量绑定的实例化（I-7）", () => {
  const archivedV1: BlueprintVersion = { ...V1, state: "archived" };

  it("canBindNewProject(archived) === false —— 选中一个已归档版本去 applyBlueprint 应被拒", async () => {
    expect(canBindNewProject(archivedV1)).toBe(false);

    const repo: ApplyBlueprintRepository = {
      async apply() {
        throw new Error("不应该被调用——门槛应在事务前拦下");
      },
    };

    await expect(
      applyBlueprintUseCase(
        { repo },
        {
          orgId: toOrgId("org-1"),
          actorId: "u-1",
          actorOrgRole: "lead",
          blueprintId: "bp-1",
          blueprintExists: true,
          visibleToActor: true,
          resolvedVersion: archivedV1,
          filledFacetKeys: [],
          tier: "half-day",
          projectName: "新项目",
          idempotencyKey: "idem-3",
        },
      ),
    ).rejects.toThrow(ApplyBlueprintError);
    try {
      await applyBlueprintUseCase(
        { repo },
        {
          orgId: toOrgId("org-1"),
          actorId: "u-1",
          actorOrgRole: "lead",
          blueprintId: "bp-1",
          blueprintExists: true,
          visibleToActor: true,
          resolvedVersion: archivedV1,
          filledFacetKeys: [],
          tier: "half-day",
          projectName: "新项目",
          idempotencyKey: "idem-3b",
        },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyBlueprintError);
      expect((err as InstanceType<typeof ApplyBlueprintError>).reasonCode).toBe("BLUEPRINT_VERSION_ARCHIVED");
    }
  });

  it("canInstantiateExistingBinding(archived) === true —— 存量绑定的实例化不受归档影响", () => {
    // 这是 F17 已证明的性质，本测试只确认 F23 依赖的这条不变量没有被本 feature 悄悄破坏。
    expect(canInstantiateExistingBinding(archivedV1)).toBe(true);
  });

  it("从未发布过任何版本（resolvedVersion 为 null）⇒ BLUEPRINT_NOT_PUBLISHED，不是 ARCHIVED", async () => {
    const repo: ApplyBlueprintRepository = {
      async apply() {
        throw new Error("不应该被调用");
      },
    };

    await expect(
      applyBlueprintUseCase(
        { repo },
        {
          orgId: toOrgId("org-1"),
          actorId: "u-1",
          actorOrgRole: "lead",
          blueprintId: "bp-1",
          blueprintExists: true,
          visibleToActor: true,
          resolvedVersion: null,
          filledFacetKeys: [],
          tier: "half-day",
          projectName: "新项目",
          idempotencyKey: "idem-4",
        },
      ),
    ).rejects.toThrow(ApplyBlueprintError);
    try {
      await applyBlueprintUseCase(
        { repo },
        {
          orgId: toOrgId("org-1"),
          actorId: "u-1",
          actorOrgRole: "lead",
          blueprintId: "bp-1",
          blueprintExists: true,
          visibleToActor: true,
          resolvedVersion: null,
          filledFacetKeys: [],
          tier: "half-day",
          projectName: "新项目",
          idempotencyKey: "idem-4b",
        },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyBlueprintError);
      expect((err as InstanceType<typeof ApplyBlueprintError>).reasonCode).toBe("BLUEPRINT_NOT_PUBLISHED");
    }
  });
});
