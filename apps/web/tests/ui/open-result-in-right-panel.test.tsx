/**
 * R11 —— **工具结果也能在右栏打开**（人类原话：「在右边可以打开结果，浏览网页等」）。
 *
 * 改动前：`fetch_url` 抓回来的网页正文只活在执行过程那一列里——折叠行 → 展开 →
 * 一个 `max-h-64` 的 `<pre>`，长正文在那个格子里滚。读不了，更别说边读边追问。
 *
 * 两端分开验，中间靠 window 事件（理由同 `lib/shell-panel-events.ts` 文件头注：
 * 执行过程画在消息流里、右栏是另一棵子树，两边在多份单测里各自被 mock）：
 *   ① 发起端：执行过程给出口，并且**只对够长的结果**给；
 *   ② 接收端：右栏真的把它显示出来，而且是可见的（切页签 + 展开）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import {
  OPEN_IN_RIGHT_PANEL_EVENT, onOpenInRightPanel, requestOpenInRightPanel,
} from "@/lib/chat-workbench/panel-document";

vi.mock("@/components/chat/workbench/agent-artifact-versions-panel", () => ({
  AgentArtifactVersionsPanel: () => null,
}));

const LONG = "网页正文".repeat(80);
const base = { runId: "run-1", emittedAt: "2026-09-23T00:00:00Z" };
const fetched = (result: string): ExecutionEvent[] => [
  { ...base, seq: 1, kind: "tool_start", toolCallId: "c1", toolName: "fetch_url", args: { url: "https://example.com/a" } },
  { ...base, seq: 2, kind: "tool_end", toolCallId: "c1", toolName: "fetch_url", ok: true, result },
];

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("① 发起端：执行过程", () => {
  it("长结果给「在右栏打开」，并把正文与原始地址一起交出去", () => {
    const seen: unknown[] = [];
    const off = onOpenInRightPanel((doc) => seen.push(doc));
    render(<RunTracePanel runId="run-1" events={fetched(LONG)} expanded />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-event-row"));
    fireEvent.click(screen.getByTestId("run-trace-entry-open-in-panel"));
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ text: LONG, url: "https://example.com/a" });
  });

  it("短结果不给这颗按钮——一行输出搬进右栏只是多绕一步", () => {
    render(<RunTracePanel runId="run-1" events={fetched("ok")} expanded />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-event-row"));
    expect(screen.queryByTestId("run-trace-entry-open-in-panel")).toBeNull();
  });
});

describe("② 接收端：右栏", () => {
  function props(): ChatTaskInspectorProps {
    return {
      hasSelection: true, threadId: "t-1", artifacts: null, materials: null, loading: false,
      artifactsError: null, materialsError: null, onRetry: () => {}, pendingMaterialsCount: 0,
      planTodos: null, isRunning: false, runPhaseLabel: null, runStartedAt: null,
    };
  }

  it("收到就显示出来：切到产物页签 + 右栏展开，不是悄悄记下", () => {
    render(<ChatTaskInspector {...props()} />);
    // 右栏默认折叠（#2695），这里正是要验它会被展开——否则事件生效了用户也看不见。
    expect(screen.getByTestId("chat-task-workbench-inspector")).toHaveAttribute("data-collapsed", "true");
    act(() => { requestOpenInRightPanel({ id: "c1", title: "打开网页 · example.com", text: LONG, url: "https://example.com/a" }); });
    expect(screen.getByTestId("chat-task-workbench-inspector")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("chat-inspector-result-text")).toHaveTextContent("网页正文");
    expect(screen.getByTestId("chat-inspector-result-source-url")).toHaveAttribute("href", "https://example.com/a");
  });

  it("结果按原样显示，不当 markdown 解释——那是别人的字节", () => {
    render(<ChatTaskInspector {...props()} />);
    const raw = `# 这不是标题\n**这不是加粗**\n${"x".repeat(200)}`;
    act(() => { requestOpenInRightPanel({ id: "c1", title: "结果", text: raw, url: null }); });
    const pre = screen.getByTestId("chat-inspector-result-text");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain("# 这不是标题");
    expect(pre.querySelector("h1")).toBeNull();
    expect(pre.querySelector("strong")).toBeNull();
  });

  it("同一条结果重复打开只切过去，不开第二个页签", () => {
    render(<ChatTaskInspector {...props()} />);
    act(() => { requestOpenInRightPanel({ id: "c1", title: "结果一", text: LONG, url: null }); });
    act(() => { requestOpenInRightPanel({ id: "c1", title: "结果一", text: LONG, url: null }); });
    expect(screen.queryByTestId("chat-inspector-artifact-tabs")).not.toBeInTheDocument();
    act(() => { requestOpenInRightPanel({ id: "c2", title: "结果二", text: LONG, url: null }); });
    expect(screen.getAllByTestId("chat-inspector-artifact-tab")).toHaveLength(2);
  });

  /*
   * 事件的 detail 来自另一棵子树，当作数据校验。缺字段的事件被整条丢弃，
   * 而不是把 undefined 塞进页签标题、渲染出一个空白页签让用户以为右栏坏了。
   */
  it("字段不全的事件整条丢弃", () => {
    render(<ChatTaskInspector {...props()} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_IN_RIGHT_PANEL_EVENT, { detail: { id: "c9", title: "缺正文" } }));
      window.dispatchEvent(new CustomEvent(OPEN_IN_RIGHT_PANEL_EVENT, { detail: "不是对象" }));
    });
    expect(screen.queryByTestId("chat-inspector-result-text")).toBeNull();
  });
});
