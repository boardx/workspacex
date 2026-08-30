/**
 * 显式布局（拖拽版模板）几何的纯函数单测——R1（#2058 后续）。
 *
 * 两条独立几何各自成立：px（喂给 fabric 渲染）与 mm（`Design.pdf` §5 公式）。
 * 反证重点：不重叠、落在画幅内、mm 公式与 PDF 表格逐字对上、贴纸尺寸判定档位
 * 边界正确（这条卡过真实事故——判定档位的开闭区间写反会让「刚好 70mm」两头不靠）。
 */
import { describe, expect, it } from "vitest";
import {
  computeExplicitLayout,
  buildExplicitTemplateSpec,
  sectionGeometryMm,
  classifyNoteSize,
  MAX_NOTE_MM,
  A1_CONTENT_MM,
  A1_PAPER_MM,
  PAPER_SIZE_MM,
  contentMmFor,
  type ExplicitLayoutSectionInput,
} from "@/lib/canvas/explicit-template-layout";
import { A0_FRAME, GRID_TOP } from "@/lib/canvas/auto-template-layout";

function section(
  key: string, col: number, row: number, w: number, h: number,
  over: Partial<ExplicitLayoutSectionInput["layout"]> = {},
): ExplicitLayoutSectionInput {
  return {
    sectionId: key,
    name: `分区-${key}`,
    layout: { col, row, w, h, cols: 5, max: 6, tone: 0, overflow: "缩小字号", ...over },
  };
}

describe("computeExplicitLayout —— px 几何", () => {
  it("单个占满整个 12 列网格的区块，中心落在画幅正中，宽度等于整个可用区域", () => {
    const l = computeExplicitLayout([section("a", 1, 1, 12, 8)], 12);
    const cell = l.cells[0]!;
    const areaW = A0_FRAME.right - A0_FRAME.left;
    const areaH = A0_FRAME.bottom - GRID_TOP;
    expect(cell.w).toBeCloseTo(areaW, 5);
    expect(cell.h).toBeCloseTo(areaH, 5);
    expect(cell.x).toBeCloseTo(A0_FRAME.left + areaW / 2, 5);
    expect(cell.y).toBeCloseTo(GRID_TOP + areaH / 2, 5);
  });

  it("左右并排两个 6 列宽的区块，互不重叠，且共同宽度 + 一道 gutter = 整个可用宽度", () => {
    const l = computeExplicitLayout(
      [section("left", 1, 1, 6, 8), section("right", 7, 1, 6, 8)],
      12,
    );
    const [left, right] = l.cells;
    expect(left!.x).toBeLessThan(right!.x);
    // 左区块右沿 < 右区块左沿——真的没有重叠，不是"看起来在左边"。
    expect(left!.x + left!.w / 2).toBeLessThanOrEqual(right!.x - right!.w / 2 + 1e-6);
    const areaW = A0_FRAME.right - A0_FRAME.left;
    // 两个区块宽度相同（对称网格），加一道 gutter 应等于整个可用宽度。
    expect(left!.w + right!.w + (right!.x - right!.w / 2 - (left!.x + left!.w / 2))).toBeCloseTo(areaW, 5);
  });

  it("6 列网格与 12 列网格：同样跨 3 列，6 列网格算出的区块更宽（列更少，单列更宽）", () => {
    const l12 = computeExplicitLayout([section("a", 1, 1, 3, 2)], 12);
    const l6 = computeExplicitLayout([section("a", 1, 1, 3, 2)], 6);
    expect(l6.cells[0]!.w).toBeGreaterThan(l12.cells[0]!.w);
  });

  it("不预留右侧便签暂存区——bounds 右沿就是 A0_FRAME 右沿，不像 auto-layout 那样内缩", () => {
    const l = computeExplicitLayout([section("a", 1, 1, 4, 3)], 12);
    expect(l.bounds.right).toBe(A0_FRAME.right);
    expect(l.bounds.left).toBe(A0_FRAME.left);
  });

  it("buildExplicitTemplateSpec 产出的 TemplateSection 与 layout.cells 逐一对应，且不带自动布局那套装饰", () => {
    const { spec, layout } = buildExplicitTemplateSpec({
      key: "t1", displayName: "测试模板",
      sections: [section("a", 1, 1, 6, 4), section("b", 7, 1, 6, 4)],
      gridCols: 12,
    });
    expect(spec.sections).toHaveLength(2);
    expect(spec.sections.map((s) => s.name)).toEqual(layout.cells.map((c) => c.name));
    // 没有必填强调框/便签暂存区——那是 auto-template-layout 专属的视觉补偿。
    expect(spec.decorations).toEqual([]);
  });
});

describe("sectionGeometryMm —— Design.pdf §5 公式", () => {
  it("12 列网格，跨满 12 列 8 行：wMm/hMm 应逼近纸面内容区（一整块地方几乎占满内容区，只差一道 gap）", () => {
    const g = sectionGeometryMm({ w: 12, h: 8, cols: 5, gridCols: 12 });
    // wMm = (12/12)*821 - 6 = 815；hMm = (8/8)*574 - 6 = 568——逐字套公式验证。
    expect(g.wMm).toBe(A1_CONTENT_MM.w - 6);
    expect(g.hMm).toBe(A1_CONTENT_MM.h - 6);
  });

  it("贴纸实尺 = (wMm - 6×(cols-1)) / cols，固定 1:1 方形——不需要额外断言宽高比，公式本身只产出一个数", () => {
    // 5 列 × 2 行 = 10 条的经典配置（PDF 示例原话「5 列 × 2 行 = 放得下 10 条」）。
    const g = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    const expectedWMm = (6 / 12) * A1_CONTENT_MM.w - 6;
    const expectedNoteMm = Math.round((expectedWMm - 6 * 4) / 5);
    expect(g.noteMm).toBe(expectedNoteMm);
  });

  it("容量 = cols × rows，rows 由 floor((hMm-22)/(noteMm+6)) 算出——不是拍脑袋乘一个数", () => {
    const g = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    const expectedHMm = (3 / 8) * A1_CONTENT_MM.h - 6;
    const expectedRows = Math.floor((expectedHMm - 22) / (g.noteMm + 6));
    expect(g.rows).toBe(expectedRows);
    expect(g.fits).toBe(5 * expectedRows);
  });

  it("区块窄到贴纸实尺 < 0（w/h 太小）时不产出负数容量——rows 夹到 0，不是负数或 NaN", () => {
    const g = sectionGeometryMm({ w: 1, h: 1, cols: 8, gridCols: 12 });
    expect(g.rows).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(g.rows)).toBe(true);
    expect(g.fits).toBeGreaterThanOrEqual(0);
  });

  it("issue #2368 · 贴纸实尺封顶在 MAX_NOTE_MM——1 列时不再吃满整个区块宽度，不再把自己撑到 0 行", () => {
    // 真实复现：w=4,h=4（A1，12 列网格）选 1 列——未封顶前 wMm≈268，noteMm=268/1=268，
    // rows=floor((281-22)/(268+6))=0，整块区域画不出任何内容。
    const g = sectionGeometryMm({ w: 4, h: 4, cols: 1, gridCols: 12 });
    expect(g.wMm).toBe(268);
    expect(g.noteMm).toBe(MAX_NOTE_MM);
    expect(g.noteMm).toBeLessThan(g.wMm);
    expect(g.rows).toBeGreaterThan(0);
    expect(g.fits).toBeGreaterThan(0);
  });

  it("noteMm 未触顶时维持原公式——封顶只在超过 MAX_NOTE_MM 时才生效，不改变正常档位的数值", () => {
    const g = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    expect(g.noteMm).toBeLessThan(MAX_NOTE_MM);
    const expectedWMm = (6 / 12) * A1_CONTENT_MM.w - 6;
    expect(g.noteMm).toBe(Math.round((expectedWMm - 6 * 4) / 5));
  });
});

describe("PAPER_SIZE_MM / contentMmFor —— 纸张尺寸预设（2026-08-27）", () => {
  it("A1 恰好等于既有的 A1_PAPER_MM 常量——不是碰巧一致，是同一份数字", () => {
    expect(PAPER_SIZE_MM.A1).toEqual(A1_PAPER_MM);
  });

  it("A3/A4 是 ISO 216 横版标准值，宽 > 高", () => {
    expect(PAPER_SIZE_MM.A3).toEqual({ w: 420, h: 297 });
    expect(PAPER_SIZE_MM.A4).toEqual({ w: 297, h: 210 });
  });

  it("三档共用同一个固定 10mm 页边距，不按纸张比例缩放——A4 的内容区 = 297-20, 210-20", () => {
    expect(contentMmFor("A4")).toEqual({ w: 277, h: 190 });
    expect(contentMmFor("A1")).toEqual(A1_CONTENT_MM);
  });

  it("A1/A3/A4 共享同一个宽高比（ISO 系列的定义性质）——不是巧合，是这三个数字的数学性质", () => {
    const ratio = (s: { w: number; h: number }) => s.w / s.h;
    expect(ratio(PAPER_SIZE_MM.A1)).toBeCloseTo(ratio(PAPER_SIZE_MM.A3), 2);
    expect(ratio(PAPER_SIZE_MM.A1)).toBeCloseTo(ratio(PAPER_SIZE_MM.A4), 2);
  });
});

describe("sectionGeometryMm —— size 参数按纸张切换内容区 mm 数（缺省仍是 A1，不破坏既有调用方）", () => {
  it("省略 size 与显式传 'A1' 结果逐字相同", () => {
    const withoutSize = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12 });
    const withA1 = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12, size: "A1" });
    expect(withA1).toEqual(withoutSize);
  });

  it("同一份网格坐标，A4 纸算出的 mm 数比 A1 小得多——不是同一个数字换了个标签", () => {
    const onA1 = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12, size: "A1" });
    const onA4 = sectionGeometryMm({ w: 6, h: 3, cols: 5, gridCols: 12, size: "A4" });
    expect(onA4.wMm).toBeLessThan(onA1.wMm);
    expect(onA4.hMm).toBeLessThan(onA1.hMm);
  });
});

describe("classifyNoteSize —— Design.pdf §5「尺寸判定」四档，边界值精确落位", () => {
  it.each([
    [45, "too-small"], [46, "compact"], [69, "compact"],
    [70, "standard"], [82, "standard"], [83, "oversized"],
  ] as const)("%dmm → %s", (mm, expected) => {
    expect(classifyNoteSize(mm)).toBe(expected);
  });
});
