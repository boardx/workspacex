import { describe, expect, it } from "vitest";
import {
  assertOtherSidePreserved,
  resolveConflict,
  type PendingConflict,
  type ResolvedConflict,
} from "../../src/domain/canvas/conflict-resolution";

/**
 * F105 — 冲突条三出口（D-09）：[并排比较] / [保留文档] / [保留画布]，
 * **无论选哪个，另一侧都存为一个版本**（`preservedVersionId` 永不为空，I-17）。
 *
 * ## 这份测试在防什么
 *
 * D-09 的价值核心是"另一侧不丢"，而三个出口里最容易被做反的正是这一点——
 * 一个偷懒的实现会把"保留文档"写成"采纳文档、丢弃画布侧的改动"（因为
 * happy path 测试只会检查采纳侧生效，不会检查被拒绝那侧是否还能读到）。
 * 本文件对三个出口都做「另一侧确实变成一个可读版本」的反向断言，
 * 而不只是正向断言"采纳侧生效了"。
 *
 * 幂等重放（重复裁决同一 conflictId）与 compare 是中间态两点也各自独立验证：
 * 前者防止"重复点两次[保留文档]"产生两个不同的 preservedVersionId（那本身就是
 * 第二次数据分叉）；后者防止把 compare 误实现成一个终态出口。
 */
describe("F105 · resolveConflict 三出口 —— 另一侧必存版本（D-09 / I-17）", () => {
  const conflict: PendingConflict = {
    conflictId: "conflict-1",
    docSide: {
      side: "doc", versionId: "v-doc-9", authorRef: "u-doc", at: "2026-08-01T09:00:00Z",
      summary: "文档侧新增「## 竞品」分区",
    },
    canvasSide: {
      side: "canvas", versionId: "v-canvas-9", authorRef: "u-canvas", at: "2026-08-01T09:05:00Z",
      summary: "画布侧删除了「## 假设」分区",
    },
  };

  it("[保留文档]（keep-doc）：文档侧生效，画布侧存为一个版本——两者是不同的 versionId", () => {
    const result = resolveConflict({
      instanceExists: true, conflict, outcome: "keep-doc", alreadyResolvedByConflictId: undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.adoptedVersionId).toBe("v-doc-9");
    expect(result.result.preservedVersionId).toBe("v-canvas-9");
    expect(result.result.preservedVersionId).not.toBe("");
    expect(assertOtherSidePreserved(result.result)).toBe(true);
  });

  it("[保留画布]（keep-canvas）：画布侧生效，文档侧存为一个版本——两者是不同的 versionId", () => {
    const result = resolveConflict({
      instanceExists: true, conflict, outcome: "keep-canvas", alreadyResolvedByConflictId: undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.adoptedVersionId).toBe("v-canvas-9");
    expect(result.result.preservedVersionId).toBe("v-doc-9");
    expect(result.result.preservedVersionId).not.toBe("");
    expect(assertOtherSidePreserved(result.result)).toBe(true);
  });

  it("[并排比较]（compare）：是中间态不是终态——冲突不消失，两侧各自的版本仍分别可读", () => {
    const result = resolveConflict({
      instanceExists: true, conflict, outcome: "compare", alreadyResolvedByConflictId: undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.outcome).toBe("compare");
    // compare 不代表任何一侧被丢弃：两个字段仍然分别指向两侧各自的版本。
    expect(result.result.adoptedVersionId).toBe("v-doc-9");
    expect(result.result.preservedVersionId).toBe("v-canvas-9");
  });

  it("三个出口中任意一个，preservedVersionId 都非空字符串（契约层就不给丢弃留位置）", () => {
    for (const outcome of ["compare", "keep-doc", "keep-canvas"] as const) {
      const result = resolveConflict({
        instanceExists: true, conflict, outcome, alreadyResolvedByConflictId: undefined,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.result.preservedVersionId).toBe("string");
        expect(result.result.preservedVersionId.length).toBeGreaterThan(0);
      }
    }
  });

  it("keep-doc / keep-canvas 终态：adoptedVersionId 与 preservedVersionId 绝不是同一个版本", () => {
    for (const outcome of ["keep-doc", "keep-canvas"] as const) {
      const result = resolveConflict({
        instanceExists: true, conflict, outcome, alreadyResolvedByConflictId: undefined,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.adoptedVersionId).not.toBe(result.result.preservedVersionId);
      }
    }
  });

  describe("幂等重放：重复裁决同一 conflictId 不重复建版本", () => {
    it("命中 alreadyResolvedByConflictId 时，返回既有结果而不是重新判定", () => {
      const priorResult: ResolvedConflict = {
        conflictId: "conflict-1",
        outcome: "keep-doc",
        adoptedVersionId: "v-doc-9",
        preservedVersionId: "v-canvas-9",
      };
      // 故意传一个不同的 outcome（keep-canvas），验证幂等重放不会按新 outcome 重新判定，
      // 而是原样回放上一次的结果——防止「重复裁决」本身产生第二次数据分叉。
      const result = resolveConflict({
        instanceExists: true, conflict, outcome: "keep-canvas", alreadyResolvedByConflictId: priorResult,
      });
      expect(result).toEqual({ ok: true, alreadyResolved: true, result: priorResult });
    });

    it("首次裁决（alreadyResolvedByConflictId 为 undefined）标记为 alreadyResolved: false", () => {
      const result = resolveConflict({
        instanceExists: true, conflict, outcome: "keep-doc", alreadyResolvedByConflictId: undefined,
      });
      expect(result.ok && !result.alreadyResolved).toBe(true);
    });
  });

  it("instanceExists=false 时返回 INSTANCE_NOT_FOUND，不做任何裁决", () => {
    const result = resolveConflict({
      instanceExists: false, conflict, outcome: "keep-doc", alreadyResolvedByConflictId: undefined,
    });
    expect(result).toEqual({ ok: false, reason: "INSTANCE_NOT_FOUND" });
  });
});
