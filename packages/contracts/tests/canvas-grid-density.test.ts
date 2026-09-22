import { describe, it, expect } from "vitest";
import { GridCols, GridRows, DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, operations } from "../src/canvas";

/**
 * issue #3358 第 8 项「网格密度」——人类实测原话：「现在的这个格子感觉不够用……
 * 现在是 8*12」。
 *
 * ⚠ `GridRows` 2026-09-10 第一版刻意只收 `z.literal(8)`：那时候行数还是
 *   `explicit-template-layout.ts` 的模块常量，放行 16 只会往库里存一个整条渲染链
 *   不认的数。该文件的注释把放宽的前提写死了（「等前端把 `GRID_ROWS` 改成参数、
 *   右栏出『网格密度』选择器之后」），前端那一半做完了，这里跟着放行 16。
 *
 *   这组用例钉两头：16 真的能过契约（否则编辑器选了 16 一保存就是 HTTP 400），
 *   以及 8/16 之外仍然拒绝（库的 CHECK 只认这两个，静默存别的值会在落库时才炸）。
 */
describe("canvas 网格密度契约（#3358 第 8 项）", () => {
  it("行数放行 8 与 16，与迁移的 CHECK (grid_rows IN (8,16)) 一致", () => {
    expect(GridRows.safeParse(8).success).toBe(true);
    expect(GridRows.safeParse(16).success).toBe(true);
  });

  it("8/16 之外一律拒绝——库存不下的值不该先被契约放进来", () => {
    for (const v of [0, 1, 6, 7, 9, 12, 24, 32, "16"]) {
      expect(GridRows.safeParse(v).success, `gridRows=${String(v)}`).toBe(false);
    }
  });

  it("列数那一半不受影响（6/12/24），两个缺省值仍然是老数据的 12×8", () => {
    for (const v of [6, 12, 24]) expect(GridCols.safeParse(v).success, `gridCols=${v}`).toBe(true);
    expect(GridCols.safeParse(8).success).toBe(false);
    expect(DEFAULT_GRID_COLS).toBe(12);
    expect(DEFAULT_GRID_ROWS).toBe(8);
  });

  it("三条写路径都收得下 gridRows: 16——编辑器保存走的就是它们", () => {
    const sections = [{ sectionId: "s1", name: "说", order: 0, required: false, capacity: null }];
    expect(operations.createTemplate.in.safeParse({
      key: "swot", displayName: "SWOT", underlyingType: "canvas", sections,
      visibility: "org-wide", tags: [], gridCols: 12, gridRows: 16,
    }).success).toBe(true);
    expect(operations.updateTemplateDraft.in.safeParse({
      key: "swot", version: 1, displayName: "SWOT", sections,
      visibility: "org-wide", tags: [], gridCols: 12, gridRows: 16,
    }).success).toBe(true);
    expect(operations.mintTemplateVersion.in.safeParse({
      key: "swot", displayName: "SWOT", underlyingType: "canvas", sections,
      visibility: "org-wide", tags: [], gridCols: 12, gridRows: 16,
    }).success).toBe(true);
  });
});
