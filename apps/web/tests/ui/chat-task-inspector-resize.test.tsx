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

/**
 * \u5e76\u884c\u4f1a\u8bdd 2026-09-23 \u7684\u5b9e\u6d4b\u544a\u8b66\uff1aRTL \u9ed8\u8ba4**\u4e0d\u5957 StrictMode**\u3002\u4ed6\u4eec\u90a3\u6761
 * \u300c\u6302\u8f7d\u65f6\u8bfb\u4e00\u6b21 sessionStorage \u4e00\u6b21\u6027\u503c\u300d\u7684 effect\uff0c15 \u6761 jsdom \u6d4b\u8bd5\u5168\u7eff\uff0c
 * \u771f\u5b9e\u6d4f\u89c8\u5668\u91cc\u4ece\u6765\u6ca1\u751f\u6548\u2014\u2014\u4e25\u683c\u6a21\u5f0f\u8dd1\u4e24\u6b21\uff0c\u7b2c\u4e8c\u6b21\u8bfb\u5230\u7a7a\u628a\u7b2c\u4e00\u6b21\u76d6\u6389\u4e86\u3002
 *
 * \u672c\u680f\u7684\u5bbd\u5ea6\u8bfb\u53d6\u662f\u7eaf `getItem`\uff08\u4e0d\u662f take-once\uff09\uff0c\u6240\u4ee5**\u73b0\u5728**\u4e0d\u5403\u8fd9\u4e00\u6761\u3002
 * \u4f46\u90a3\u662f\u6211\u7684\u63a8\u7406\u4e0d\u662f\u53d6\u8bc1\uff1a\u54ea\u5929\u6709\u4eba\u628a\u5b83\u91cd\u6784\u6210\u300c\u8bfb\u5b8c\u5c31\u6d88\u8017\u300d\uff0c\u9ed8\u8ba4\u90a3\u51e0\u6761
 * \u6d4b\u8bd5\u4f9d\u7136\u5168\u7eff\u3002\u8fd9\u6761\u663e\u5f0f\u5957 StrictMode\uff0c\u628a\u300c\u53cc\u8dd1\u4e0d\u6539\u53d8\u7ed3\u679c\u300d\u53d8\u6210\u4f1a\u7ea2\u7684\u4e1c\u897f\u3002
 */
it("StrictMode \u4e0b\u91cd\u8dd1 effect\uff0c\u5bbd\u5ea6\u4ecd\u7136\u662f\u5b58\u8d77\u6765\u7684\u90a3\u4e2a\u503c", () => {
  window.localStorage.setItem(KEY, "420");
  render(<React.StrictMode><ChatTaskInspector {...props()} /></React.StrictMode>);
  expand();
  expect(aside().style.width).toBe("420px");
});
