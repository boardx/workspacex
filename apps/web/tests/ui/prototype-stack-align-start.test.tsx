/**
 * issue #4322 —— 纵向 stack 的 `align:"start"` 意思是「靠左」，不是「块级子项缩成内容宽」。
 *
 * 真实生成 41 页里 37 页写了它；映射成 `items-start` 时导航栏 / 卡片 / 列表全塌成内容宽。
 * jsdom 没有布局，这里判的是**交叉轴的对齐类**——宽度本身由真浏览器截图核对（见 issue）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import type { PrototypeNode } from "@/lib/live-design-workbench";

afterEach(cleanup);

const stack = (direction: "row" | "column", align?: "start" | "center"): PrototypeNode => ({
  id: "s", type: "stack", props: { direction, ...(align ? { align } : {}) },
  children: [
    { id: "nav", type: "navbar", props: { title: "今日心情" } },
    { id: "btn", type: "button", props: { label: "记录今天的心情" } },
  ],
});

function stackClass(root: PrototypeNode): string {
  const { container } = render(<PrototypeCanvas label="页面" root={root} />);
  const el = container.querySelector('[data-node-id="s"]') ?? container.querySelector('[data-proto="stack"]');
  expect(el, "没找到 stack 节点").not.toBeNull();
  return el!.className;
}

describe("stack align:start", () => {
  it("⭐ 反证锚点：纵向 + start ⇒ 块级子项拉伸（items-stretch），不是 items-start", () => {
    const cls = stackClass(stack("column", "start"));
    expect(cls).toContain("items-stretch");
    expect(cls.split(/\s+/)).not.toContain("items-start");
  });

  it("纵向 + start ⇒ 非通栏按钮仍贴左保持内容宽（button.full 仍有意义）", () => {
    expect(stackClass(stack("column", "start"))).toContain("[&>[data-proto=button]]:self-start");
  });

  it("与「未指定 align」的纵向 stack 同为拉伸——两者对块级子项不再有区别", () => {
    expect(stackClass(stack("column"))).toContain("items-stretch");
  });

  it("横向 + start 不变（仍是 items-start）；纵向 center 不变", () => {
    expect(stackClass(stack("row", "start")).split(/\s+/)).toContain("items-start");
    expect(stackClass(stack("column", "center")).split(/\s+/)).toContain("items-center");
  });
});
