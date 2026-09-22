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
vi.mock("@/components/chat/chat-artifact-view", () => ({
  ChatArtifactView: (p: { artifactId: string }) => (
    <div data-testid="chat-artifact-preview-content">已渲染 {p.artifactId}</div>
  ),
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
