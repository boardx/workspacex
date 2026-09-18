/**
 * `resolveExportMultiplier` 的边界单测——导出倍率"先要清晰度、再要上限"的规则
 * （`lib/canvas/export-scale.ts`）。反证：没有上限时 2×(4000×6000) = 9600 万像素，
 * 早就越过 Safari 的 16.7M 面积上限。
 */
import { describe, it, expect } from "vitest";
import { resolveExportMultiplier, EXPORT_MAX_PIXELS, EXPORT_DEFAULT_MULTIPLIER } from "@/lib/canvas/export-scale";

describe("resolveExportMultiplier", () => {
  it("小图：给默认 2 倍，不动", () => {
    expect(resolveExportMultiplier(800, 600)).toBe(EXPORT_DEFAULT_MULTIPLIER);
  });

  it("显式要 3 倍且放得下 ⇒ 给 3", () => {
    expect(resolveExportMultiplier(500, 500, 3)).toBe(3);
  });

  it("大图（mindmap 3000×4500，2 倍会到 5400 万像素）⇒ 倍率被压到刚好落在上限内，且 ≥ 1", () => {
    const m = resolveExportMultiplier(3000, 4500);
    expect(m).toBeLessThan(2);
    expect(m).toBeGreaterThanOrEqual(1);
    expect(3000 * m * 4500 * m).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
    // 而且是"刚好"：再高 0.05 就越界——不是一刀砍到 1 牺牲清晰度
    expect(3000 * (m + 0.05) * 4500 * (m + 0.05)).toBeGreaterThan(EXPORT_MAX_PIXELS);
  });

  it("中等图（2000×3000）：2 倍会超上限，压到 ~1.67", () => {
    const m = resolveExportMultiplier(2000, 3000);
    expect(2000 * m * 2000 * m * 1.5).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
    expect(m).toBeCloseTo(1.67, 2);
  });

  it("超大图（逻辑面积本身就超上限）⇒ 不低于 1，宁可文件大也不缩小内容", () => {
    expect(resolveExportMultiplier(5000, 5000)).toBe(1);
  });

  it("非法 requested（0/NaN/负）⇒ 退回默认倍率", () => {
    expect(resolveExportMultiplier(100, 100, 0)).toBe(EXPORT_DEFAULT_MULTIPLIER);
    expect(resolveExportMultiplier(100, 100, Number.NaN)).toBe(EXPORT_DEFAULT_MULTIPLIER);
    expect(resolveExportMultiplier(100, 100, -2)).toBe(EXPORT_DEFAULT_MULTIPLIER);
  });

  it("零面积 ⇒ 原样返回想要的倍率（不除零）", () => {
    expect(resolveExportMultiplier(0, 0, 2)).toBe(2);
  });
});
