/**
 * 2026-09-23 —— 拖拽把手的**可达性与接线**（判据本身在 `lib/chat-workbench/panel-width.ts`）。
 *
 * 这里要证的是三件 jsdom 判得动的事：
 *   ① 它是 WAI-ARIA 的 window splitter（`role="separator"` + valuenow/min/max），
 *     而不是一个只有鼠标能用的装饰条——键盘用户拿到的是同一件能力；
 *   ② 键盘真的改宽度，且方向与拖拽一致；
 *   ③ 认不出的按键**不拦**默认行为（Tab 还要能走出去）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PanelResizeHandle } from "@/components/shell/panel-resize-handle";
import {
  PANEL_WIDTH_DEFAULT, PANEL_WIDTH_KEY_STEP, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN,
} from "@/lib/chat-workbench/panel-width";

const setup = (width = 300) => {
  const onWidthChange = vi.fn();
  render(<PanelResizeHandle edge="left" width={width} onWidthChange={onWidthChange} label="调整宽度" />);
  return { handle: screen.getByTestId("panel-resize-handle"), onWidthChange };
};

it("是 window splitter：报得出当前值与可调范围", () => {
  const { handle } = setup(300);
  expect(handle).toHaveAttribute("role", "separator");
  expect(handle).toHaveAttribute("aria-orientation", "vertical");
  expect(handle).toHaveAttribute("aria-valuenow", "300");
  expect(handle).toHaveAttribute("aria-valuemin", String(PANEL_WIDTH_MIN));
  expect(handle).toHaveAttribute("aria-valuemax", String(PANEL_WIDTH_MAX));
  expect(handle).toHaveAttribute("aria-label", "调整宽度");
  // 键盘可达：不可聚焦的分隔条等于只有鼠标能用
  expect(handle).toHaveAttribute("tabindex", "0");
});

it("键盘改宽度，方向与拖拽一致（右栏往左是变宽）", () => {
  const { handle, onWidthChange } = setup(300);
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(onWidthChange).toHaveBeenLastCalledWith(300 + PANEL_WIDTH_KEY_STEP);
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(onWidthChange).toHaveBeenLastCalledWith(300 - PANEL_WIDTH_KEY_STEP);
  fireEvent.keyDown(handle, { key: "End" });
  expect(onWidthChange).toHaveBeenLastCalledWith(PANEL_WIDTH_MIN);
});

it("双击回默认宽度——鼠标用户也该有这个动作", () => {
  const { handle, onWidthChange } = setup(520);
  fireEvent.doubleClick(handle);
  expect(onWidthChange).toHaveBeenLastCalledWith(PANEL_WIDTH_DEFAULT);
});

it("认不出的按键不改宽度、也不拦默认行为", () => {
  const { handle, onWidthChange } = setup(300);
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  handle.dispatchEvent(event);
  expect(onWidthChange).not.toHaveBeenCalled();
  expect(event.defaultPrevented, "拦掉 Tab 会把焦点困在把手上").toBe(false);
});

it("右键不改布局", () => {
  const { handle, onWidthChange } = setup(300);
  fireEvent.pointerDown(handle, { button: 2, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
  expect(onWidthChange).not.toHaveBeenCalled();
});
