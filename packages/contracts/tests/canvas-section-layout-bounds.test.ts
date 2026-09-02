import { describe, it, expect } from "vitest";
import { SectionLayout } from "../src/canvas";

/**
 * issue #2535：模板编辑器把列数改成 1/2 列、或「最多条数」改到 3–9 之外后保存报
 * 「无 reasonCode（HTTP 400）」——根因是契约 `SectionLayout.cols/max` 的区间落后于
 * 编辑器（`COLS_OPTIONS` 1–8、`MAX_COUNT_MIN..MAX_COUNT_MAX` 1–99）。
 * 这组用例把契约钉在编辑器可产出的全部取值上，防止再次漂移。
 */
const base = { col: 1, row: 1, w: 6, h: 3, cols: 3, max: 6, tone: 0, overflow: "缩小字号" as const };

describe("canvas.SectionLayout 与模板编辑器可选值对齐（#2535）", () => {
  it("列数 1–8 全部可入参（编辑器 COLS_OPTIONS）", () => {
    for (const cols of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(SectionLayout.safeParse({ ...base, cols }).success, `cols=${cols}`).toBe(true);
    }
    expect(SectionLayout.safeParse({ ...base, cols: 0 }).success).toBe(false);
    expect(SectionLayout.safeParse({ ...base, cols: 9 }).success).toBe(false);
  });

  it("最多条数 1–99 全部可入参（编辑器步进器区间）", () => {
    for (const max of [1, 2, 3, 9, 10, 50, 99]) {
      expect(SectionLayout.safeParse({ ...base, max }).success, `max=${max}`).toBe(true);
    }
    expect(SectionLayout.safeParse({ ...base, max: 0 }).success).toBe(false);
    expect(SectionLayout.safeParse({ ...base, max: 100 }).success).toBe(false);
  });

  it("贴纸颜色 0–3 与编辑器色板一致", () => {
    for (const tone of [0, 1, 2, 3]) {
      expect(SectionLayout.safeParse({ ...base, tone }).success).toBe(true);
    }
    expect(SectionLayout.safeParse({ ...base, tone: 4 }).success).toBe(false);
  });
});
