import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { getResearchRuntime, executeResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";

vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState({}, "", "/research/grs-live/import"); });

describe("step-aligned research transitions", () => {
  it.each([
    ["brief", "确认并继续", "topic", "正在解析研究主题"],
    ["directions", "下一步：研究计划", "plan", "正在生成研究计划"],
    ["outline", "开始研究", "research", "正在获取资料"],
  ] as const)("moves %s to its destination before generation finishes", async (node, action, stage, loading) => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture(node));
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: action }));
    expect(await screen.findByTestId("research-step-loading")).toHaveTextContent(loading);
    await waitFor(() => expect(window.location.pathname).toBe(`/research/grs-live/${stage}`));
    expect(screen.queryByTestId("research-runtime-progress")).not.toBeInTheDocument();
  });

  it("follows the server-owned destination on refresh rather than an older import URL", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...runtimeFixture("outline"), busy: true, leaseUntil: "2099-01-01T00:00:00Z" });
    render(<GuidedResearchLive sessionId="grs-live" initialNode="brief" visualStage="import" onBack={vi.fn()} />);
    expect(await screen.findByTestId("research-step-loading")).toHaveTextContent("正在生成研究计划");
    expect(window.location.pathname).toBe("/research/grs-live/plan");
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });

  it("keeps cross-step task progress and historical report presentation out of the current page", async () => {
    const state = runtimeFixture("report");
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...state,
      progress: { stage: "searching", completed: 1, total: 2 },
      reportPrevious: { title: "旧报告", createdAt: "2026-09-08", report: state.report, text: "", chapters: [], sources: state.sources, outline: state.outline, aliases: [] },
    });
    const view = render(<GuidedResearchLive sessionId="grs-live" initialNode="brief" onBack={vi.fn()} />);
    await screen.findByRole("textbox", { name: "研究需求" });
    expect(screen.queryByTestId("research-runtime-progress")).not.toBeInTheDocument();
    view.unmount();
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    await screen.findByTestId("research-report");
    expect(screen.queryByTestId("research-report-history")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "研究报告" })).not.toBeInTheDocument();
    expect(screen.getByTestId("research-report-document").compareDocumentPosition(screen.getByTestId("research-report-actions")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens editable chapters after source confirmation and generates only after chapter confirmation", async () => {
    const state = runtimeFixture("research");
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockResolvedValueOnce({ ...state, version: 5 }).mockImplementationOnce(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    await screen.findByTestId("research-chapters-workspace");
    expect(window.location.pathname).toBe("/research/grs-live/chapters");
    expect(screen.queryByRole("textbox", { name: "研究对话" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步：生成报告" }));
    expect(await screen.findByTestId("research-step-loading")).toHaveTextContent("正在生成研究报告");
    expect(window.location.pathname).toBe("/research/grs-live/report");
  });

  it("restores the chapter route before the backend report node is unlocked", async () => {
    const state = runtimeFixture("research");
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    render(<GuidedResearchLive sessionId="grs-live" initialNode="report" visualStage="chapters" onBack={vi.fn()} />);
    await screen.findByTestId("research-chapters-workspace");
    fireEvent.click(screen.getByRole("button", { name: /^上一步$/ }));
    await screen.findByRole("list", { name: "已获取的研究资料" });
    act(() => { window.history.pushState({}, "", "/research/grs-live/chapters"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(await screen.findByTestId("research-chapters-workspace")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research/grs-live/chapters");
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });

  it("aligns the route with the plan when saving chapter edits invalidates downstream research", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("research"));
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...runtimeFixture("outline"), version: 5 });
    render(<GuidedResearchLive sessionId="grs-live" initialNode="report" visualStage="chapters" onBack={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "章节标题" }), { target: { value: "新的政策章节" } });
    fireEvent.click(screen.getByRole("button", { name: "保存章节结构" }));
    await screen.findByTestId("guided-research-plan-panel");
    expect(window.location.pathname).toBe("/research/grs-live/plan");
    expect(screen.queryByTestId("research-chapters-workspace")).not.toBeInTheDocument();
  });
});
