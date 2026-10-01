/**
 * design-delta `prototype-board`——自由画布。
 *
 * 用户实测做一个白板产品（进入白板 / 添加便签 / 连线与整理 / 多人协作），四页都画不出白板本身，
 * 模型只能拿列表和卡片凑：「感觉无法理解我的意思」。人类裁决新增 board 原语。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { designPrototype } from "@repo/contracts";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { buildPrototypeReactTsx } from "@/lib/prototype-react-export";
import type { PrototypeNode } from "@/lib/live-design-workbench";

afterEach(cleanup);

const board: PrototypeNode = {
  id: "b", type: "board", props: {
    items: [
      { kind: "text", text: "Q3 改版头脑风暴", x: 50, y: 8 },
      { kind: "sticky", text: "首次打开找不到入口", x: 20, y: 35, color: "yellow", author: "王明" },
      { kind: "sticky", text: "引导太长，流失六成", x: 50, y: 35, color: "pink", author: "李婷" },
      { kind: "shape", text: "拆成三步可跳过", x: 50, y: 75, shape: "round", color: "green" },
    ],
    links: [{ from: 1, to: 3, label: "解决" }, { from: 2, to: 3 }],
    cursors: [{ name: "张伟", x: 78, y: 55 }],
  },
};

describe("契约", () => {
  it("合法的画布过契约；连线指向不存在的元素 / 连向自己 ⇒ 拒", () => {
    expect(designPrototype.PrototypeNode.safeParse(board).success).toBe(true);
    const bad = (links: unknown) => designPrototype.PrototypeNode.safeParse({ ...board, props: { ...(board as { props: object }).props, links } }).success;
    expect(bad([{ from: 1, to: 9 }])).toBe(false);
    expect(bad([{ from: 2, to: 2 }])).toBe(false);
  });
  it("坐标出界、元素超过上限 ⇒ 拒", () => {
    expect(designPrototype.PrototypeNode.safeParse({ type: "board", props: { items: [{ kind: "sticky", text: "x", x: 120, y: 0 }] } }).success).toBe(false);
    const many = Array.from({ length: designPrototype.PROTOTYPE_BOARD_MAX_ITEMS + 1 }, (_, i) => ({ kind: "sticky", text: String(i), x: 1, y: 1 }));
    expect(designPrototype.PrototypeNode.safeParse({ type: "board", props: { items: many } }).success).toBe(false);
  });
});

describe("画布渲染", () => {
  it("⭐ 反证锚点：便签按中心坐标摆放、带署名与纸色；连线与光标都画出来", () => {
    const { container } = render(<PrototypeCanvas label="添加便签" root={board} />);
    const el = container.querySelector('[data-proto="board"]')!;
    expect(el).toBeTruthy();
    const sticky = el.querySelector('[data-board-item="1"]') as HTMLElement;
    expect(sticky.textContent).toContain("首次打开找不到入口");
    expect(sticky.textContent).toContain("王明");
    expect(sticky.style.left).toBe("20%");
    expect(sticky.style.top).toBe("35%");
    expect(sticky.style.backgroundColor).not.toBe("");
    expect(el.querySelectorAll("[data-board-link]")).toHaveLength(2);
    expect(el.textContent).toContain("解决");               // 连线标签
    expect(el.querySelector('[data-board-cursor="张伟"]')).toBeTruthy();
    // 读屏说得出画布上写了什么
    expect(el.getAttribute("aria-label")).toContain("首次打开找不到入口");
  });
});

describe("React 导出", () => {
  it("导出的代码里便签、连线、光标都在，位置与画布同一套百分比", () => {
    const tsx = buildPrototypeReactTsx({ name: "白板", frames: ["添加便签"], prototype: [board], frameLinks: [[]], accent: "neutral", tokens: { brand: null, font: "sans", radius: "default", density: "default" }, theme: "light" } as never);
    expect(tsx).toContain("首次打开找不到入口");
    expect(tsx).toContain('left: "20%", top: "35%"');
    expect((tsx.match(/<line /g) ?? []).length).toBe(2);
    expect(tsx).toContain("张伟");
  });
});
