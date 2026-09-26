/**
 * 对标 R3（#3933）—— 表格与图表按**数据**画。
 *
 * 钉住：柱高由数值归一化（从 0 起）、0 就是 0；折线点位按数据区间铺开（不从 0 起，否则走势被压平）；
 * 表格行短于表头时补空格子；属性面板的「表格数据 / 数值」文本形态能来回转；设计文档写出样例数据。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { numbersToText, rowsToText, textToNumbers, textToRows } from "@/components/design-loop/prototype-inspector";
import { describeNode } from "@/lib/design-doc-markdown";

afterEach(() => cleanup());

const bar = { type: "chart" as const, id: "c", props: { kind: "bar" as const, title: "每日运动", labels: ["一", "二", "三", "四"], values: [30, 90, 0, 45], unit: "分钟" } };

describe("图表", () => {
  it("柱高按数值比例（从 0 起）：90 是满格、45 是一半、0 就是 0", () => {
    // ⭐ 反证锚点：柱高不按 values 算（固定高度、或画成 image 的灰块）⇒ 这条红。
    render(<PrototypeCanvas label="x" root={bar} />);
    const hs = [...document.querySelectorAll<HTMLElement>("[data-bar]")].map((b) => b.style.height);
    expect(hs).toEqual(["33.33333333333333%", "100%", "0%", "50%"]);
  });

  it("读屏器读得到逐点的数值与单位（不是一串无意义的 div）", () => {
    render(<PrototypeCanvas label="x" root={bar} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("每日运动：一 30分钟，二 90分钟，三 0分钟，四 45分钟");
  });

  it("折线：点位按数据区间铺开，最小值在底部附近、最大值在顶部附近（不从 0 起）", () => {
    const line = { type: "chart" as const, id: "l", props: { kind: "line" as const, labels: ["4月", "5月", "6月"], values: [82, 128, 104] } };
    render(<PrototypeCanvas label="x" root={line} />);
    const bottoms = [...document.querySelectorAll<HTMLElement>("[data-point]")].map((p) => Number.parseFloat(p.style.bottom));
    expect(bottoms[0]).toBeLessThan(15);
    expect(bottoms[1]).toBeGreaterThan(85);
    // 从 0 起的话 82 会在 60% 以上，走势被压成一条几乎平的线。
    expect(bottoms[0]).toBeLessThan(30);
  });

  it("labels 与 values 不等长 ⇒ 画较短那一组，不崩", () => {
    render(<PrototypeCanvas label="x" root={{ ...bar, props: { ...bar.props, values: [1, 2] } }} />);
    expect(document.querySelectorAll("[data-bar]")).toHaveLength(2);
  });
});

describe("表格", () => {
  it("表头一列一个 columnheader；行短于表头时补空格子", () => {
    const table = { type: "table" as const, id: "t", props: { columns: ["订单号", "客户", "金额"], rows: [["#1", "星海", "¥1"], ["#2"]], striped: true } };
    render(<PrototypeCanvas label="x" root={table} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["订单号", "客户", "金额"]);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[2]!.querySelectorAll("td")).toHaveLength(3);
  });
});

describe("属性面板的文本形态", () => {
  it("表格数据：一行一条、格子用 | 或制表符隔开，来回转一致", () => {
    expect(textToRows("#1 | 星海 | ¥1\n\n#2\t北辰\t¥2")).toEqual([["#1", "星海", "¥1"], ["#2", "北辰", "¥2"]]);
    expect(rowsToText([["a", "b"], ["c"]])).toBe("a | b\nc");
  });

  it("数值：一行一个或逗号隔开；读不成数的片段丢掉而不是整组作废", () => {
    expect(textToNumbers("30\n45, 0，12.5 abc")).toEqual([30, 45, 0, 12.5]);
    expect(numbersToText([1, 2.5])).toBe("1\n2.5");
  });
});

describe("设计文档", () => {
  it("写出样例数据，不是一句「这里有张表」", () => {
    expect(describeNode(bar)).toBe("柱状图「每日运动」：一 30分钟，二 90分钟，三 0分钟，四 45分钟");
    expect(describeNode({ type: "table", props: { columns: ["a", "b"], rows: [["1", "2"]] } })).toBe("表格（a / b）：1 行，首行「1 / 2」");
  });
});
