import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";
import { getResearchRuntime, executeResearchRuntime, listGuidedResearchSessions } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", async (original) => ({
  ...await original<typeof import("@/lib/guided-research-api")>(),
  getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn(), listGuidedResearchSessions: vi.fn(),
}));
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); vi.mocked(listGuidedResearchSessions).mockResolvedValue({ items: [] }); });
// Replaces the retired browser-demo journey: session URLs now use server runtime commands.
describe("guided research session routing and lifecycle", () => {
  it("preserves an unsent assistant message when leaving is cancelled", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("report"));
    render(<GuidedResearchFlow step="report" sessionId="grs-live" />);
    await screen.findByTestId("guided-research-report-workspace");
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.change(screen.getByRole("textbox", { name: "研究对话" }), { target: { value: "尚未发送的研究问题" } });
    fireEvent.click(screen.getByRole("button", { name: "返回研究列表" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("textbox", { name: "研究对话" })).toHaveValue("尚未发送的研究问题");
  });
  it("guards browser history navigation while an assistant message is unsent", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("report"));
    window.history.replaceState({}, "", "/research/grs-live/report");
    render(<GuidedResearchFlow step="report" sessionId="grs-live" />);
    await screen.findByTestId("guided-research-report-workspace");
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.change(screen.getByRole("textbox", { name: "研究对话" }), { target: { value: "尚未发送的研究问题" } });
    window.history.replaceState({}, "", "/research/grs-live/plan");
    fireEvent.popState(window);
    expect(screen.getByRole("dialog", { name: "研究内容尚未保存" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research/grs-live/report");
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("textbox", { name: "研究对话" })).toHaveValue("尚未发送的研究问题");
    expect(screen.getByTestId("guided-research-report-workspace")).toBeInTheDocument();
    window.history.replaceState({}, "", "/research/grs-live/plan");
    fireEvent.popState(window);
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }));
    await screen.findByTestId("guided-research-plan-panel");
    expect(window.location.pathname).toBe("/research/grs-live/plan");
  });
  it("opens the report rather than retaining chapters after returning to the list", async () => {
    const runtime = runtimeFixture("report");
    vi.mocked(getResearchRuntime).mockResolvedValue(runtime);
    vi.mocked(listGuidedResearchSessions).mockResolvedValue({ items: [{
      sessionId: "grs-live", title: "储能研究", tags: [], brief: runtime.brief,
      briefVersion: 1, briefConfirmedAt: null,
      directions: { candidateVersion: null, confirmedVersion: null, versions: [] },
      outline: { candidateVersion: null, confirmedVersion: null, versions: [] },
      stage: "report", resumeStage: "report", status: "completed", progress: 100,
      sourceCount: 1, reportId: null, createdAt: "2026-09-27", updatedAt: "2026-09-27",
    }] });
    render(<GuidedResearchFlow step="report" sessionId="grs-live" visualStage="chapters" />);
    await screen.findByTestId("research-chapters-workspace");
    fireEvent.click(screen.getByRole("button", { name: "返回研究列表" }));
    fireEvent.click(await screen.findByTestId("research-view-grs-live"));
    await screen.findByTestId("guided-research-report-workspace");
    expect(screen.queryByTestId("research-chapters-workspace")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/research/grs-live/report");
  });
  it.each(["directions", "outline", "search", "report"] as const)("keeps sessionless %s requests on the home screen", async (step) => {
    render(<GuidedResearchFlow step={step} />);
    expect(screen.getByTestId("research-flow-home")).toBeInTheDocument();
    expect(getResearchRuntime).not.toHaveBeenCalled();
  });
  it("waits for recovery before exposing future nodes, then clamps to the server maximum", async () => {
    let resolve!: (value: ReturnType<typeof runtimeFixture>) => void;
    vi.mocked(getResearchRuntime).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<GuidedResearchFlow step="report" sessionId="grs-live" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在恢复");
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
    resolve(runtimeFixture("directions"));
    expect(await screen.findByDisplayValue("政策方向")).toBeInTheDocument();
    expect(screen.getByTestId("research-step-report")).toHaveAttribute("aria-disabled", "true");
  });
  it("hides a previous session immediately when the replacement is loading or unavailable", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(runtimeFixture("brief"));
    const view = render(<GuidedResearchFlow step="brief" sessionId="grs-live" />);
    await screen.findByDisplayValue("储能研究");
    vi.mocked(getResearchRuntime).mockRejectedValueOnce(new Error("not found"));
    view.rerender(<GuidedResearchFlow step="brief" sessionId="unavailable" />);
    expect(screen.queryByDisplayValue("储能研究")).not.toBeInTheDocument();
    expect(await screen.findByText("暂时无法连接研究服务，请检查网络后重试。")).toBeInTheDocument();
  });
  it("supports historical nodes and switches in place without document navigation", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("report"));
    const navigate = vi.fn();
    render(<GuidedResearchFlow step="brief" sessionId="grs-live" onStepChange={navigate} />);
    await screen.findByDisplayValue("储能研究");
    expect(screen.getByText(/后续研究结果失效/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /确认研究主题/ }));
    expect(screen.getByDisplayValue("政策方向")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research/grs-live/topic");
    expect(navigate).not.toHaveBeenCalled();
  });
  it("saves human edits with the correct version and retracts downstream progress", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("report"));
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...runtimeFixture("brief"), version: 5, revision: 2 });
    render(<GuidedResearchFlow step="brief" sessionId="grs-live" />);
    fireEvent.change(await screen.findByDisplayValue("储能研究"), { target: { value: "新的政策研究" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "grs-live", node: "brief", action: "save", expectedVersion: 4, draft: { node: "brief", value: expect.objectContaining({ topic: "新的政策研究" }) } })));
    await waitFor(() => expect(screen.getByTestId("research-step-report")).toHaveAttribute("aria-disabled", "true"));
  });
  it.each(["directions", "outline"] as const)("keeps generated %s editable before confirmation", async (node) => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture(node));
    render(<GuidedResearchFlow step={node} sessionId="grs-live" />);
    const field = await screen.findByDisplayValue(node === "directions" ? "政策方向" : "政策章节");
    fireEvent.change(field, { target: { value: "人工修订" } });
    expect(screen.getByDisplayValue("人工修订")).toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("retains the current node on a failed confirmation and displays the saved error", async () => {
    const state = runtimeFixture("research");
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...state, version: 5, errorCode: "RESEARCH_TASKS_INCOMPLETE" });
    render(<GuidedResearchFlow step="search" sessionId="grs-live" />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("完成检索任务");
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
  });
  it("shows persisted search failures and retries failed work through the server", async () => {
    const state = runtimeFixture("research"); state.tasks[0]!.status = "failed";
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...runtimeFixture("research"), version: 5 });
    render(<GuidedResearchFlow step="search" sessionId="grs-live" />);
    fireEvent.click(await screen.findByRole("button", { name: "重试失败任务" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "retry", node: "research", expectedVersion: 4 })));
    expect(await screen.findByText("已完成 · 尝试 1 次")).toBeInTheDocument();
  });
  it("renders report content and links from persisted sources, then explicitly completes", async () => {
    const state = runtimeFixture("report");
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...state, version: 5, completed: true });
    render(<GuidedResearchFlow step="report" sessionId="grs-live" />);
    expect((await screen.findAllByText("有来源支持的结论")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Official policy" })).toHaveAttribute("href", "https://example.org/policy");
    fireEvent.click(screen.getByRole("button", { name: "完成研究" }));
    expect(await screen.findByText("研究报告 · 质量待评估")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "complete", node: "report" }));
  });
  it("does not fabricate a report or citations when generation failed", async () => {
    const state = runtimeFixture("report"); state.report = null; state.errorCode = "RESEARCH_CONTENT_REFERENCE_INVALID";
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    render(<GuidedResearchFlow step="report" sessionId="grs-live" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("不可用的来源");
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成研究" })).not.toBeInTheDocument();
  });
  it("blocks edits and duplicate generation while a persisted operation is running", async () => {
    const state = runtimeFixture("brief"); state.busy = true; state.leaseUntil = new Date(Date.now()+60000).toISOString();
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    render(<GuidedResearchFlow step="brief" sessionId="grs-live" />);
    expect(await screen.findByTestId("research-step-loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用模型生成" })).not.toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("returns to the sessionless home from a persisted report", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("report"));
    const navigate = vi.fn();
    render(<GuidedResearchFlow step="report" sessionId="grs-live" onStepChange={navigate} />);
    await screen.findByTestId("research-report");
    fireEvent.click(screen.getByRole("button", { name: "返回研究列表" }));
    expect(navigate).toHaveBeenCalledWith("home", undefined);
  });
});
