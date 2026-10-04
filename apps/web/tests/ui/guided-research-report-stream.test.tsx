import * as React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime, getResearchRuntimeProgress, type GuidedResearchRuntime as Runtime } from "@/lib/guided-research-api";
vi.mock("@/lib/guided-research-api", async (original) => ({ ...await original<typeof import("@/lib/guided-research-api")>(), getResearchRuntime: vi.fn(), getResearchRuntimeProgress: vi.fn(), executeResearchRuntime: vi.fn() }));
const initial: Runtime = {
  sessionId: "session-stream", version: 7, revision: 1, currentNode: "research", availableNodes: ["brief", "directions", "outline", "research"],
  brief: { topic: "Storage", goal: "Entry strategy", timeRange: "2026", region: "Europe", focus: "Grid" },
  directions: [], outline: [{ id: "s1", title: "政策", questions: ["政策？"], enabled: true, order: 0 }],
  tasks: [{ id: "t1", sectionId: "s1", query: "policy", status: "succeeded", attempts: 1, errorCode: null }],
  sources: [{ id: "src1", taskId: "t1", title: "Official source", url: "https://example.org/policy", content: "Retrieved source", retrievedAt: "2026-09-05", decision: "accepted" }],
  report: null, completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [],
};
function progressOf(state: Runtime) {
  return { sessionId: state.sessionId, version: state.version, revision: state.revision, currentNode: state.currentNode, availableNodes: state.availableNodes, busy: state.busy, leaseUntil: state.leaseUntil, errorCode: state.errorCode, completed: state.completed,
    reportTimeline: state.reportTimeline,
    stream: state.reportStream ? { ...state.reportStream, offset: 0, delta: state.reportStream.text } : null };
}
const streaming = (requestId = "request"): Runtime => ({ ...initial, version: 8, currentNode: "report", availableNodes: [...initial.availableNodes, "report"], busy: true, leaseUntil: "2099-01-01T00:00:00.000Z", reportStream: { requestId, sequence: 0, text: "", status: "streaming" } });
const idleReport: Runtime = { ...initial, currentNode: "report", availableNodes: [...initial.availableNodes, "report"] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getResearchRuntime).mockResolvedValue(idleReport); });
afterEach(() => vi.useRealTimers());
describe("research report stream UI", () => {
  it("renders the live report area above the generation timeline before text arrives", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...streaming(), reportTimeline: [{ id: "evidence", stage: "evidence", status: "running", attempts: 1 }] });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    const previewStatus = await screen.findByText("正在组织报告内容，正文返回后将实时显示。");
    const timeline = screen.getByTestId("research-report-timeline");
    expect(previewStatus.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("hides the generation timeline once the completed report is being read", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({
      ...streaming(), busy: false, leaseUntil: null,
      report: { title: "正式报告", summary: "最终摘要", sections: [] },
      reportStream: null,
      reportTimeline: [{ id: "evidence", stage: "evidence", status: "completed", attempts: 1 }],
    });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByTestId("research-report-document")).toHaveTextContent("正式报告");
    expect(screen.queryByTestId("research-report-timeline")).not.toBeInTheDocument();
  });
  it("shows actual model text before completion and ignores wrong request and duplicate deltas", async () => {
    vi.mocked(executeResearchRuntime).mockImplementation(async (input, callback) => {
      callback!({ type: "snapshot", state: streaming(input.requestId) });
      const delta = { type: "report_delta" as const, sessionId: input.sessionId, requestId: input.requestId, version: 8, sequence: 1, delta: '{"title":"实时报告","summary":"已到达正文' };
      callback!({ ...delta, requestId: "wrong", delta: "BAD" }); callback!(delta); callback!(delta);
      return new Promise(() => undefined);
    });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
    expect(await screen.findByText("已到达正文")).toBeInTheDocument();
    expect(screen.getByTestId("research-report-preview-text")).not.toHaveTextContent("BAD");
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
  });
  it("recovers a disconnected POST by GET without replaying generation", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(idleReport).mockResolvedValue({ ...streaming(), reportStream: { requestId: "request", sequence: 2, text: '{"summary":"恢复的正文', status: "streaming" } });
    vi.mocked(executeResearchRuntime).mockRejectedValue(new Error("disconnect"));
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
    await waitFor(() => expect(screen.getByText("恢复的正文")).toBeInTheDocument());
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("服务端仍在处理");
  });
  it("detaches a previous session stream and ignores its late events", async () => {
    let emit!: NonNullable<Parameters<typeof executeResearchRuntime>[1]>;
    let signal!: AbortSignal;
    vi.mocked(executeResearchRuntime).mockImplementation(async (_input, callback, observerSignal) => { emit = callback!; signal = observerSignal!; return new Promise(() => undefined); });
    const view = render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...idleReport, sessionId: "other" });
    view.rerender(<GuidedResearchLive sessionId="other" onBack={vi.fn()} />);
    await screen.findByRole("button", { name: "生成报告" });
    expect(signal.aborted).toBe(true);
    await act(async () => emit({ type: "snapshot", state: { ...streaming(), reportStream: { requestId: "request", sequence: 1, text: '{"summary":"错误会话正文', status: "streaming" } } }));
    expect(screen.queryByText("错误会话正文")).not.toBeInTheDocument();
  });
  it.each(["older", "empty"])("restores persisted partial text and ignores a %s poll", async (kind) => {
    const restored = { ...streaming(), reportStream: { requestId: "request", sequence: 2, text: '{"summary":"已保存正文', status: "streaming" as const } };
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(restored);
    vi.mocked(getResearchRuntimeProgress).mockResolvedValue(progressOf({ ...restored, reportStream: kind === "empty" ? null : { ...restored.reportStream, sequence: 1, text: '{"summary":"旧' } }));
    vi.useFakeTimers();
    await act(async () => { render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />); });
    expect(screen.getByText("已保存正文")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("已保存正文")).toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("restores persisted report content and timeline after refresh, then continues both streams", async () => {
    const checkpoint = { basis: "basis", chapters: [{ sectionId: "s1", body: "已保存章节", sourceIds: ["src1"] }] };
    const restored = { ...streaming(), reportCheckpoint: checkpoint,
      reportStream: { requestId: "request", sequence: 2, text: '{"summary":"刷新恢复摘要", "sections":[]}', status: "streaming" as const },
      reportTimeline: [{ id: "evidence", stage: "evidence" as const, status: "completed" as const, attempts: 1 }, { id: "chapter-s1", stage: "chapter" as const, sectionId: "s1", status: "running" as const, attempts: 1 }] };
    const progressed = { ...restored,
      reportStream: { ...restored.reportStream, sequence: 3, text: restored.reportStream.text + " " },
      reportTimeline: [{ ...restored.reportTimeline[0]! }, { ...restored.reportTimeline[1]!, status: "completed" as const }] };
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(restored);
    vi.mocked(getResearchRuntimeProgress).mockResolvedValue({ ...progressOf(progressed), stream: { requestId: "request", sequence: 3, offset: restored.reportStream.text.length, delta: " ", status: "streaming" } });
    vi.useFakeTimers();
    await act(async () => { render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />); });
    expect(screen.getByText("刷新恢复摘要")).toBeInTheDocument();
    expect(screen.getByText("已保存章节")).toBeInTheDocument();
    expect(screen.getByTestId("research-report-timeline").querySelector("[aria-busy=true]")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("已保存章节")).toBeInTheDocument();
    expect(screen.getByTestId("research-report-timeline").querySelector("[data-status=completed]")).not.toBeNull();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("accepts a higher-sequence server reset when a provider cannot stream tokens", async () => {
    const restored = { ...streaming(), reportStream: { requestId: "request", sequence: 2, text: '{"summary":"待替换草稿', status: "streaming" as const } };
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(restored);
    vi.mocked(getResearchRuntimeProgress).mockResolvedValue(progressOf({ ...restored, reportStream: { ...restored.reportStream, sequence: 3, text: "" } }));
    vi.useFakeTimers();
    await act(async () => { render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />); });
    expect(screen.getByText("待替换草稿")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByText("待替换草稿")).not.toBeInTheDocument();
    expect(screen.getByText("正在组织报告内容，正文返回后将实时显示。")).toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("offers explicit partial evidence generation only when failed tasks are terminal", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, tasks: [{ ...initial.tasks[0]!, status: "failed" }] });
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...initial, version: 8, tasks: [{ ...initial.tasks[0]!, status: "failed" }] });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "基于已有来源继续" }));
    fireEvent.click(await screen.findByRole("button", { name: "下一步：生成报告" }));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "complete", allowPartialResearch: true }), expect.any(Function), expect.any(AbortSignal), expect.objectContaining({ sessionId: expect.any(String) }));
  });
  it("blocks report generation while searches are pending", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, tasks: [{ ...initial.tasks[0]!, status: "pending" }] });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "确认并继续" })).toBeDisabled();
    expect(screen.getByText("检索仍在进行，任务结束后可生成报告。")).toBeInTheDocument();
  });
  it("keeps failed partial output visibly unfinished without exposing a completed report", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...streaming(), busy: false, leaseUntil: null, reportStream: { requestId: "request", sequence: 1, text: '{"summary":"未完成正文', status: "failed" } });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByText("未完成正文")).toBeInTheDocument();
    expect(screen.getByTestId("research-report-preview")).toHaveTextContent("尚未完成");
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
  });
  it("keeps a single More actions menu while recovering an empty report preview", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...streaming(), busy: false, leaseUntil: null, errorCode: "RESEARCH_REPORT_QUALITY_REJECTED", reportStream: { requestId: "request", sequence: 1, text: "", status: "failed" }, reportCheckpoint: { basis: "retry", chapters: [] } });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByText("尚无报告正文，已保存进度可继续生成。")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "更多操作" })).toHaveLength(1);
    fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "修改报告" })).toBeInTheDocument();
  });
});

it("merges terminal progress without reloading the full snapshot and stops", async () => {
  vi.mocked(getResearchRuntime).mockResolvedValueOnce(streaming()).mockResolvedValue({ ...initial, currentNode: "report", version: 8, errorCode: "RESEARCH_REPORT_QUALITY_REJECTED" });
  vi.mocked(getResearchRuntimeProgress).mockResolvedValue({ sessionId: initial.sessionId, version: 8, revision: 1, currentNode: "report", availableNodes: ["report"], busy: false, leaseUntil: null, errorCode: "RESEARCH_REPORT_QUALITY_REJECTED", completed: false, stream: null });
  render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
  await waitFor(() => expect(getResearchRuntime).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getResearchRuntimeProgress).toHaveBeenCalledTimes(1), { timeout: 3500 });
  await waitFor(() => expect(screen.getByRole("button", { name: "继续生成" })).toBeEnabled());
  expect(getResearchRuntime).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  expect(getResearchRuntimeProgress).toHaveBeenCalledTimes(1);
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});

it("unlocks when progress is terminal even if the POST never closes", async () => {
  let signal!: AbortSignal;
  vi.mocked(executeResearchRuntime).mockImplementation(async (input, callback, observerSignal) => { signal = observerSignal!; callback!({ type: "snapshot", state: streaming(input.requestId) }); return new Promise(() => undefined); });
  render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
  const terminal = { ...streaming(), busy: false, leaseUntil: null, errorCode: "RESEARCH_REPORT_QUALITY_REJECTED" };
  vi.mocked(getResearchRuntimeProgress).mockResolvedValue(progressOf(terminal));
  vi.mocked(getResearchRuntime).mockResolvedValue(terminal);
  await waitFor(() => expect(signal.aborted).toBe(true), { timeout: 3500 });
  expect(screen.getByRole("button", { name: "继续生成" })).toBeEnabled();
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});


it("observes report conversation generation without classifying user intent in the client", async () => {
  vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, currentNode: "report", availableNodes: [...initial.availableNodes, "report"], report: { title: "旧报告", summary: "旧摘要", sections: [] } });
  vi.mocked(executeResearchRuntime).mockImplementation(async (input, callback) => {
    expect(input).toMatchObject({ action: "message", message: "重新生成报告", node: "report" });
    callback?.({ type: "snapshot", state: streaming(input.requestId) });
    callback?.({ type: "report_delta", sessionId: input.sessionId, requestId: input.requestId, version: 8, sequence: 1, delta: '{"title":"重生成报告","summary":"对话生成的正文' });
    return new Promise(() => undefined);
  });
  render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
  fireEvent.pointerDown(await screen.findByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: "修改报告" }));
  const input = await screen.findByRole("textbox", { name: "研究对话" });
  expect(screen.getByTestId("research-report-document")).toHaveTextContent("旧报告");
  fireEvent.change(input, { target: { value: "重新生成报告" } });
  fireEvent.click(screen.getByRole("button", { name: "发送研究消息" }));
  expect(await screen.findByText("对话生成的正文")).toBeInTheDocument();
  expect(screen.queryByTestId("research-report-document")).not.toBeInTheDocument();
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});

it("pauses active report work and resumes with steering before checkpoint retry", async () => {
  const active = { ...streaming(), planRevision: 2, controlStatus: "running" as const };
  const paused = { ...active, busy: false, leaseUntil: null, controlStatus: "paused" as const, planRevision: 3 };
  vi.mocked(getResearchRuntime).mockResolvedValue(active);
  vi.mocked(getResearchRuntimeProgress).mockResolvedValue(progressOf(paused));
  vi.mocked(executeResearchRuntime).mockResolvedValueOnce({ ...paused, busy: true, leaseUntil: active.leaseUntil }).mockResolvedValueOnce({ ...paused, controlStatus: "running", planRevision: 4 }).mockResolvedValueOnce({ ...paused, controlStatus: "running" });
  render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "暂停生成" }));
  await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeResearchRuntime).mock.calls[0]![0]).toMatchObject({ action: "pause", expectedRevision: 2 });
  fireEvent.click(await screen.findByRole("button", { name: "继续生成" }, { timeout: 3500 }));
  await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(3));
  expect(vi.mocked(executeResearchRuntime).mock.calls.map(([command]) => command.action)).toEqual(["pause", "resume", "retry"]);
});
it("offers a separate full regeneration action for a saved interrupted report", async () => {
  const interrupted = { ...idleReport, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE", reportCheckpoint: { basis: "basis", chapters: [] } };
  vi.mocked(getResearchRuntime).mockResolvedValue(interrupted);
  vi.mocked(executeResearchRuntime).mockResolvedValue(idleReport);
  render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "从头重新生成" }));
  await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
  expect(vi.mocked(executeResearchRuntime).mock.calls[0]![0].action).toBe("generate");
});

it("keeps newer pause controls when an old generation snapshot arrives", async () => {
  let observer!: NonNullable<Parameters<typeof executeResearchRuntime>[1]>;
  const active = { ...streaming(), planRevision: 2, controlStatus: "running" as const };
  vi.mocked(executeResearchRuntime).mockImplementationOnce(async (_command, callback) => {
    observer = callback!; callback!({ type: "snapshot", state: active });
    return new Promise(() => {});
  }).mockResolvedValueOnce({ ...active, planRevision: 3, controlStatus: "paused" });
  render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
  fireEvent.click(await screen.findByRole("button", { name: "暂停生成" }));
  await screen.findByText("正在暂停，已保存章节会保留。");
  await act(async () => observer({ type: "snapshot", state: { ...active, reportStream: { ...active.reportStream!, sequence: 1, text: '{"summary":"新正文' } } }));
  expect(screen.getByText("正在暂停，已保存章节会保留。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "暂停生成" })).not.toBeInTheDocument();
});

describe("terminal stream recovery", () => {
  const checkpoint: NonNullable<Runtime["reportCheckpoint"]> = { basis: "saved", chapters: [{ sectionId: "s1", body: "已保存章节", sourceIds: ["src1"] }] };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  async function startFailure(recovery: Promise<Runtime>, leaseUntil = "2099-01-01T00:00:00.000Z") {
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(idleReport).mockReturnValue(recovery);
    vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new Error("offline"));
    vi.mocked(executeResearchRuntime).mockImplementation(async (input, callback) => {
      callback?.({ type: "snapshot", state: { ...streaming(input.requestId), reportStream: undefined, reportCheckpoint: checkpoint, leaseUntil } });
      throw new ApiError(409, "RESEARCH_WORKFLOW_UNAVAILABLE", null);
    });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    await act(async () => {});
  }
  it.each(["future", "expired"])("ends local loading immediately when a %s lease recovery GET hangs and prevents replay", async (lease) => {
    await startFailure(new Promise(() => {}), lease === "future" ? "2099-01-01T00:00:00.000Z" : "2020-01-01T00:00:00.000Z");
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新读取进度" })).toBeEnabled();
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("尚未确认");
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("keeps the stream error visible when recovery returns a still-busy future lease", async () => {
    await startFailure(Promise.resolve({ ...streaming(), reportStream: undefined, reportCheckpoint: checkpoint }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("服务端仍在处理");
    expect(screen.getByRole("button", { name: "使用最新进度" })).toBeDisabled();
    expect(screen.getByText("已保存章节")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续生成" })).not.toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it.each(["future", "expired"])("keeps a failed %s lease recovery locked with saved content readable", async (lease) => {
    const rejected = Promise.reject(new Error("offline")); rejected.catch(() => undefined);
    await startFailure(rejected, lease === "future" ? "2099-01-01T00:00:00.000Z" : "2020-01-01T00:00:00.000Z");
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("尚未确认");
    expect(screen.getByRole("button", { name: "使用最新进度" })).toBeDisabled();
    expect(screen.getByText("已保存章节")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it.each(["invalid", ""])("does not treat invalid recovery lease %s as authoritative idle", async (leaseUntil) => {
    const invalid = Promise.resolve({ ...streaming(), leaseUntil });
    await startFailure(invalid);
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("尚未确认");
    expect(screen.getByRole("button", { name: "使用最新进度" })).toBeDisabled();
    expect(screen.getByText("已保存章节")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("allows existing retry after a successful recovery read confirms an expired lease", async () => {
    await startFailure(Promise.resolve({ ...streaming(), leaseUntil: "2020-01-01T00:00:00.000Z", reportCheckpoint: checkpoint }));
    expect(screen.queryByTestId("research-recovery")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续生成" })).toBeEnabled();
    expect(screen.getByText("已保存章节")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("aborts the bounded recovery read and ignores its late successful snapshot", async () => {
    let resolve!: (value: Runtime) => void;
    await startFailure(new Promise(value => { resolve = value; }));
    const signal = vi.mocked(getResearchRuntime).mock.calls[1]![1]!;
    expect(signal.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ ...idleReport, version: 8, report: { title: "late", summary: "late response", sections: [] } }); });
    expect(screen.queryByText("late response")).not.toBeInTheDocument();
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("尚未确认");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("accepts authoritative terminal progress and cancels a hanging recovery without replay", async () => {
    let resolve!: (value: Runtime) => void;
    await startFailure(new Promise(value => { resolve = value; }));
    const signal = vi.mocked(getResearchRuntime).mock.calls[1]![1]!;
    vi.mocked(getResearchRuntimeProgress).mockResolvedValue(progressOf({ ...streaming(), busy: false, leaseUntil: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE", reportCheckpoint: checkpoint }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2001); });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByTestId("research-recovery")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续生成" })).toBeEnabled();
    await act(async () => { resolve(streaming()); });
    expect(screen.getByRole("button", { name: "继续生成" })).toBeEnabled();
    expect(screen.getByText("已保存章节")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it.each(["failed", "hanging"])("synchronizes a retained message draft on terminal progress after %s recovery", async (mode) => {
    const recovery = mode === "hanging" ? new Promise<Runtime>(() => {}) : Promise.reject(new Error("offline"));
    recovery.catch(() => undefined);
    vi.mocked(getResearchRuntime).mockResolvedValueOnce({ ...idleReport, report: { title: "旧报告", summary: "旧摘要", sections: [] } }).mockReturnValue(recovery);
    vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new Error("offline"));
    vi.mocked(executeResearchRuntime).mockImplementation(async (input, callback) => {
      callback?.({ type: "snapshot", state: streaming(input.requestId) });
      throw new ApiError(409, "RESEARCH_WORKFLOW_UNAVAILABLE", null);
    });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    await act(async () => {});
    fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
    await act(async () => {});
    fireEvent.click(screen.getByRole("menuitem", { name: "修改报告" }));
    fireEvent.change(screen.getByRole("textbox", { name: "研究对话" }), { target: { value: "保留我的报告修改" } });
    fireEvent.click(screen.getByRole("button", { name: "发送研究消息" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "继续编辑保留的内容" })).toBeDisabled();
    vi.mocked(getResearchRuntimeProgress).mockResolvedValue(progressOf({ ...streaming(), busy: false, leaseUntil: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2001); });
    expect(screen.getByRole("button", { name: "继续编辑保留的内容" })).toBeEnabled();
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("已读取最新研究进度");
    fireEvent.click(screen.getByRole("button", { name: "继续编辑保留的内容" }));
    expect(screen.queryByTestId("research-recovery")).not.toBeInTheDocument();
    expect(screen.getByTestId("research-report-document")).toHaveTextContent("旧报告");
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("cancels recovery reads on unmount", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(idleReport).mockReturnValue(new Promise(() => {}));
    vi.mocked(executeResearchRuntime).mockRejectedValue(new ApiError(409, "RESEARCH_WORKFLOW_UNAVAILABLE", null));
    const view = render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    await act(async () => {});
    const signal = vi.mocked(getResearchRuntime).mock.calls[1]![1]!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {});
  });
  it("rechecks at lease expiry even when every progress poll fails", async () => {
    const active = { ...streaming(), reportStream: undefined, leaseUntil: new Date(Date.now() + 5000).toISOString() };
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(active).mockRejectedValue(new Error("offline"));
    vi.mocked(getResearchRuntimeProgress).mockRejectedValue(new Error("offline"));
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByTestId("research-step-loading")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    expect(getResearchRuntime).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("research-recovery")).toHaveTextContent("尚未确认");
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
});
