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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  items: [
    { artifactId: "a-1", title: "调研报告", kind: "markdown", createdAt: new Date().toISOString() },
    { artifactId: "a-2", title: "财务测算", kind: "markdown", createdAt: new Date().toISOString() },
  ],
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

/**
 * R5 —— 同时开着几份，在它们之间切。
 *
 * R2 之后「看完 A 再看 B」要返回列表、在列表里重新找 B；来回切两三次就是六到八次点击。
 * 这里钉的是**接线**（页签条在不在、切换有没有真换内容）；判据本身（满了淘汰谁、
 * 关掉当前那份落到哪）在 tests/lib/artifact-tabs.test.ts。
 */
function openBoth(): void {
  openArtifactsTab();
  fireEvent.click(screen.getByText("调研报告"));
  fireEvent.click(screen.getByTestId("chat-inspector-artifact-back"));
  fireEvent.click(screen.getByText("财务测算"));
}

it("只开着一份时不画页签条（那只是重复一遍上面的标题）", () => {
  render(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("调研报告"));
  expect(screen.queryByTestId("chat-inspector-artifact-tabs")).not.toBeInTheDocument();
});

it("开着两份时出页签条，一次点击就能切回另一份（不经过列表）", () => {
  render(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />);
  openBoth();
  const strip = screen.getByTestId("chat-inspector-artifact-tabs");
  expect(screen.getByTestId("chat-artifact-preview-content")).toHaveTextContent("a-2");
  fireEvent.click(within(strip).getByText("调研报告"));
  expect(screen.getByTestId("chat-artifact-preview-content")).toHaveTextContent("a-1");
});

it("关掉不是当前的那一份，当前这份不会被静默切走", () => {
  render(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />);
  openBoth();
  const strip = screen.getByTestId("chat-inspector-artifact-tabs");
  fireEvent.click(within(strip).getByLabelText("关闭 调研报告"));
  expect(screen.getByTestId("chat-artifact-preview-content")).toHaveTextContent("a-2");
  // 只剩一份，页签条随之收起。
  expect(screen.queryByTestId("chat-inspector-artifact-tabs")).not.toBeInTheDocument();
});

it("返回列表后详情态整个关掉", () => {
  render(<ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />);
  openArtifactsTab();
  fireEvent.click(screen.getByText("调研报告"));
  fireEvent.click(screen.getByTestId("chat-inspector-artifact-back"));
  expect(screen.queryByTestId("chat-inspector-artifact-detail")).not.toBeInTheDocument();
});

/**
 * 并行会话 2026-09-23 实测教训：RTL 默认不套 StrictMode，effect 只跑一遍，
 * 「更新函数里带副作用 / 挂载读一次」这类形状在 jsdom 里全绿、真实浏览器里是坏的。
 * 页签这套状态有两个 setState 互相牵动（开着的份数 → 列表态），显式跑一遍双调用。
 */
it("StrictMode 下开两份、切换、关闭，结果与单跑一致", () => {
  render(
    <React.StrictMode>
      <ChatTaskInspector {...props({ onOpenArtifact: vi.fn() })} />
    </React.StrictMode>,
  );
  openBoth();
  const strip = screen.getByTestId("chat-inspector-artifact-tabs");
  expect(screen.getByTestId("chat-artifact-preview-content")).toHaveTextContent("a-2");
  fireEvent.click(within(strip).getByText("调研报告"));
  expect(screen.getByTestId("chat-artifact-preview-content")).toHaveTextContent("a-1");
  fireEvent.click(within(strip).getByLabelText("关闭 财务测算"));
  expect(screen.getByTestId("chat-artifact-preview-content")).toHaveTextContent("a-1");
  // 只剩一份，页签条收起；「返回」把列表铺回来，但那一份仍然开着。
  expect(screen.queryByTestId("chat-inspector-artifact-tabs")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("chat-inspector-artifact-back"));
  expect(screen.queryByTestId("chat-inspector-artifact-detail")).not.toBeInTheDocument();
});
