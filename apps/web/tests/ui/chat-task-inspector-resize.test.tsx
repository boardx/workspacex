/**
 * 2026-09-23 —— 右栏宽度真的可调，并且记得住。
 *
 * 人类要求：「模范他们（Claude Code / Codex）应该在右边可以打开结果……然后可以拖拽边界」。
 * 改动前整个壳里**一处拖拽都没有**：`grep -c "onPointerDown\|resize"` 在 shell 与 inspector
 * 下都是 0，右栏只有 `w-72`（288px）展开 / `w-10` 折叠两档写死。
 *
 * 这份测试打在**接线**上（宽度有没有真的落到 DOM、有没有持久化、折叠/移动态给不给把手）；
 * 判据本身（夹取、方向、按键换算）在 `tests/lib/panel-width.test.ts`。
 */
import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import {
  PANEL_WIDTH_DEFAULT, PANEL_WIDTH_KEY_STEP, panelWidthStorageKey,
} from "@/lib/chat-workbench/panel-width";

const KEY = panelWidthStorageKey("chat-inspector");

function props(overrides: Partial<ChatTaskInspectorProps> = {}): ChatTaskInspectorProps {
  return {
    hasSelection: true, threadId: "t-1", artifacts: null, materials: null, loading: false,
    artifactsError: null, materialsError: null, onRetry: () => {}, pendingMaterialsCount: 0,
    planTodos: null, isRunning: false, runPhaseLabel: null, runStartedAt: null, ...overrides,
  };
}

/** 桌面态：`matchMedia` 默认在 jsdom 里返回 false（非移动），显式给一个稳定实现。 */
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const aside = (): HTMLElement => screen.getByTestId("chat-task-workbench-inspector");
/**
 * 右栏**默认折叠**，而且只能靠用户手点展开（#2695：自动展开是缺陷，不是便利）。
 * 所以每条「展开态」的断言都必须先把它点开——这不是测试脚手架的噪音，
 * 它本身就说明了一件事：把手只在用户主动展开之后才存在。
 */
const expand = (): void => { fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-expand")); };

it("展开态带把手，宽度落在 DOM 的 style 上（默认与被它取代的 w-72 等宽）", () => {
  render(<ChatTaskInspector {...props()} />);
  expand();
  expect(aside()).toHaveAttribute("data-collapsed", "false");
  expect(aside().style.width).toBe(`${String(PANEL_WIDTH_DEFAULT)}px`);
  expect(screen.getByTestId("chat-task-workbench-inspector-resize")).toBeInTheDocument();
});

it("键盘调宽之后：DOM 宽度变了，并且写进了 localStorage", () => {
  render(<ChatTaskInspector {...props()} />);
  expand();
  fireEvent.keyDown(screen.getByTestId("chat-task-workbench-inspector-resize"), { key: "ArrowLeft" });
  const expected = PANEL_WIDTH_DEFAULT + PANEL_WIDTH_KEY_STEP;
  expect(aside().style.width).toBe(`${String(expected)}px`);
  // 用户调过的宽度是他的工作习惯，不是服务端事实——同 `shell.leftCollapsed` 的既有先例
  expect(window.localStorage.getItem(KEY)).toBe(String(expected));
});

it("下次进来读回上次的宽度", () => {
  window.localStorage.setItem(KEY, "420");
  render(<ChatTaskInspector {...props()} />);
  expand();
  expect(aside().style.width).toBe("420px");
});

it("折叠态不给把手——40px 图标条是另一种形态，不是更窄的同一档", () => {
  render(<ChatTaskInspector {...props()} />);
  expand();
  expect(screen.getByTestId("chat-task-workbench-inspector-resize")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-collapse"));
  expect(aside()).toHaveAttribute("data-collapsed", "true");
  expect(screen.queryByTestId("chat-task-workbench-inspector-resize")).toBeNull();
  // 折叠态的宽度仍由类名给（w-10），不该被 style 覆盖成 288px
  expect(aside().style.width).toBe("");
});
