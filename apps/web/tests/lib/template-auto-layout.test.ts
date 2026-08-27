/**
 * `autoFillLayout`——「一键排版」（2026-08-27 人类原话：「在编辑界面因该有一个按钮，
 * 可以根据字段一键生成，中间的模板，而不需要人来手工排版」）。
 *
 * ## 核心断言：铺满、不重叠、不越界
 *
 * 这是这个函数存在的全部理由——手工排版最烦的两件事就是「留了空白」和「拖出界」。
 * 下面的 `assertFullCoverage` 是与 `coversFullGrid`（后端 `builtin-template-config.ts`）
 * 同一条判据的前端版本：把每个已放置区块的格子铺进一个 `Set<"col,row">`，断言
 * ① 大小恰好等于 `gridCols × 8`（无重叠——重叠会让 Set 变小；无越界——越界的格子
 * 不在 12×8 范围内，写检查时会被算作「多出来的」而不是「该有的」）
 * ② 每一格都落在 `[1,gridCols]×[1,8]` 范围内。
 */
import { describe, it, expect } from "vitest";
import { autoFillLayout } from "../../components/canvas/template-editor-model";
import type { SectionDraft, SectionFieldType } from "../../components/canvas/template-editor-model";

function draft(id: string, type: SectionFieldType, name = id): SectionDraft {
  return {
    sectionId: id, key: id, name, type,
    required: false, capacity: null, aiHint: "", order: 0,
    layout: null,
  };
}

const GRID_ROWS = 8;

/** 铺满、不重叠、不越界——同 `coversFullGrid` 的判据，前端版。 */
function assertFullCoverage(result: readonly SectionDraft[], gridCols: 6 | 12): void {
  const cells = new Set<string>();
  for (const d of result) {
    expect(d.layout, `${d.name} 应该已放置`).not.toBeNull();
    const l = d.layout!;
    expect(l.col).toBeGreaterThanOrEqual(1);
    expect(l.row).toBeGreaterThanOrEqual(1);
    expect(l.col + l.w - 1).toBeLessThanOrEqual(gridCols);
    expect(l.row + l.h - 1).toBeLessThanOrEqual(GRID_ROWS);
    for (let c = l.col; c < l.col + l.w; c += 1) {
      for (let r = l.row; r < l.row + l.h; r += 1) {
        const key = `${c},${r}`;
        expect(cells.has(key), `格子 ${key} 被 ${d.name} 与另一个区块重叠占用`).toBe(false);
        cells.add(key);
      }
    }
  }
  expect(cells.size).toBe(gridCols * GRID_ROWS);
}

describe("autoFillLayout", () => {
  it("只有表头字段（短文本）——铺满一整条顶带，宽度均分", () => {
    const drafts = [
      draft("a", "短文本"), draft("b", "短文本"), draft("c", "短文本"),
    ];
    // 表头带只占 1 行；正文没有分区，剩余 7 行没有内容可填——不宣称铺满整张画布，
    // 这里只断言表头本身铺满宽度、不重叠。
    const out = autoFillLayout(drafts, 12);
    const header = out.filter((d) => d.layout !== null);
    expect(header).toHaveLength(3);
    const totalW = header.reduce((s, d) => s + d.layout!.w, 0);
    expect(totalW).toBe(12);
    expect(new Set(header.map((d) => d.layout!.row)).size).toBe(1);
  });

  it("只有正文分区——12 列 × 8 行完全铺满，不重叠不越界", () => {
    const drafts = [
      draft("a", "便利贴列表"), draft("b", "便利贴列表"), draft("c", "便利贴列表"),
      draft("d", "长文本"), draft("e", "便利贴列表"),
    ];
    assertFullCoverage(autoFillLayout(drafts, 12), 12);
  });

  it("表头 + 正文混合（典型 persona 形状）——整张画布铺满", () => {
    const drafts = [
      ...["姓名", "性别", "年龄", "区域", "教育水平", "职位", "行业", "家庭情况", "收入水平"]
        .map((n, i) => draft(`h${i}`, "短文本", n)),
      ...["用户描述", "目标和需求", "行为与偏好", "痛点和挑战", "动机", "影响因素"]
        .map((n, i) => draft(`b${i}`, "便利贴列表", n)),
    ];
    assertFullCoverage(autoFillLayout(drafts, 12), 12);
  });

  it("正文分区数很多（10 个）——仍然铺满，不因为行数不够而漏放", () => {
    const drafts = Array.from({ length: 10 }, (_, i) => draft(`b${i}`, "便利贴列表"));
    assertFullCoverage(autoFillLayout(drafts, 12), 12);
  });

  it("只有 1 个正文分区——独占整张画布", () => {
    const drafts = [draft("only", "便利贴列表")];
    const out = autoFillLayout(drafts, 12);
    assertFullCoverage(out, 12);
    expect(out[0]!.layout).toEqual({
      col: 1, row: 1, w: 12, h: 8, cols: 8, max: 6, tone: 0, overflow: "缩小字号",
    });
  });

  it("6 列网格同样铺满，不是只对 12 列生效", () => {
    const drafts = [
      draft("a", "短文本"), draft("b", "短文本"),
      draft("c", "便利贴列表"), draft("d", "便利贴列表"), draft("e", "便利贴列表"),
    ];
    assertFullCoverage(autoFillLayout(drafts, 6), 6);
  });

  it("全量重排：已有的手动 layout 会被覆盖，不是只补未放置的", () => {
    const placed = draft("a", "便利贴列表");
    const withOldLayout: SectionDraft = {
      ...placed,
      layout: { col: 5, row: 5, w: 1, h: 1, cols: 3, max: 6, tone: 2, overflow: "叠放" },
    };
    const out = autoFillLayout([withOldLayout], 12);
    // 重排后应独占整张画布——如果旧 layout 被保留，这里会仍是 (5,5,1,1)。
    expect(out[0]!.layout).toMatchObject({ col: 1, row: 1, w: 12, h: 8 });
  });

  it("空名字的分区不参与排版（与 checkTemplateHealth 的 named 过滤一致）", () => {
    const drafts = [draft("a", "便利贴列表", "   "), draft("b", "便利贴列表")];
    const out = autoFillLayout(drafts, 12);
    expect(out.find((d) => d.sectionId === "a")!.layout).toBeNull();
    expect(out.find((d) => d.sectionId === "b")!.layout).not.toBeNull();
  });
});
