/**
 * `diffMermaidGraphs`（domain）——产业图谱两版之间的结构差异。
 *
 * 每条用例都断言**完整的返回数组**，不是「包含某一条」：这个函数的契约是
 * 「只返回变化的条目」，用 `toContainEqual` 会让「顺手多报了三条没变的」永远绿。
 */
import { describe, expect, it } from "vitest";
import { diffMermaidGraphs, parseMermaidGraph } from "../../src/domain/chat/mermaid-graph-diff";

const BASE = `graph TD
  raw[原材料] --> mid[中间品]
  mid -->|加工| fin[成品]
`;

describe("diffMermaidGraphs", () => {
  it("两份相同的源没有任何差异", () => {
    expect(diffMermaidGraphs(BASE, BASE)).toEqual([]);
  });

  it("语句顺序变化、空行与注释不算差异", () => {
    const reordered = `graph TD
  %% 换了个写法，图没变
  mid -->|加工| fin[成品]

  raw[原材料] --> mid[中间品]
`;
    expect(diffMermaidGraphs(BASE, reordered)).toEqual([]);
  });

  it("新增节点", () => {
    const after = `${BASE}  fin --> sale[销售]\n`;
    expect(diffMermaidGraphs(BASE, after)).toEqual([
      { kind: "node", change: "added", id: "sale", label: "销售", status: null },
      { kind: "edge", change: "added", from: "fin", to: "sale", label: "" },
    ]);
  });

  it("删除节点（连同它的边）", () => {
    const after = `graph TD
  raw[原材料] --> mid[中间品]
`;
    expect(diffMermaidGraphs(BASE, after)).toEqual([
      { kind: "node", change: "removed", id: "fin", label: "成品", status: null },
      { kind: "edge", change: "removed", from: "mid", to: "fin", label: "加工" },
    ]);
  });

  it("节点文案改了", () => {
    const after = BASE.replace("中间品", "中间品（精炼）");
    expect(diffMermaidGraphs(BASE, after)).toEqual([
      { kind: "node", change: "changed", id: "mid", field: "label", before: "中间品", after: "中间品（精炼）" },
    ]);
  });

  it("节点状态（`:::class`）改了", () => {
    const before = `graph TD\n  mid[中间品]:::planned --> fin[成品]\n`;
    const after = `graph TD\n  mid[中间品]:::built --> fin[成品]\n`;
    expect(diffMermaidGraphs(before, after)).toEqual([
      { kind: "node", change: "changed", id: "mid", field: "status", before: "planned", after: "built" },
    ]);
  });

  it("同一个节点文案与状态都改了 ⇒ 两条", () => {
    const before = `graph TD\n  mid[中间品]:::planned --> fin[成品]\n`;
    const after = `graph TD\n  mid[精炼品]:::built --> fin[成品]\n`;
    expect(diffMermaidGraphs(before, after)).toEqual([
      { kind: "node", change: "changed", id: "mid", field: "label", before: "中间品", after: "精炼品" },
      { kind: "node", change: "changed", id: "mid", field: "status", before: "planned", after: "built" },
    ]);
  });

  it("新增边（节点都还在）", () => {
    const after = `${BASE}  raw --> fin\n`;
    expect(diffMermaidGraphs(BASE, after)).toEqual([
      { kind: "edge", change: "added", from: "raw", to: "fin", label: "" },
    ]);
  });

  it("删除边（节点都还在）", () => {
    const after = `graph TD
  raw[原材料] --> mid[中间品]
  fin[成品]
`;
    expect(diffMermaidGraphs(BASE, after)).toEqual([
      { kind: "edge", change: "removed", from: "mid", to: "fin", label: "加工" },
    ]);
  });

  it("边上的标签改了", () => {
    const after = BASE.replace("|加工|", "|深加工|");
    expect(diffMermaidGraphs(BASE, after)).toEqual([
      { kind: "edge", change: "changed", from: "mid", to: "fin", before: "加工", after: "深加工" },
    ]);
  });

  it("`A -- 文本 --> B` 与 `A -->|文本| B` 是同一条边", () => {
    const midLabel = `graph TD
  raw[原材料] --> mid[中间品]
  mid -- 加工 --> fin[成品]
`;
    expect(diffMermaidGraphs(BASE, midLabel)).toEqual([]);
  });
});

describe("parseMermaidGraph", () => {
  it("认得各种形状括号与虚线/粗线连接符", () => {
    const graph = parseMermaidGraph(`flowchart LR
  a((圆)) -.-> b{菱形}
  b ==> c[[子程序]]
  d>旗帜]
`);
    expect(graph.nodes).toEqual([
      { id: "a", label: "圆", status: null },
      { id: "b", label: "菱形", status: null },
      { id: "c", label: "子程序", status: null },
      { id: "d", label: "旗帜", status: null },
    ]);
    expect(graph.edges).toEqual([
      { from: "a", to: "b", label: "" },
      { from: "b", to: "c", label: "" },
    ]);
  });

  it("裸 id 再次出现不会把已知文案抹回 id", () => {
    const graph = parseMermaidGraph(`graph TD\n  a[原材料] --> b[成品]\n  a --> b\n`);
    expect(graph.nodes[0]).toEqual({ id: "a", label: "原材料", status: null });
    expect(graph.edges).toHaveLength(1);
  });

  it("图种声明/样式/注释不会被当成节点", () => {
    const graph = parseMermaidGraph(`graph TD
  %% 注释
  classDef built fill:#0f0
  style a stroke:#333
  a[原材料]
`);
    expect(graph.nodes).toEqual([{ id: "a", label: "原材料", status: null }]);
  });
});
