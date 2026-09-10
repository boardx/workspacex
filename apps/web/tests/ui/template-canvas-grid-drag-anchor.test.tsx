/**
 * 「拖拽即移动」（用户直接交办，2026-09-10）的组件级反证。
 *
 * 人类原话：「我一定要鼠标 hover 到某个格子放手，Move 的 field 的 topleft 就是在
 * 那个格子，这个体验有问题，应该是，我鼠标拖拽的过程就是移动这个 field 的过程，
 * 以 field 的 panel 作为一个整体来移动」。
 *
 * 改动前：`onMove(id, 指针所在格)`，即抓握点被强行等同于区块左上角——从区块中部
 * 抓起来往右挪一格，区块会朝左上跳一整个抓握偏移。改动后：`dragstart` 记下抓握
 * 偏移，落点回减，整块跟着指针平移。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { TemplateCanvasGrid } from "@/components/canvas/template-canvas-grid";
import type { SectionDraft } from "@/components/canvas/template-editor-model";

/** 12 列 × 8 行的内容区，每格 100×100 px——格号换算成坐标一目了然。 */
const CELL = 100;
const RECT = { left: 0, top: 0, width: 12 * CELL, height: 8 * CELL, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

/** jsdom 不排版，`getBoundingClientRect` 恒为 0——落点换算按比例，必须给它真实尺寸。 */
function stubRect(el: HTMLElement): void {
  el.getBoundingClientRect = () => RECT;
}

/**
 * 派发一个带 `clientX/clientY` + `dataTransfer` 的拖拽事件。
 *
 * ⚠ 不能用 `fireEvent.drop(el, { clientX })`：jsdom 没有 `DragEvent` 构造函数，
 *   testing-library 退化成通用 `Event`，`clientX/clientY` 被整个丢掉（实测落点算出
 *   `NaN`）。改成手搓一个 `MouseEvent`（它认坐标）再挂上 `dataTransfer`——React 按
 *   事件 `type` 派发，不校验事件类，合成事件照样拿得到这两样。
 */
function fireDrag(
  el: HTMLElement, type: string, x: number, y: number,
  dt: { setData: (t: string, v: string) => void; getData: (t: string) => string },
): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  fireEvent(el, ev);
}

/** `dataTransfer` 在 jsdom 的合成事件里不存在，补一个只认一个 key 的最小实现。 */
function dataTransfer(): { setData: (t: string, v: string) => void; getData: (t: string) => string } {
  const store = new Map<string, string>();
  return {
    setData: (t, v) => { store.set(t, v); },
    getData: (t) => store.get(t) ?? "",
  };
}

function listSection(over: Partial<SectionDraft> = {}): SectionDraft {
  return {
    sectionId: "s1", key: "actions", name: "行为", type: "便利贴列表", aiHint: null,
    order: 0, required: false, capacity: null,
    // col 2..7（6 格宽）、row 2..4（3 格高）。
    layout: { col: 2, row: 2, w: 6, h: 3, cols: 3, max: 6, tone: 0, overflow: "缩小字号" },
    content: "", color: null, fontSize: 24, fontWeight: "normal",
    hideFieldTitle: false, align: "left", valign: "top",
    ...over,
  };
}

function setup(onMove: (id: string, col: number, row: number) => void) {
  const utils = render(
    <TemplateCanvasGrid
      sections={[listSection()]}
      gridCols={12}
      showSample={false}
      runData={null}
      selectedId={null}
      editable
      title=""
      footer=""
      onSelect={() => {}}
      onPlace={() => {}}
      onMove={onMove}
    />,
  );
  stubRect(utils.getByTestId("tpladmin-editor-canvas-content"));
  return utils;
}

describe("TemplateCanvasGrid —— 拖拽以整块平移，不是把左上角吸到指针格", () => {
  it("从区块中部抓起、指针只右移一格，区块整体右移一格（不跳到指针那一格）", () => {
    const onMove = vi.fn();
    const { getByTestId } = setup(onMove);
    const block = getByTestId("tpladmin-editor-block-s1");
    const dt = dataTransfer();

    // 抓握点落在第 4 列第 3 行（区块左上角是 col2/row2 ⇒ 偏移 +2 列 +1 行）。
    fireDrag(block, "dragstart", 3.5 * CELL, 2.5 * CELL, dt);
    // 指针右移一格 → 第 5 列第 3 行。
    fireDrag(getByTestId("tpladmin-editor-canvas"), "drop", 4.5 * CELL, 2.5 * CELL, dt);

    // 整块右移一格：col 2→3，row 不变。
    // 改动前这里会是 (5, 3) —— 左上角被吸到指针所在格。
    expect(onMove).toHaveBeenCalledWith("s1", 3, 2);
  });

  it("拖动中按整块的目标矩形画落点预览，预览与最终落点是同一个几何", () => {
    const onMove = vi.fn();
    const { getByTestId, queryByTestId } = setup(onMove);
    const block = getByTestId("tpladmin-editor-block-s1");
    const canvas = getByTestId("tpladmin-editor-canvas");
    const dt = dataTransfer();

    expect(queryByTestId("tpladmin-editor-drop-preview")).toBeNull();
    fireDrag(block, "dragstart", 3.5 * CELL, 2.5 * CELL, dt);
    fireDrag(canvas, "dragover", 5.5 * CELL, 4.5 * CELL, dt);

    const preview = getByTestId("tpladmin-editor-drop-preview");
    // 指针从 (4,3) 挪到 (6,5)，即 +2 列 +2 行 ⇒ 目标左上角 col 4 / row 4，跨度不变。
    expect(preview.style.gridColumn).toBe("4 / span 6");
    expect(preview.style.gridRow).toBe("4 / span 3");

    fireDrag(canvas, "drop", 5.5 * CELL, 4.5 * CELL, dt);
    expect(onMove).toHaveBeenCalledWith("s1", 4, 4);
    // 松手后预览撤掉，不留一个悬着的蓝框。
    expect(queryByTestId("tpladmin-editor-drop-preview")).toBeNull();
  });

  it("左栏拖进来的新字段没有抓握偏移，落点仍是指针所在格", () => {
    const onPlace = vi.fn();
    const { getByTestId } = render(
      <TemplateCanvasGrid
        sections={[listSection({ layout: null })]}
        gridCols={12}
        showSample={false}
        runData={null}
        selectedId={null}
        editable
        title=""
        footer=""
        onSelect={() => {}}
        onPlace={onPlace}
        onMove={() => {}}
      />,
    );
    stubRect(getByTestId("tpladmin-editor-canvas-content"));
    const dt = dataTransfer();
    dt.setData("application/x-tpl-drag", JSON.stringify({ id: "s1", kind: "field" }));
    fireDrag(getByTestId("tpladmin-editor-canvas"), "drop", 4.5 * CELL, 2.5 * CELL, dt);
    expect(onPlace).toHaveBeenCalledWith("s1", 5, 3);
  });
});
