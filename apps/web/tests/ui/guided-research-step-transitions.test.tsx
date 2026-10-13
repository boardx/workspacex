import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { getResearchRuntime, getResearchRuntimeProgress, executeResearchRuntime, type GuidedResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";

vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), getResearchRuntimeProgress: vi.fn(), executeResearchRuntime: vi.fn() }));
afterEach(() => vi.useRealTimers());
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState({}, "", "/research/grs-live/import"); });

describe("step-aligned research transitions", () => {
  it("browses the plan during research and preserves the selected page after completion", async () => {
    const state = runtimeFixture("research");
    let finish!: (value: typeof state) => void;
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new Error("progress unavailable"));
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
    await screen.findByTestId("research-execution-timeline");
    const researchLink = within(screen.getByRole("navigation",{name:"研究步骤"})).getByRole("button", { name: /生成报告/ });
    expect(researchLink).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: /研究计划/ }));
    await screen.findByTestId("guided-research-plan-panel");
    expect(window.location.pathname).toBe("/research/grs-live/plan");
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("navigation",{name:"研究步骤"})).getByRole("button", { name: /生成报告/ }));
    await screen.findByTestId("research-execution-timeline");
    expect(screen.queryByTestId("guided-research-plan-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /研究计划/ }));
    await screen.findByTestId("guided-research-plan-panel");
    await act(async () => finish({ ...state, version: 5 }));
    expect(screen.getByTestId("guided-research-plan-panel")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research/grs-live/plan");
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("navigation",{name:"研究步骤"})).getByRole("button", { name: /生成报告/ })).not.toHaveAttribute("aria-busy", "true");
  });

  it("keeps historical browsing selected when a restored task finishes through polling", async () => {
    const state = { ...runtimeFixture("research"), busy: true, leaseUntil: "2099-01-01T00:00:00Z" };
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    await screen.findByTestId("research-step-loading");
    fireEvent.click(screen.getByRole("button", { name: /研究计划/ }));
    await screen.findByTestId("guided-research-plan-panel");
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...state, busy: false, leaseUntil: null });
    vi.mocked(getResearchRuntimeProgress).mockResolvedValue({ ...state, busy: false, leaseUntil: null, stream: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByTestId("guided-research-plan-panel")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research/grs-live/plan");
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });

  it("preserves browsing and retains the submitted draft when an assistant command fails", async () => {
    const state = runtimeFixture("research");
    let finish!: (value: typeof state) => void;
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "AI 助手" }));
    fireEvent.change(screen.getByLabelText("研究对话"), { target: { value: "更新检索内容" } });
    fireEvent.click(screen.getByRole("button", { name: "发送研究消息" }));
    fireEvent.click(screen.getByRole("button", { name: /研究计划/ }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }));
    await screen.findByTestId("guided-research-plan-panel");
    await act(async () => finish({ ...state, version: 5, errorCode: "RESEARCH_SEARCH_UNAVAILABLE" }));
    expect(screen.getByTestId("guided-research-plan-panel")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research/grs-live/plan");
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("待应用内容已保留");
  });

  it("marks the browsed command step busy when messaging an earlier step", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("research"));
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /研究计划/ }));
    await screen.findByTestId("guided-research-plan-panel");
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.change(screen.getByLabelText("研究对话"), { target: { value: "检查计划" } });
    fireEvent.click(screen.getByRole("button", { name: "发送研究消息" }));
    expect(screen.getByRole("button", { name: /研究计划/ })).toHaveAttribute("aria-busy", "true");
    expect(within(screen.getByRole("navigation", { name: "研究步骤" })).getByRole("button", { name: /生成报告/ })).not.toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("研究对话")).toBeInTheDocument();
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
  });

  it("marks a generated report complete without falsely completing failed research", async () => {
    const state = { ...runtimeFixture("report"), completed: true };
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    const view = render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    await screen.findByTestId("research-report");
    expect(within(screen.getByRole("navigation",{name:"研究步骤"})).getByRole("button", { name: /生成报告/ }).querySelector(".lucide-check")).not.toBeNull();
    view.unmount();
    const failed = runtimeFixture("research");
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...failed, tasks: failed.tasks.map((task) => ({ ...task, status: "failed", errorCode: "RESEARCH_SEARCH_UNAVAILABLE" })) });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    await screen.findByTestId("guided-research-source-workspace");
    expect(within(screen.getByRole("navigation",{name:"研究步骤"})).getByRole("button", { name: /生成报告/ }).querySelector(".lucide-check")).toBeNull();
  });

  it.each([
    ["brief", "确认并继续", "plan", "正在生成研究计划"],
    ["directions", "生成研究计划", "plan", "正在生成研究计划"],
    ["outline", "生成报告", "report", "正在获取资料"],
  ] as const)("moves %s to its destination before generation finishes", async (node, action, stage, loading) => {
    vi.mocked(getResearchRuntime).mockResolvedValue(node === "outline" ? {...runtimeFixture(node),tasks:[],sources:[]} : runtimeFixture(node));
    let emit: Parameters<typeof executeResearchRuntime>[1];
    vi.mocked(executeResearchRuntime).mockImplementation((_input, callback) => {emit=callback;return new Promise(() => undefined);});
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: action }));
    if (node === "outline") {
      const destination = within(screen.getByRole("navigation", {name:"研究步骤"})).getByRole("button", {name:/生成报告/});
      expect(destination).toHaveAttribute("aria-current", "step");
      expect(destination).toHaveAttribute("aria-busy", "true");
      expect(screen.getByTestId("execution-search")).toHaveTextContent("待执行");
      expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
      const researching = runtimeFixture("research");
      await act(async()=>emit!({type:"snapshot",state:{...researching,version:5,busy:true,leaseUntil:"2099-01-01T00:00:00Z",executionGoal:"report",progress:{stage:"searching",executionVersion:5,completed:0,total:researching.tasks.length},tasks:researching.tasks.map(task=>({...task,status:"running" as const})),sources:[]}}));
      expect(screen.getByTestId("research-step-loading")).toHaveTextContent(loading);
      expect(screen.getByTestId("execution-search")).toHaveTextContent("执行中");
    } else expect(await screen.findByTestId("research-step-loading")).toHaveTextContent(loading);
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.location.pathname).toBe(`/research/grs-live/${stage}`));
    expect(screen.queryByTestId("research-runtime-progress")).not.toBeInTheDocument();
    if (stage === "report") expect(screen.queryByTestId("guided-research-plan-panel")).not.toBeInTheDocument();
  });

  it("returns to the pending plan before its outline becomes available", async () => {
    const state = { ...runtimeFixture("brief"), generatedNodes: [] };
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    await screen.findByTestId("research-step-loading");
    fireEvent.click(screen.getByRole("button", { name: /确认研究内容/ }));
    await screen.findByRole("textbox", { name: "研究需求" });
    fireEvent.click(screen.getByRole("button", { name: /研究计划/ }));
    expect(await screen.findByTestId("research-step-loading")).toHaveTextContent("正在生成研究计划");
    expect(window.location.pathname).toBe("/research/grs-live/plan");
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });

  it("follows the server-owned destination on refresh rather than an older import URL", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...runtimeFixture("outline"), busy: true, leaseUntil: "2099-01-01T00:00:00Z" });
    render(<GuidedResearchLive sessionId="grs-live" initialNode="brief" visualStage="import" onBack={vi.fn()} />);
    expect(await screen.findByTestId("research-step-loading")).toHaveTextContent("正在生成研究计划");
    expect(window.location.pathname).toBe("/research/grs-live/plan");
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });

  it("keeps history out of other steps and available beside the current report", async () => {
    const state = runtimeFixture("report");
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...state,
      progress: { stage: "searching", completed: 1, total: 2 },
      reportPrevious: { title: "旧报告", createdAt: "2026-09-08", report: state.report, text: "", chapters: [], sources: state.sources, outline: state.outline, aliases: [] },
    });
    const view = render(<GuidedResearchLive sessionId="grs-live" initialNode="brief" onBack={vi.fn()} />);
    await screen.findByRole("textbox", { name: "研究需求" });
    expect(screen.queryByTestId("research-runtime-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-report-history")).not.toBeInTheDocument();
    view.unmount();
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    await screen.findByTestId("research-report");
    expect(screen.getByTestId("research-report-history")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "研究报告" })).not.toBeInTheDocument();
    expect(screen.getByTestId("research-report-document").compareDocumentPosition(screen.getByTestId("research-report-actions")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("starts one combined report command instead of requiring intermediate source confirmations", async () => {
    const state = runtimeFixture("research");
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...runtimeFixture("report"), version: 5 });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("research-report-primary-action"));
    await screen.findByTestId("research-report");
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeResearchRuntime).mock.calls[0]?.[0]).toMatchObject({node:"research",action:"generate_report",expectedVersion:4});
    expect(window.location.pathname).toBe("/research/grs-live/report");
  });

  it("restores a historical chapter URL to report execution without unlocking or replaying work", async () => {
    const state = runtimeFixture("research");
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    render(<GuidedResearchLive sessionId="grs-live" initialNode="report" visualStage="chapters" onBack={vi.fn()} />);
    await screen.findByTestId("research-execution-timeline");
    act(() => { window.history.pushState({}, "", "/research/grs-live/chapters"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(await screen.findByTestId("research-execution-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("research-source-description-source1")).toHaveAttribute("href",state.sources[0]!.url);
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });

  it("keeps edited chapters selected and retrieved evidence available after saving", async () => {
    const state = runtimeFixture("research");
    const outline = state.outline.map((section) => ({ ...section, title: "新的政策章节" }));
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...state, version: 5, outline });
    render(<GuidedResearchLive sessionId="grs-live" initialNode="report" visualStage="chapters" onBack={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "章节标题" }), { target: { value: "新的政策章节" } });
    fireEvent.click(screen.getByRole("button", { name: "保存章节结构" }));
    await waitFor(() => expect(vi.mocked(executeResearchRuntime).mock.calls.map(([input]) => input)).toContainEqual(expect.objectContaining({
      node: "outline", action: "save_chapters", draft: { node: "outline", value: outline },
    })));
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存章节结构" })).not.toBeInTheDocument());
    expect(screen.getByTestId("research-chapters-workspace")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research/grs-live/report");
    expect(screen.queryByTestId("guided-research-plan-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "章节标题" })).toHaveValue("新的政策章节");
    fireEvent.click(within(screen.getByRole("navigation",{name:"研究步骤"})).getByRole("button", { name: /生成报告/ }));
    expect(await screen.findByTestId("guided-research-source-workspace")).toHaveTextContent("Official policy");
    expect(window.location.pathname).toBe("/research/grs-live/report");
  });
});

describe("persisted topic confirmation while the plan generates", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new Error("offline")); });
  const topic = () => within(screen.getByTestId("research-flow-progress")).getByRole("button", { name: /确认研究内容/ });
  const plan = () => within(screen.getByTestId("research-flow-progress")).getByRole("button", { name: /研究计划/ });
  const runningPlan = (): GuidedResearchRuntime => ({ ...runtimeFixture("outline"), version: 5, revision: 2, busy: true, leaseUntil: "2099-01-01T00:00:00Z", generatedNodes: ["brief", "directions"] });
  it("marks the topic completed from an already persisted outline/busy snapshot", async () => {
    const state = { ...runningPlan(), generatedNodes: ["brief", "directions"] as ("brief" | "directions")[] };
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    await act(async () => {});
    expect(topic()).toHaveTextContent("已完成");
    expect(topic()).not.toHaveAttribute("aria-busy", "true");
    expect(plan()).toHaveAttribute("aria-busy", "true");
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  async function start() {
    const state = {...runtimeFixture("brief"),generatedNodes:[] as GuidedResearchRuntime["generatedNodes"]};
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    let emit: Parameters<typeof executeResearchRuntime>[1]; let signal: AbortSignal | undefined;
    let fail!: (error: unknown) => void;
    vi.mocked(executeResearchRuntime).mockImplementation((_input, callback, controller) => { emit = callback; signal = controller; return new Promise((_resolve, reject) => { fail = reject; controller?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); }); });
    const view = render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await act(async () => {});
    return { state, view, emit: () => emit, signal: () => signal, fail: (error: unknown) => fail(error) };
  }
  it("does not mark click as confirmation and immediately follows the persisted streamed outline authority", async () => {
    const operation = await start();
    expect(topic()).not.toHaveTextContent("已完成");
    expect(operation.emit()).toEqual(expect.any(Function));
    expect(operation.signal()).toBeInstanceOf(AbortSignal);
    await act(async () => operation.emit()!({ type: "snapshot", state: { ...operation.state, version: 5, busy: true, leaseUntil: "2099-01-01T00:00:00Z" } }));
    expect(topic()).not.toHaveTextContent("已完成");
    await act(async () => operation.emit()!({ type: "snapshot", state: { ...runningPlan(), generatedNodes: ["brief", "directions"] } }));
    expect(topic()).toHaveTextContent("已完成");
    expect(plan()).toHaveAttribute("aria-busy", "true");
    expect(getResearchRuntimeProgress).not.toHaveBeenCalled();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("streams an explicitly adopted confirm proposal, while an unadopted proposal never completes the topic", async () => {
    const state = {...runtimeFixture("directions"),generatedNodes:[] as GuidedResearchRuntime["generatedNodes"]};
    state.proposal = { id: "confirm-topic", version: state.version, draft: { node: "directions", value: state.directions }, action: "confirm" };
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    let emit: Parameters<typeof executeResearchRuntime>[1];
    vi.mocked(executeResearchRuntime).mockImplementation((_input, callback, signal) => { emit = callback; return new Promise((_resolve, reject) => { signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); }); });
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    await act(async () => {});
    expect(topic()).not.toHaveTextContent("已完成");
    expect(executeResearchRuntime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.click(screen.getByRole("button", { name: "批准确认并继续" }));
    expect(emit).toEqual(expect.any(Function));
    expect(vi.mocked(executeResearchRuntime).mock.calls[0]![0]).toMatchObject({ action: "apply", node: "directions" });
    await act(async () => emit!({ type: "snapshot", state: runningPlan() }));
    expect(topic()).toHaveTextContent("已完成");
    expect(plan()).toHaveAttribute("aria-busy", "true");
  });
  it.each([false, true])("preserves the persisted confirmation boundary when generation fails (confirmed=%s)", async confirmed => {
    const operation = await start();
    expect(operation.emit()).toEqual(expect.any(Function));
    if (confirmed) await act(async () => operation.emit()!({ type: "snapshot", state: runningPlan() }));
    const terminal = { ...(confirmed ? runningPlan() : operation.state), version: 5, revision: 3, busy: false, leaseUntil: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE" };
    vi.mocked(getResearchRuntime).mockResolvedValue(terminal);
    await act(async () => operation.fail(new ApiError(409, "RESEARCH_WORKFLOW_UNAVAILABLE", null)));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    if (confirmed) expect(topic()).toHaveTextContent("已完成");
    else expect(topic()).not.toHaveTextContent("已完成");
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(getResearchRuntime).toHaveBeenCalledTimes(2);
  });
  it("ignores wrong-session and old-version snapshots before confirmation authority", async () => {
    const operation = await start();
    expect(operation.emit()).toEqual(expect.any(Function));
    await act(async () => operation.emit()!({ type: "snapshot", state: { ...runningPlan(), sessionId: "another" } }));
    await act(async () => operation.emit()!({ type: "snapshot", state: { ...runningPlan(), version: operation.state.version } }));
    expect(topic()).not.toHaveTextContent("已完成");
    await act(async () => operation.emit()!({ type: "snapshot", state: runningPlan() }));
    expect(topic()).toHaveTextContent("已完成");
  });
  it("ignores older confirmation snapshots after outline authority was persisted", async () => {
    const operation = await start();
    expect(operation.emit()).toEqual(expect.any(Function));
    await act(async () => operation.emit()!({ type: "snapshot", state: { ...runningPlan(), generatedNodes: ["brief", "directions"] } }));
    await act(async () => operation.emit()!({ type: "snapshot", state: { ...operation.state, version: 5, revision: 1, busy: true, leaseUntil: "2099-01-01T00:00:00Z" } }));
    expect(topic()).toHaveTextContent("已完成");
    expect(plan()).toHaveAttribute("aria-busy", "true");
  });
  it("cancels the stream on session switch and ignores the abandoned confirmation snapshot", async () => {
    const operation = await start();
    expect(operation.signal()).toBeInstanceOf(AbortSignal);
    vi.mocked(getResearchRuntime).mockResolvedValue({...runtimeFixture("brief", "another"),generatedNodes:[]});
    await act(async () => operation.view.rerender(<GuidedResearchLive sessionId="another" onBack={vi.fn()} />));
    expect(operation.signal()!.aborted).toBe(true);
    await act(async () => operation.emit()!({ type: "snapshot", state: { ...runningPlan(), generatedNodes: ["brief", "directions"] } }));
    expect(topic()).not.toHaveTextContent("已完成");
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
});
