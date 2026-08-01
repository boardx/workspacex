import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import { publishNewVersion } from "../../src/domain/templates/publish-blueprint-version";
import {
  nextVersionNumber,
  versionNumbersSatisfyI3,
  canBindNewProject,
  canInstantiateExistingBinding,
  type BlueprintVersion,
} from "../../src/domain/templates/blueprint-version";
import { publishBlueprintVersionUseCase } from "../../src/application/templates/publish-blueprint-version";
import { designFacetKeys } from "../../src/domain/templates/design-facet-table";
import type { BlueprintBinding } from "../../src/domain/templates/designer-shell";

/**
 * F22 —— **版本生成事务性**：新版 v(n+1) 与旧版归档必须同一次调用产生（E6），
 * 版本号单调递增、不复用、不缺号（I-3），且**发布失败不占版本号**（V18）。
 */

const HAS_TRIAL_RUN: BlueprintBinding[] = [{ kind: "trial-run" }];

describe("首次发布：无当前版本", () => {
  it("versionNumber = 1，archivedVersion 恒 null", () => {
    const { newVersion, archivedVersion } = publishNewVersion({
      blueprintId: "bp-1",
      history: [],
      currentVersion: null,
      content: { a: "1" },
      changedDesignFacetKeys: ["a"],
      newVersionId: "v-1",
    });
    expect(newVersion.versionNumber).toBe(1);
    expect(newVersion.state).toBe("published");
    expect(archivedVersion).toBeNull();
  });
});

describe("再次发布：新版与旧版归档同一次调用产生（E6）", () => {
  it("旧版被标记 archived，新版号 = 历史最大号 + 1，二者来自同一个返回值", () => {
    const v1: BlueprintVersion = {
      id: "v-1",
      blueprintId: "bp-1",
      versionNumber: 1,
      content: { a: "1" },
      changedDesignFacetKeys: ["a"],
      rolledBackFrom: null,
      state: "published",
    };
    const result = publishNewVersion({
      blueprintId: "bp-1",
      history: [v1],
      currentVersion: v1,
      content: { a: "2" },
      changedDesignFacetKeys: ["a"],
      newVersionId: "v-2",
    });

    expect(result.newVersion.versionNumber).toBe(2);
    expect(result.archivedVersion).not.toBeNull();
    expect(result.archivedVersion!.id).toBe("v-1");
    expect(result.archivedVersion!.state).toBe("archived");
    // 旧版内容本身不改写（I-2）——归档只改 state，不动 content
    expect(result.archivedVersion!.content).toEqual(v1.content);
  });

  it("不存在只拿到新版而拿不到归档信息的路径 —— 两者是同一个返回对象的两个字段", () => {
    const v1: BlueprintVersion = {
      id: "v-1",
      blueprintId: "bp-1",
      versionNumber: 1,
      content: {},
      changedDesignFacetKeys: [],
      rolledBackFrom: null,
      state: "published",
    };
    const result = publishNewVersion({
      blueprintId: "bp-1",
      history: [v1],
      currentVersion: v1,
      content: {},
      changedDesignFacetKeys: [],
      newVersionId: "v-2",
    });
    // 两个字段必须同时存在于同一个结果里（结构层面的“同事务”保证）
    expect(Object.keys(result).sort()).toEqual(["archivedVersion", "newVersion"]);
  });
});

describe("版本号单调递增、不复用、不缺号（I-3）", () => {
  it("连续三次成功发布产生 1,2,3，序列满足 I-3", () => {
    let history: BlueprintVersion[] = [];
    let current: BlueprintVersion | null = null;
    for (let i = 1; i <= 3; i++) {
      const { newVersion, archivedVersion } = publishNewVersion({
        blueprintId: "bp-1",
        history,
        currentVersion: current,
        content: { i: String(i) },
        changedDesignFacetKeys: [],
        newVersionId: `v-${i}`,
      });
      expect(newVersion.versionNumber).toBe(i);
      history = archivedVersion
        ? [...history.filter((v) => v.id !== archivedVersion.id), archivedVersion, newVersion]
        : [...history, newVersion];
      current = newVersion;
    }
    expect(versionNumbersSatisfyI3(history)).toBe(true);
    expect(history.map((v) => v.versionNumber).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});

describe("发布失败不占版本号（V18）", () => {
  it("门槛被拒时用例层根本不调用 publishNewVersion —— history 不变，下一次成功发布号不跳", () => {
    const history: BlueprintVersion[] = [];

    // 第一次尝试：故意不满足门槛（未试跑）
    expect(() =>
      publishBlueprintVersionUseCase({
        blueprintId: "bp-1",
        completedKeys: designFacetKeys(),
        bindings: [],
        history,
        currentVersion: null,
        content: {},
        changedDesignFacetKeys: [],
        newVersionId: "v-would-be-1",
      }),
    ).toThrow();

    // 失败尝试之后 history 仍为空，nextVersionNumber 仍是 1 —— 号没有被那次失败消费
    expect(nextVersionNumber(history)).toBe(1);

    // 第二次尝试：满足门槛，真正成功
    const result = publishBlueprintVersionUseCase({
      blueprintId: "bp-1",
      completedKeys: designFacetKeys(),
      bindings: HAS_TRIAL_RUN,
      history,
      currentVersion: null,
      content: {},
      changedDesignFacetKeys: [],
      newVersionId: "v-1",
    });
    // 拿到的仍是 1，不是 2 —— 证明失败的那次尝试没有占号
    expect(result.versionNumber).toBe(1);
  });
});

describe("I-7：归档不影响可达性（存量绑定仍可实例化，只是不能新增绑定）", () => {
  it("归档后的旧版：不能新增绑定，但存量绑定的实例化不受影响", () => {
    const v1: BlueprintVersion = {
      id: "v-1",
      blueprintId: "bp-1",
      versionNumber: 1,
      content: {},
      changedDesignFacetKeys: [],
      rolledBackFrom: null,
      state: "published",
    };
    const { archivedVersion } = publishNewVersion({
      blueprintId: "bp-1",
      history: [v1],
      currentVersion: v1,
      content: {},
      changedDesignFacetKeys: [],
      newVersionId: "v-2",
    });
    expect(canBindNewProject(archivedVersion!)).toBe(false);
    expect(canInstantiateExistingBinding(archivedVersion!)).toBe(true);
  });
});

describe("契约面：publishBlueprintVersion.out 形状与本用例返回值一致", () => {
  it("用例返回值能被契约 out schema 解析", () => {
    const result = publishBlueprintVersionUseCase({
      blueprintId: "bp-1",
      completedKeys: designFacetKeys(),
      bindings: HAS_TRIAL_RUN,
      history: [],
      currentVersion: null,
      content: {},
      changedDesignFacetKeys: [],
      newVersionId: "v-1",
    });
    expect(templates.operations.publishBlueprintVersion.out.safeParse(result).success).toBe(true);
  });

  it("archivedVersionId 为 null 仅在首版合法（契约注释）——非首版发布必须非 null", () => {
    const v1: BlueprintVersion = {
      id: "v-1",
      blueprintId: "bp-1",
      versionNumber: 1,
      content: {},
      changedDesignFacetKeys: [],
      rolledBackFrom: null,
      state: "published",
    };
    const result = publishBlueprintVersionUseCase({
      blueprintId: "bp-1",
      completedKeys: designFacetKeys(),
      bindings: HAS_TRIAL_RUN,
      history: [v1],
      currentVersion: v1,
      content: {},
      changedDesignFacetKeys: [],
      newVersionId: "v-2",
    });
    expect(result.archivedVersionId).toBe("v-1");
  });
});
