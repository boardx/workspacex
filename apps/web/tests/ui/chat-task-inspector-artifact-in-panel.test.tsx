/**
 * 2026-09-23 —— 产物**在右栏里打开**，不再只能弹模态。
 *
 * 人类交办：「和 claude code 以及 codex 有巨大的差异，特别是在呈现结果的时候，
 * 模范他们应该在右边可以打开结果」。改动前点产物条目的唯一结果是
 * `onOpenArtifact` → `ChatArtifactPreviewDialog`（模态会挡住对话，没法边看边追问）。
 *
 * 这份测试钉住的是**分工**：默认进右栏详情态、模态退居「放大」。反证见文件末尾——
 * 把 `onOpen` 接回 `onOpenArtifact` 时第一条必须红。
 */
import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import type { ListThreadArtifactsOut } from "@/lib/live-chat";

/** 取源走网络，本测试只关心「摆在哪」，把视图本身替身掉。 */
const MARKDOWN = "# 报\u544a\n正文";
/**
 * 取源走网络，本测试只关心「摆在哪」与「能对它做什么」。
 * 替身必须真的回调 `onLoaded`：动作条就挂在这一口上，
 * 替身不回调的话整条动作条永远是禁用态，测不出东西来。
 */
vi.mock("@/components/chat/chat-artifact-view", () => ({
  ChatArtifactView: (p: {
    artifactId: string;
    onLoaded?: (doc: { markdown: string; version: number | null; savedAt: string } | null) => void;
  }) => {
    const loaded = p.onLoaded;
    React.useEffect(() => {
      loaded?.({ markdown: MARKDOWN, version: 2, savedAt: "2026-09-23T00:00:00.000Z" });
    }, [loaded, p.artifactId]);
    return <div data-testid="chat-artifact-preview-content">已渲染 {p.artifactId}</div>;
  },
}));
vi.mock("@/components/chat/workbench/agent-artifact-versions-panel", () => ({
  AgentArtifactVersionsPanel: () => null,
}));

const artifacts = {
  items: [{ artifactId: "a-1", title: "调研报告", kind: "markdown", createdAt: new Date().toISOString() }],
} as unknown as ListThreadArtifactsOut;

function props(overrides: Partial<ChatTaskInspectorProps> = {}): ChatTaskInspectorProps {
  return {
    hasSelection: true, threadId: "t-1", artifacts, materials: null, loading: false,
    artifactsError: null, materialsError: null, onRetry: () => {}, pendingMaterialsCount: 0,
    planTodos: null, isRunning: false, runPhaseLabel: null, runStartedAt: null, ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** 右栏默认折叠且只能手点展开（#2695），每条展开态断言都得先点。 */
function openArtifactsTab(): void {
  fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-expand"));
  fireEvent.click(screen.getByRole("tab", { name: /产物/ }));
}

it("点产物条目进右栏详情，不弹模态", () => {
  const onOpenArtifact = vi.fn();
  render(<ChatTaskInspector {...props({ onOpenArtifact })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("调研报告"));
  expect(screen.getByTestId("chat-inspector-artifact-detail")).toBeInTheDocument();
  expect(screen.getByTestId("chat-artifact-preview-content")).toHaveTextContent("a-1");
  // 反证的支点：模态入口一次都没被调用——否则这条改动等于什么都没换。
  expect(onOpenArtifact).not.toHaveBeenCalled();
});

it("详情态能返回列表", () => {
  render(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("调研报告"));
  fireEvent.click(screen.getByTestId("chat-inspector-artifact-back"));
  expect(screen.queryByTestId("chat-inspector-artifact-detail")).not.toBeInTheDocument();
  expect(screen.getByText("调研报告")).toBeInTheDocument();
});

it("「放大」才升到模态，且交的是同一个产物", () => {
  const onOpenArtifact = vi.fn();
  render(<ChatTaskInspector {...props({ onOpenArtifact })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("调研报告"));
  fireEvent.click(screen.getByTestId("chat-inspector-artifact-enlarge"));
  expect(onOpenArtifact).toHaveBeenCalledTimes(1);
  expect(onOpenArtifact.mock.calls[0]?.[0]).toMatchObject({ artifactId: "a-1" });
});

it("宿主没给模态入口时，不画一颗点了没反应的「放大」", () => {
  render(<ChatTaskInspector {...props({ onOpenArtifact: undefined })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("调研报告"));
  expect(screen.getByTestId("chat-inspector-artifact-detail")).toBeInTheDocument();
  expect(screen.queryByTestId("chat-inspector-artifact-enlarge")).not.toBeInTheDocument();
});

it("换线程后详情态清空——旧产物 id 在新线程上取不到源，会渲染成一条假故障", () => {
  const { rerender } = render(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("调研报告"));
  expect(screen.getByTestId("chat-inspector-artifact-detail")).toBeInTheDocument();
  rerender(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn(), threadId: "t-2" })} />);
  expect(screen.queryByTestId("chat-inspector-artifact-detail")).not.toBeInTheDocument();
});

it("\u52a8\u4f5c\u6761\uff1a\u590d\u5236\u5168\u6587\u62ff\u5230\u7684\u662f\u5df2\u8f7d\u5230\u7684\u90a3\u4e00\u4efd", async () => {
  const writeText = vi.fn<(t: string) => Promise<void>>(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("\u8c03\u7814\u62a5\u544a"));
  fireEvent.click(screen.getByTestId("chat-inspector-artifact-copy"));
  expect(writeText).toHaveBeenCalledWith(MARKDOWN);
  await screen.findByLabelText("\u5df2\u590d\u5236");
});

it("\u4e0b\u8f7d\uff1a\u6587\u4ef6\u540d\u7531\u6807\u9898\u6765\uff0c\u5185\u5bb9\u662f\u5df2\u8f7d\u5230\u7684\u90a3\u4e00\u4efd", () => {
  const created: Blob[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: (b: Blob) => { created.push(b); return "blob:x"; },
    revokeObjectURL: () => {},
  });
  // \u53cd\u8bc1\u65f6\u53d1\u73b0\u7684\u5f31\u65ad\u8a00\uff1a\u53ea\u6570 click \u6b21\u6570\u7684\u8bdd\uff0c\u628a a.download \u6539\u6210 "x" \u4e5f\u4e0d\u4f1a\u7ea2\u3002
  // \u6587\u4ef6\u540d\u6b63\u662f\u8fd9\u6761\u8def\u5f84\u4e0a\u552f\u4e00\u53ef\u5728 jsdom \u91cc\u53d6\u8bc1\u7684\u4e1c\u897f\uff0c\u5fc5\u987b\u6253\u5728\u5b83\u4e0a\u9762\u3002
  const names: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  render(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("\u8c03\u7814\u62a5\u544a"));
  fireEvent.click(screen.getByTestId("chat-inspector-artifact-download"));
  expect(created).toHaveLength(1);
  expect(created[0]?.type).toBe("text/markdown;charset=utf-8");
  expect(click).toHaveBeenCalledTimes(1);
  expect(names).toEqual(["\u8c03\u7814\u62a5\u544a.md"]);
  click.mockRestore();
});
