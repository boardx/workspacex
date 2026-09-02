import { describe, it, expect } from "vitest";
import { canvas } from "@repo/contracts";
import { COLS_OPTIONS, MAX_COUNT_MAX, MAX_COUNT_MIN, TONE_COLORS } from "@/components/canvas/template-editor-model";

/**
 * issue #2535 的跨包门控：编辑器里能选出来的每一个值，契约都必须收。
 *
 * `COLS_OPTIONS`/`MAX_COUNT_*` 现在直接从 `canvas.SECTION_LAYOUT_BOUNDS` 派生，
 * 这里再用 schema 反向验证一遍（派生逻辑本身也可能写错，比如 off-by-one）；
 * `TONE_COLORS` 色板仍在前端声明，长度必须等于契约 `tone` 区间的宽度——多一格
 * 就是又一个能在界面上选到、保存却 400 的值。
 */
const base = { col: 1, row: 1, w: 6, h: 3, cols: 3, max: 6, tone: 0, overflow: "缩小字号" as const };
const B = canvas.SECTION_LAYOUT_BOUNDS;

describe("模板编辑器可选值 ⊆ 契约 SectionLayout（#2535）", () => {
  it("列数候选逐个过契约，且覆盖契约区间两端", () => {
    for (const cols of COLS_OPTIONS) {
      expect(canvas.SectionLayout.safeParse({ ...base, cols }).success, `cols=${cols}`).toBe(true);
    }
    expect(Math.min(...COLS_OPTIONS)).toBe(B.cols.min);
    expect(Math.max(...COLS_OPTIONS)).toBe(B.cols.max);
    expect(COLS_OPTIONS).toContain(1);
    expect(COLS_OPTIONS).toContain(2);
  });

  it("最多条数步进器两端过契约，且与契约区间相等", () => {
    expect(MAX_COUNT_MIN).toBe(B.max.min);
    expect(MAX_COUNT_MAX).toBe(B.max.max);
    for (const max of [MAX_COUNT_MIN, MAX_COUNT_MAX]) {
      expect(canvas.SectionLayout.safeParse({ ...base, max }).success, `max=${max}`).toBe(true);
    }
  });

  it("贴纸色板长度 = 契约 tone 区间宽度，每个下标都过契约", () => {
    expect(TONE_COLORS.length).toBe(B.tone.max - B.tone.min + 1);
    TONE_COLORS.forEach((_, tone) => {
      expect(canvas.SectionLayout.safeParse({ ...base, tone }).success, `tone=${tone}`).toBe(true);
    });
  });
});
