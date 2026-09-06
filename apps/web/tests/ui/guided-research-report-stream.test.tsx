import * as React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime, type GuidedResearchRuntime as Runtime } from "@/lib/guided-research-api";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
const initial: Runtime = {
  sessionId: "session-stream", version: 7, revision: 1, currentNode: "research", availableNodes: ["brief", "directions", "outline", "research"],
  brief: { topic: "Storage", goal: "Entry strategy", timeRange: "2026", region: "Europe", focus: "Grid" },
  directions: [], outline: [{ id: "s1", title: "政策", questions: ["政策？"], enabled: true, order: 0 }],
  tasks: [{ id: "t1", sectionId: "s1", query: "policy", status: "succeeded", attempts: 1, errorCode: null }],
  sources: [{ id: "src1", taskId: "t1", title: "Official source", url: "https://example.org/policy", content: "Retrieved source", retrievedAt: "2026-09-05", decision: "accepted" }],
  report: null, completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [],
};
const streaming = (requestId = "request"): Runtime => ({ ...initial, version: 8, currentNode: "report", availableNodes: [...initial.availableNodes, "report"], busy: true, leaseUntil: "2099-01-01T00:00:00.000Z", reportStream: { requestId, sequence: 0, text: "", status: "streaming" } });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getResearchRuntime).mockResolvedValue(initial); });
afterEach(() => vi.useRealTimers());
describe("research report stream UI", () => {
  it("shows actual model text before completion and ignores wrong request and duplicate deltas", async () => {
    vi.mocked(executeResearchRuntime).mockImplementation(async (input, callback) => {
      callback!({ type: "snapshot", state: streaming(input.requestId) });
      const delta = { type: "report_delta" as const, sessionId: input.sessionId, requestId: input.requestId, version: 8, sequence: 1, delta: '{"title":"实时报告","summary":"已到达正文' };
      callback!({ ...delta, requestId: "wrong", delta: "BAD" }); callback!(delta); callback!(delta);
      return new Promise(() => undefined);
    });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    expect(await screen.findByText("已到达正文")).toBeInTheDocument();
    expect(screen.getByTestId("research-report-preview-text")).not.toHaveTextContent("BAD");
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
  });
  it("recovers a disconnected POST by GET without replaying generation", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(initial).mockResolvedValue({ ...streaming(), reportStream: { requestId: "request", sequence: 2, text: '{"summary":"恢复的正文', status: "streaming" } });
    vi.mocked(executeResearchRuntime).mockRejectedValue(new Error("disconnect"));
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    expect(await screen.findByText("恢复的正文")).toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("detaches a previous session stream and ignores its late events", async () => {
    let emit!: NonNullable<Parameters<typeof executeResearchRuntime>[1]>;
    let signal!: AbortSignal;
    vi.mocked(executeResearchRuntime).mockImplementation(async (_input, callback, observerSignal) => { emit = callback!; signal = observerSignal!; return new Promise(() => undefined); });
    const view = render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认并继续" }));
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, sessionId: "other" });
    view.rerender(<GuidedResearchLive sessionId="other" onBack={vi.fn()} />);
    await screen.findByRole("button", { name: "确认并继续" });
    expect(signal.aborted).toBe(true);
    await act(async () => emit({ type: "snapshot", state: { ...streaming(), reportStream: { requestId: "request", sequence: 1, text: '{"summary":"错误会话正文', status: "streaming" } } }));
    expect(screen.queryByText("错误会话正文")).not.toBeInTheDocument();
  });
  it.each(["older", "empty"])("restores persisted partial text and ignores a %s poll", async (kind) => {
    const restored = { ...streaming(), reportStream: { requestId: "request", sequence: 2, text: '{"summary":"已保存正文', status: "streaming" as const } };
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(restored).mockResolvedValue({ ...restored, reportStream: kind === "empty" ? null : { ...restored.reportStream, sequence: 1, text: '{"summary":"旧' } });
    vi.useFakeTimers();
    await act(async () => { render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />); });
    expect(screen.getByText("已保存正文")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("已保存正文")).toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("offers explicit partial evidence generation only when failed tasks are terminal", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, tasks: [{ ...initial.tasks[0]!, status: "failed" }] });
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...initial, version: 8 });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "基于已有来源生成报告" }));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "complete", allowPartialResearch: true }), expect.any(Function), expect.any(AbortSignal));
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
});
