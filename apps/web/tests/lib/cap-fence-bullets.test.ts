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
import { registerTemplate, templateToModel, type TemplateSpec } from "@repo/fabric-markdown";

// 私有的 `cellSizeForArrangement`（`auto-template-layout.ts` 未导出）在这里就地重算，
// 用于验证 `renderStickyCapacity` 是它的精确逆运算——两处算法逐字对应同一份引擎公式。
// `stickyW`/`stickyH` 可覆盖默认的 `ENGINE_STICKY` 尺寸——独立审查抓到的问题：
// 引擎实际用的便签尺寸是 `{...(spec.sticky ?? DEFAULT_STICKY), ...sec.sticky}` 合并
// 后的结果，不同内置模板（bmc/strategy 120×80、burger 180×90、HMW 150×90）与
// `ENGINE_STICKY`（136×92）并不相同，下面几个用例要覆盖非默认尺寸这条真实分支。
function cellFor(
  perRow: number, rows: number, stickyW: number = ENGINE_STICKY.w, stickyH: number = ENGINE_STICKY.h,
): { w: number; h: number } {
  const pitchX = stickyW + ENGINE_STICKY_GAP.x;
  return {
    w: 2 * 14 + perRow * pitchX,
    h: 44 + rows * stickyH + (rows - 1) * ENGINE_STICKY_GAP.y + 14,
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

  it("非默认便签尺寸（如 bmc/strategy 系的 120×80）也要按这份尺寸算，不是恒用 ENGINE_STICKY", () => {
    const bmcSticky = { w: 120, h: 80 };
    const cell = cellFor(2, 3, bmcSticky.w, bmcSticky.h);
    // 用 ENGINE_STICKY（136×92，比 120×80 大）算会得出更小的容量——如果函数偷偷
    // 忽略传入的 stickyW/stickyH、内部还在用 ENGINE_STICKY，这个断言会失败。
    expect(renderStickyCapacity(cell.w, cell.h, 2, true, bmcSticky.w, bmcSticky.h)).toBe(6);
    expect(renderStickyCapacity(cell.w, cell.h, 2, true, ENGINE_STICKY.w, ENGINE_STICKY.h)).not.toBe(6);
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

  it("spec 级 sticky 用非默认尺寸（如 strategy 系 120×80）时，容量按这份尺寸算", () => {
    const bmcSticky = { w: 120, h: 80, perRow: 2 };
    const cell = cellFor(2, 3, bmcSticky.w, bmcSticky.h); // 容量 6（按 120×80）
    const spec: TemplateSpec = {
      key: "t", title: "t", titleBars: true, sticky: bmcSticky,
      sections: [{ name: "A", x: 0, y: 0, w: cell.w, h: cell.h }], // 分区自己不覆盖，吃 spec 级默认
    };
    expect(sectionRenderCapacities(spec).get("A")).toBe(6);
  });

  it("分区级 sticky.w/h 覆盖 spec 级默认时，容量按分区自己的尺寸算", () => {
    const specSticky = { w: 136, h: 92, perRow: 3 }; // = ENGINE_STICKY，容易被悄悄用错
    const sectionSticky = { w: 180, h: 90, perRow: 4 }; // burger 模板同款尺寸
    const cell = cellFor(4, 2, sectionSticky.w, sectionSticky.h); // 容量 8（按 180×90）
    const spec: TemplateSpec = {
      key: "t", title: "t", titleBars: true, sticky: specSticky,
      sections: [{ name: "A", x: 0, y: 0, w: cell.w, h: cell.h, sticky: sectionSticky }],
    };
    expect(sectionRenderCapacities(spec).get("A")).toBe(8);
  });

  it("ground truth：容量与 templateToModel 实际渲染出的便签数量/几何对齐（非默认尺寸）", () => {
    const sectionSticky = { w: 120, h: 80, perRow: 2 };
    const cell = cellFor(2, 2, sectionSticky.w, sectionSticky.h); // 容量 4
    const key = "cap-fence-bullets-ground-truth";
    const spec: TemplateSpec = {
      key, title: "t", titleBars: true,
      sections: [{ name: "A", x: 400, y: 300, w: cell.w, h: cell.h, sticky: sectionSticky }],
    };
    registerTemplate(spec);
    const capacity = sectionRenderCapacities(spec).get("A")!;
    expect(capacity).toBe(4);

    // 喂给引擎的条目数正好等于算出的容量——按引擎自己的合并规则，画出来的便签
    // 应该一张不多、一张不少，且没有一张越出这个分区框的下边界。
    const bullets = Array.from({ length: capacity }, (_, i) => `- 条目${i + 1}`).join("\n");
    const model = templateToModel(`模板: ${key}\n## A\n${bullets}`);
    const stickies = model.nodes.filter((n) => n.data?.role === "sticky");
    expect(stickies).toHaveLength(capacity);
    const sectionBottom = cell.h / 2 + 300; // sec.y + sec.h/2（中心 300，见上面 spec）
    for (const s of stickies) {
      expect(s.y + s.height / 2).toBeLessThanOrEqual(sectionBottom + 1e-6);
    }
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
