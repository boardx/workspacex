import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  nextVersionNumber,
  rollbackToVersion,
  versionNumbersSatisfyI3,
  type BlueprintVersion,
} from "../../src/domain/templates/blueprint-version";
import {
  evaluateRollbackTargetGate,
  type ProjectSnapshotUsage,
} from "../../src/domain/templates/rollback-gate";

/**
 * F30 —— **回滚 = 新建等同旧版内容的新版本**（O-18 ②，`uc-2-4` R7「回滚」/ R12 V7）。
 *
 * V7 逐字：「当前 v5、回滚到 v3 后，产生 v6 且内容逐字段等于 v3，v3 与 v5 记录均保持不变，
 * 版本记录中含 `rolled_back_from = v3`；不存在『当前版本指针被改回 v3』的状态。」
 */

const v1: BlueprintVersion = {
  id: "ver-1",
  blueprintId: "bp-a",
  versionNumber: 1,
  content: { agendaSegments: ["s0"] },
  changedDesignFacetKeys: [],
  rolledBackFrom: null,
  state: "archived",
};

const v2: BlueprintVersion = {
  id: "ver-2",
  blueprintId: "bp-a",
  versionNumber: 2,
  content: { agendaSegments: ["s0", "s1"] },
  changedDesignFacetKeys: ["stub-facet-a"],
  rolledBackFrom: null,
  state: "archived",
};

const v3: BlueprintVersion = {
  id: "ver-3",
  blueprintId: "bp-a",
  versionNumber: 3,
  content: { agendaSegments: ["s1", "s2"] },
  changedDesignFacetKeys: ["stub-facet-b"],
  rolledBackFrom: null,
  state: "archived",
};

const v4: BlueprintVersion = {
  id: "ver-4",
  blueprintId: "bp-a",
  versionNumber: 4,
  content: { agendaSegments: ["s1", "s2", "s3"] },
  changedDesignFacetKeys: ["stub-facet-a"],
  rolledBackFrom: null,
  state: "archived",
};

const v5: BlueprintVersion = {
  id: "ver-5",
  blueprintId: "bp-a",
  versionNumber: 5,
  content: { agendaSegments: ["s1", "s2", "s3", "s4"] },
  changedDesignFacetKeys: ["stub-facet-c"],
  rolledBackFrom: null,
  state: "published",
};

describe("V7：回滚到 v3 产生 v6（内容 = v3），v3/v5 均不变", () => {
  it("产生的新版本号 = 历史最大号 + 1，内容逐字段等于目标版本", () => {
    const history = [v3, v4, v5];
    const rolledBack = rollbackToVersion(history, v3, "ver-6");

    expect(rolledBack.versionNumber).toBe(6);
    expect(rolledBack.content).toEqual(v3.content);
    expect(rolledBack.changedDesignFacetKeys).toEqual(v3.changedDesignFacetKeys);
    expect(rolledBack.rolledBackFrom).toBe("ver-3");
    expect(rolledBack.state).toBe("published");
    // 新记录是全新 id，不是 v3 记录本身
    expect(rolledBack.id).toBe("ver-6");
    expect(rolledBack.id).not.toBe(v3.id);
  });

  it("v3 与 v5 的记录本身未被这次调用改写（rollbackToVersion 只返回新记录，不改历史数组里的旧条目）", () => {
    const history = [v3, v4, v5];
    rollbackToVersion(history, v3, "ver-6");
    expect(history[0]).toEqual(v3);
    expect(history[2]).toEqual(v5);
  });

  it("不存在『当前版本指针被改回 v3』——回滚产生的是新记录而非对 v3 的修改", () => {
    const history = [v3, v4, v5];
    const rolledBack = rollbackToVersion(history, v3, "ver-6");
    // v3 本身的 versionNumber 依旧是 3，不是被"指回"成当前版
    expect(v3.versionNumber).toBe(3);
    expect(rolledBack.versionNumber).not.toBe(v3.versionNumber);
  });

  it("回滚后历史序列仍满足 I-3（单调递增、不复用、不缺号）", () => {
    const history = [v1, v2, v3, v4, v5];
    const rolledBack = rollbackToVersion(history, v3, "ver-6");
    const newHistory = [...history, rolledBack];
    expect(versionNumbersSatisfyI3(newHistory)).toBe(true);
    expect(nextVersionNumber(newHistory)).toBe(7);
  });
});

describe("V7：回滚约束——只允许回到未被任何进行中项目使用的版本", () => {
  it("目标版本正被某个 active 项目使用 ⇒ 拒绝，且列出该项目", () => {
    const usages: ProjectSnapshotUsage[] = [
      { projectId: "proj-A", blueprintVersionId: "ver-4", projectStatus: "active" },
      { projectId: "proj-B", blueprintVersionId: "ver-3", projectStatus: "archived" },
    ];
    const verdict = evaluateRollbackTargetGate("ver-4", usages);
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({
      reason: "ROLLBACK_TARGET_IN_USE",
      inUseByProjectIds: ["proj-A"],
    });
  });

  it("目标版本仅被 archived 项目引用（非进行中）⇒ 允许回滚", () => {
    const usages: ProjectSnapshotUsage[] = [
      { projectId: "proj-B", blueprintVersionId: "ver-3", projectStatus: "archived" },
    ];
    expect(evaluateRollbackTargetGate("ver-3", usages).allowed).toBe(true);
  });

  it("多个进行中项目同时使用目标版本 ⇒ 全部列出，不是只报第一个", () => {
    const usages: ProjectSnapshotUsage[] = [
      { projectId: "proj-A", blueprintVersionId: "ver-4", projectStatus: "active" },
      { projectId: "proj-C", blueprintVersionId: "ver-4", projectStatus: "active" },
    ];
    const verdict = evaluateRollbackTargetGate("ver-4", usages);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.inUseByProjectIds).toEqual(["proj-A", "proj-C"]);
    }
  });

  it("无任何项目引用该版本 ⇒ 允许", () => {
    expect(evaluateRollbackTargetGate("ver-9", []).allowed).toBe(true);
  });
});

describe("契约对齐：rollbackToVersion 操作的失败面与出参", () => {
  it("ROLLBACK_TARGET_IN_USE 是 rollbackToVersion 的失败面成员", () => {
    expect(templates.operations.rollbackToVersion.err).toContain("ROLLBACK_TARGET_IN_USE");
  });

  it("出参含 rolledBackFrom，且不含任何『当前版本指针』字段", () => {
    const keys = Object.keys(templates.operations.rollbackToVersion.out.shape);
    expect(keys).toEqual(
      expect.arrayContaining(["newVersionId", "newVersionNumber", "rolledBackFrom"]),
    );
    expect(keys).not.toContain("currentVersionPointer");
  });
});
