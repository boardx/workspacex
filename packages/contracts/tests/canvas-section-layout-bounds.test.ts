import { describe, it, expect } from "vitest";
import { SECTION_LAYOUT_BOUNDS, SectionLayout } from "../src/canvas";

/**
 * issue #2535：模板编辑器把列数改成 1/2 列、或「最多条数」改到 3–9 之外后保存报
 * 「无 reasonCode（HTTP 400）」——根因是契约 `SectionLayout.cols/max` 的区间落后于
 * 编辑器。现在 Zod schema 与编辑器常量都从 `SECTION_LAYOUT_BOUNDS` 派生；这组用例
 * 只证明「schema 与那份唯一事实源一致」，数字不在这里第三次手写。
 * （编辑器侧的对齐门控在 `apps/web/tests/lib/template-layout-bounds-contract.test.ts`。）
 */
const base = { col: 1, row: 1, w: 6, h: 3, cols: 3, max: 6, tone: 0, overflow: "缩小字号" as const };

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

describe("canvas.SectionLayout 与 SECTION_LAYOUT_BOUNDS 同源（#2535）", () => {
  it.each(["cols", "max", "tone"] as const)("%s：区间内全部整数可入参，两端之外拒绝", (field) => {
    const { min, max } = SECTION_LAYOUT_BOUNDS[field];
    for (const v of range(min, max)) {
      expect(SectionLayout.safeParse({ ...base, [field]: v }).success, `${field}=${v}`).toBe(true);
    }
    expect(SectionLayout.safeParse({ ...base, [field]: min - 1 }).success, `${field}=${min - 1}`).toBe(false);
    expect(SectionLayout.safeParse({ ...base, [field]: max + 1 }).success, `${field}=${max + 1}`).toBe(false);
  });

  it("#2535 的实际复现值：1/2 列、1 条、99 条都能过契约", () => {
    for (const patch of [{ cols: 1 }, { cols: 2 }, { max: 1 }, { max: 99 }, { cols: 1, max: 1, tone: 3 }]) {
      expect(SectionLayout.safeParse({ ...base, ...patch }).success, JSON.stringify(patch)).toBe(true);
    }
  });
});
