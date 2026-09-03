/**
 * issue #2564：「AI 商业模型画布 / 模版编辑 / 显示方式 / 列数」——排版内容错乱、内容
 * 溢出。根因见 `template-editor-model.ts` 的 `rectsOverlap` 文档：编辑器此前允许把
 * 一个分区的位置/宽高改到与另一个已放置分区在网格上重叠，`buildExplicitTemplateSpec`
 * 对重叠的分区没有任何去重/避让，画出来就是标题条互相压住、便签溢出到相邻分区。
 *
 * 这里只测**纯函数**本身（`rectsOverlap`/`collidesWithOthers`/`findOverlappingSections`/
 * `maxFreeW`/`maxFreeH`），不测组件——同 `template-auto-layout.test.ts` 的既有约定。
 */
import { describe, it, expect } from "vitest";
import {
  rectsOverlap, collidesWithOthers, findOverlappingSections, maxFreeW, maxFreeH,
  checkTemplateHealth,
  type SectionDraft, type SectionLayoutDraft,
} from "../../components/canvas/template-editor-model";

function layout(col: number, row: number, w: number, h: number): SectionLayoutDraft {
  return { col, row, w, h, cols: 3, max: 6, tone: 0, overflow: "缩小字号" };
}

function draft(id: string, l: SectionLayoutDraft | null, name = id): SectionDraft {
  return {
    sectionId: id, key: id, name, type: "便利贴列表",
    required: false, capacity: null, aiHint: "", order: 0,
    layout: l,
  };
}

describe("rectsOverlap", () => {
  it("两个矩形有交集 ⇒ true", () => {
    expect(rectsOverlap(layout(1, 1, 3, 2), layout(2, 1, 3, 2))).toBe(true);
  });

  it("边挨边（不重叠）⇒ false —— 正常的相邻版式不该被误报", () => {
    expect(rectsOverlap(layout(1, 1, 3, 2), layout(4, 1, 3, 2))).toBe(false);
    expect(rectsOverlap(layout(1, 1, 3, 2), layout(1, 3, 3, 2))).toBe(false);
  });

  it("完全分离 ⇒ false", () => {
    expect(rectsOverlap(layout(1, 1, 2, 2), layout(9, 6, 2, 2))).toBe(false);
  });

  it("一个矩形完全包含另一个 ⇒ true", () => {
    expect(rectsOverlap(layout(1, 1, 6, 6), layout(2, 2, 1, 1))).toBe(true);
  });
});

describe("collidesWithOthers / findOverlappingSections", () => {
  it("与另一个已放置分区重叠时 collidesWithOthers 为 true，自己不算数", () => {
    const sections = [draft("a", layout(1, 1, 3, 2)), draft("b", layout(4, 1, 3, 2))];
    expect(collidesWithOthers(sections, "a", layout(1, 1, 3, 2))).toBe(false); // 跟自己比不算重叠
    expect(collidesWithOthers(sections, "c", layout(3, 1, 2, 1))).toBe(true); // 落进 a 的范围（col 3）
  });

  it("未放置的分区（layout=null）不参与碰撞检查", () => {
    const sections = [draft("a", null), draft("b", layout(1, 1, 3, 2))];
    expect(collidesWithOthers(sections, "c", layout(1, 1, 3, 2))).toBe(true); // 撞 b
    expect(collidesWithOthers(sections, "c", layout(9, 6, 1, 1))).toBe(false); // 没撞任何东西
  });

  it("findOverlappingSections 只报真正重叠的那些，不报正常相邻的版式", () => {
    const clean = [draft("a", layout(1, 1, 3, 2)), draft("b", layout(4, 1, 3, 2))];
    expect(findOverlappingSections(clean)).toHaveLength(0);

    const overlapping = [
      draft("a", layout(1, 1, 4, 2)),
      draft("b", layout(3, 1, 4, 2)), // 与 a 在 col 3-4 重叠
      draft("c", layout(9, 6, 1, 1)), // 独立、不重叠
    ];
    const bad = findOverlappingSections(overlapping);
    expect(bad.map((s) => s.sectionId).sort()).toEqual(["a", "b"]);
  });
});

describe("maxFreeW / maxFreeH", () => {
  it("旁边没有其它分区时，上限就是画布边界", () => {
    const sections = [draft("a", layout(1, 1, 1, 1))];
    expect(maxFreeW(sections, "a", 1, 1, 1, 12)).toBe(12);
    expect(maxFreeH(sections, "a", 1, 1, 1)).toBe(8);
  });

  it("右边紧挨着另一个已放置分区时，宽度上限被收窄到不会撞上它", () => {
    const sections = [
      draft("a", layout(1, 1, 3, 2)),
      draft("b", layout(4, 1, 3, 2)), // 紧挨在 a 右边，col 4 起
    ];
    // a 从 col=1 起，最多只能长到 col=3（w=3），再长一格就撞上 b。
    expect(maxFreeW(sections, "a", 1, 1, 2, 12)).toBe(3);
  });

  it("下边紧挨着另一个已放置分区时，高度上限同理被收窄", () => {
    const sections = [
      draft("a", layout(1, 1, 2, 3)),
      draft("b", layout(1, 4, 2, 3)), // 紧挨在 a 下边，row 4 起
    ];
    expect(maxFreeH(sections, "a", 1, 1, 2)).toBe(3);
  });
});

describe("checkTemplateHealth —— overlapping（issue #2564）", () => {
  it("没有重叠时 overlapping 为空、不影响 publishClean", () => {
    const sections = [draft("a", layout(1, 1, 3, 2)), draft("b", layout(4, 1, 3, 2))];
    const h = checkTemplateHealth(sections, 12);
    expect(h.overlapping).toHaveLength(0);
    expect(h.publishClean).toBe(true);
  });

  it("存量数据里的重叠会被体检报出来，且阻断 publishClean（同其它 §6 校验规则）", () => {
    const sections = [draft("a", layout(1, 1, 4, 2)), draft("b", layout(3, 1, 4, 2))];
    const h = checkTemplateHealth(sections, 12);
    expect(h.overlapping.map((s) => s.sectionId).sort()).toEqual(["a", "b"]);
    expect(h.publishClean).toBe(false);
  });
});
