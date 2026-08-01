import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import { publishNewVersion, type BlueprintVersion } from "../../src/domain/templates/blueprint-version";
import {
  resolveBoundVersion,
  snapshotUnaffectedByPublish,
  type ProjectBlueprintSnapshot,
} from "../../src/domain/templates/snapshot-binding";

/**
 * F30 —— **快照不漂移**（AC1 / AC2，`uc-2-4` R7「快照绑定（本用例的核心）」/ R12 V2）。
 *
 * V2 逐字：「用 v4 建项目 A → 蓝本发布 v5 → 断言 A 的绑定版本仍为 v4，
 * 且 A 的议程环节、分组、输出物等逐项与 v4 快照一致；再发布 v6，A 仍不变。」
 *
 * ⚠ 本文件不测「发布」这个 HTTP 操作本身（那是应用层 + 存储层的事），
 *   只测**领域层的不变量**：`publishNewVersion` 追加历史后，
 *   一个更早绑定的快照按 id 解析出的内容逐字段不变。
 */

const v4: BlueprintVersion = {
  id: "ver-4",
  blueprintId: "bp-hmw",
  versionNumber: 4,
  content: { agendaSegments: ["s1", "s2"], groups: ["g1"], outputs: ["report"] },
  changedDesignFacetKeys: ["stub-facet-a"],
  rolledBackFrom: null,
  state: "published",
};

describe("V2：用 v4 建项目 A → 发布 v5 → A 仍锁在 v4", () => {
  it("A 的绑定版本号仍为 4，内容逐字段与 v4 一致", () => {
    const historyBefore: BlueprintVersion[] = [v4];
    const snapshotA: ProjectBlueprintSnapshot = { projectId: "proj-A", blueprintVersionId: "ver-4" };

    const publishV5 = publishNewVersion(historyBefore, {
      newVersionId: "ver-5",
      blueprintId: "bp-hmw",
      content: { agendaSegments: ["s1", "s2", "s3"], groups: ["g1", "g2"], outputs: ["report", "deck"] },
      changedDesignFacetKeys: ["stub-facet-a", "stub-facet-b"],
    });

    const bound = resolveBoundVersion(snapshotA, publishV5.history);
    expect(bound?.versionNumber).toBe(4);
    expect(bound?.content).toEqual(v4.content);
    expect(bound?.changedDesignFacetKeys).toEqual(v4.changedDesignFacetKeys);

    expect(snapshotUnaffectedByPublish(snapshotA, historyBefore, publishV5.history)).toBe(true);
  });

  it("再发布 v6，A 依旧不变（不止一次发布才成立）", () => {
    const historyBefore: BlueprintVersion[] = [v4];
    const snapshotA: ProjectBlueprintSnapshot = { projectId: "proj-A", blueprintVersionId: "ver-4" };

    const afterV5 = publishNewVersion(historyBefore, {
      newVersionId: "ver-5",
      blueprintId: "bp-hmw",
      content: { agendaSegments: ["s1", "s2", "s3"] },
      changedDesignFacetKeys: ["stub-facet-a"],
    });
    const afterV6 = publishNewVersion(afterV5.history, {
      newVersionId: "ver-6",
      blueprintId: "bp-hmw",
      content: { agendaSegments: ["s1", "s2", "s3", "s4"] },
      changedDesignFacetKeys: ["stub-facet-a", "stub-facet-b"],
    });

    expect(snapshotUnaffectedByPublish(snapshotA, historyBefore, afterV6.history)).toBe(true);
    const boundAfterV6 = resolveBoundVersion(snapshotA, afterV6.history);
    expect(boundAfterV6?.versionNumber).toBe(4);
    expect(boundAfterV6?.content).toEqual(v4.content);
  });

  it("旧版记录本身不被改写内容——只有 state 从 published 变 archived", () => {
    const historyBefore: BlueprintVersion[] = [v4];
    const published = publishNewVersion(historyBefore, {
      newVersionId: "ver-5",
      blueprintId: "bp-hmw",
      content: { agendaSegments: ["new"] },
      changedDesignFacetKeys: ["stub-facet-a"],
    });
    const oldRecord = published.history.find((v) => v.id === "ver-4");
    expect(oldRecord?.state).toBe("archived");
    expect(oldRecord?.content).toEqual(v4.content);
    expect(oldRecord?.versionNumber).toBe(4);
    expect(published.archivedVersionId).toBe("ver-4");
  });

  it("首次发布（空历史）archivedVersionId 为 null", () => {
    const published = publishNewVersion([], {
      newVersionId: "ver-1",
      blueprintId: "bp-hmw",
      content: {},
      changedDesignFacetKeys: [],
    });
    expect(published.archivedVersionId).toBeNull();
    expect(published.newVersion.versionNumber).toBe(1);
  });

  it("快照指向一个已被归档的版本时，解析结果依旧存在（快照不因蓝本归档而悬空）", () => {
    const historyBefore: BlueprintVersion[] = [v4];
    const snapshotA: ProjectBlueprintSnapshot = { projectId: "proj-A", blueprintVersionId: "ver-4" };
    const published = publishNewVersion(historyBefore, {
      newVersionId: "ver-5",
      blueprintId: "bp-hmw",
      content: { agendaSegments: ["s1"] },
      changedDesignFacetKeys: [],
    });
    const bound = resolveBoundVersion(snapshotA, published.history);
    expect(bound).toBeDefined();
    expect(bound?.state).toBe("archived");
  });
});

describe("契约对齐：I-3 版本号单调递增在连续发布下成立", () => {
  it("三次连续发布产生 1、2、3，不缺号不复用", () => {
    let history: BlueprintVersion[] = [];
    for (let i = 0; i < 3; i++) {
      const result = publishNewVersion(history, {
        newVersionId: `ver-${i + 1}`,
        blueprintId: "bp-x",
        content: {},
        changedDesignFacetKeys: [],
      });
      history = [...result.history];
    }
    expect(history.filter((v) => v.state === "published").map((v) => v.versionNumber)).toEqual([3]);
    expect(history.map((v) => v.versionNumber).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("publishBlueprintVersion 契约的 out 字段与本文件的领域语义一致", () => {
    expect(templates.operations.publishBlueprintVersion.out.shape.archivedVersionId).toBeDefined();
  });
});
