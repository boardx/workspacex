/**
 * issue #2564：「AI 商业模型画布 / 模版编辑 / 显示方式 / 列数」——设计界面（②画布，
 * 样例数据永远刚好等于容量）OK，但真调模型跑一次（chat 模拟 / 真实 chat）之后
 * 排版内容错乱、内容溢出。根因见 `cap-fence-bullets.ts` 文件头：vendor 的
 * `template-engine.ts` 把一个分区收到的便签全部画出来，从不检查框实际放得下几张，
 * 超出的便签会画进相邻分区。这里测两层：① `renderStickyCapacity` 是
 * `cellSizeForArrangement` 的精确逆运算；② `capFenceBulletsToCapacity` 按这个容量
 * 截断围栏正文，不多不少、不误伤其它内容。
 */
import { describe, it, expect } from "vitest";
import { renderStickyCapacity, ENGINE_STICKY, ENGINE_STICKY_GAP } from "@/lib/canvas/auto-template-layout";
import { capFenceBulletsToCapacity, sectionRenderCapacities } from "@/lib/canvas/cap-fence-bullets";
import type { TemplateSpec } from "@repo/fabric-markdown";

// 私有的 `cellSizeForArrangement`（`auto-template-layout.ts` 未导出）在这里就地重算，
// 用于验证 `renderStickyCapacity` 是它的精确逆运算——两处算法逐字对应同一份引擎公式。
function cellFor(perRow: number, rows: number): { w: number; h: number } {
  const pitchX = ENGINE_STICKY.w + ENGINE_STICKY_GAP.x;
  return {
    w: 2 * 14 + perRow * pitchX,
    h: 44 + rows * ENGINE_STICKY.h + (rows - 1) * ENGINE_STICKY_GAP.y + 14,
  };
}

describe("renderStickyCapacity —— cellSizeForArrangement 的逆运算", () => {
  it.each([
    [1, 1], [2, 1], [3, 1], [1, 2], [2, 3], [3, 4], [2, 6],
  ])("perRow=%i rows=%i：按这个尺寸造的框，容量算出来正好是 perRow×rows", (perRow, rows) => {
    const { w, h } = cellFor(perRow, rows);
    expect(renderStickyCapacity(w, h, perRow, true)).toBe(perRow * rows);
  });

  it("框比装 1 张都不够高时，容量为 0（不是负数）", () => {
    expect(renderStickyCapacity(200, 10, 3, true)).toBe(0);
  });

  it("配置的列数比框能放下的还多时，按框能放下的算（不是配置值）", () => {
    // 框只够 1 列宽（w 很窄），配置成 8 列——真实容量应该按 1 列算，不是 8 列。
    const narrow = cellFor(1, 3);
    expect(renderStickyCapacity(narrow.w, narrow.h, 8, true)).toBe(1 * 3);
  });
});

function draftSpec(sections: TemplateSpec["sections"]): TemplateSpec {
  return { key: "t", title: "t", sections, titleBars: true };
}

describe("sectionRenderCapacities", () => {
  it("按每个分区自己的 sticky.perRow（覆盖 spec 级默认）算容量", () => {
    const cellA = cellFor(2, 2); // 容量 4
    const cellB = cellFor(3, 2); // 容量 6
    const spec = draftSpec([
      { name: "A", x: 0, y: 0, w: cellA.w, h: cellA.h, sticky: { perRow: 2 } },
      { name: "B", x: 0, y: 0, w: cellB.w, h: cellB.h, sticky: { perRow: 3 } },
    ]);
    const caps = sectionRenderCapacities(spec);
    expect(caps.get("A")).toBe(4);
    expect(caps.get("B")).toBe(6);
  });
});

describe("capFenceBulletsToCapacity", () => {
  const fence = [
    "模板: ai-business-model",
    "## 核心合作伙伴",
    "- 伙伴1",
    "- 伙伴2",
    "- 伙伴3",
    "## 输入",
    "- 输入1",
    "- 输入2",
    "- 输入3",
    "- 输入4",
    "- 输入5",
    "## 输出",
    "- 输出1",
    "- 输出2",
  ].join("\n");

  it("超出容量的条目整行丢弃，容量够的分区原样保留", () => {
    const caps = new Map([["核心合作伙伴", 3], ["输入", 3], ["输出", 6]]);
    const out = capFenceBulletsToCapacity(fence, caps);
    const lines = out.split("\n");
    expect(lines.filter((l) => l.startsWith("- 伙伴"))).toHaveLength(3); // 没超，原样保留
    expect(lines.filter((l) => l.startsWith("- 输入"))).toHaveLength(3); // 5 条截到 3
    expect(lines).toContain("- 输入1");
    expect(lines).toContain("- 输入3");
    expect(lines).not.toContain("- 输入4");
    expect(lines.filter((l) => l.startsWith("- 输出"))).toHaveLength(2); // 容量够，不截
  });

  it("找不到容量信息的分区（不在 capacities 里）原样保留，不误伤", () => {
    const caps = new Map([["核心合作伙伴", 1]]); // 没有「输入」「输出」的容量信息
    const out = capFenceBulletsToCapacity(fence, caps);
    const lines = out.split("\n");
    expect(lines.filter((l) => l.startsWith("- 伙伴"))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("- 输入"))).toHaveLength(5); // 未知容量，不截
    expect(lines.filter((l) => l.startsWith("- 输出"))).toHaveLength(2);
  });

  it("不改动标题行、模板行与其它非要点内容", () => {
    const caps = new Map([["核心合作伙伴", 1]]);
    const out = capFenceBulletsToCapacity(fence, caps);
    expect(out).toContain("模板: ai-business-model");
    expect(out).toContain("## 核心合作伙伴");
    expect(out).toContain("## 输入");
    expect(out).toContain("## 输出");
  });

  it("容量为 0 时整个分区的要点都被丢弃（如实反映「这里放不下任何一张」）", () => {
    const caps = new Map([["核心合作伙伴", 0]]);
    const out = capFenceBulletsToCapacity(fence, caps);
    const lines = out.split("\n");
    expect(lines.filter((l) => l.startsWith("- 伙伴"))).toHaveLength(0);
  });
});
