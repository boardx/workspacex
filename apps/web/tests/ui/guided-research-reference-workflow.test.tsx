import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { GuidedResearchReportPreview } from "@/components/research-studio/guided-research-report-preview";
import { researchReportDocument } from "@/lib/research-report-document";
import { executeResearchRuntime, getResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
describe("reference research workflow", () => {
  it("restores actual server stage and structured plan/task details while research is busy", async () => {
    const initial = runtimeFixture("research");
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, busy: true, leaseUntil: "2099-01-01T00:00:00.000Z", progress: { stage: "searching", completed: 2, total: 5 }, researchPlan: { overview: "先对比政策，再核查进入门槛", optimizedQuestion: "哪些市场值得优先进入？" }, tasks: [{ ...initial.tasks[0]!, title: "政策与准入核查", objective: "核实补贴和并网要求", deliverables: ["政策对比表", "准入风险清单"] }] });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByTestId("research-runtime-progress")).toHaveTextContent("检索资料 · 2 / 5");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "2");
    fireEvent.click(screen.getByText("研究计划"));
    expect(screen.getByText("哪些市场值得优先进入？")).toBeVisible();
    fireEvent.click(screen.getByText(/检索任务明细/));
    expect(screen.getByText("政策与准入核查")).toBeVisible();
    expect(screen.getByText("准入风险清单")).toBeVisible();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("does not let a poll issued before a progress snapshot roll its stage back", async () => {
    const initial = runtimeFixture("research");
    let finishPoll!: (state: typeof initial) => void;
    let emit!: NonNullable<Parameters<typeof executeResearchRuntime>[1]>;
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(initial).mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve; }));
    vi.mocked(executeResearchRuntime).mockImplementation((_input, callback) => { emit = callback!; return new Promise(() => undefined); });
    vi.useFakeTimers();
    await act(async () => { render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />); });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const snapshot = { ...initial, version: 5, busy: true, leaseUntil: "2099-01-01T00:00:00.000Z", currentNode: "report" as const, progress: { stage: "writing" as const, completed: 1, total: 2 } };
    await act(async () => { emit({ type: "snapshot", state: snapshot }); });
    await act(async () => { finishPoll({ ...snapshot, progress: { stage: "organizing", completed: 0, total: 2 } }); });
    expect(screen.getByTestId("research-runtime-progress")).toHaveTextContent("撰写报告章节 · 1 / 2");
  });
  it("resolves refreshed preview aliases only to accepted sources and groups unknown citations as pending", () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, reportSourceAliases: [{ alias: "S1", sourceId: "source1" }, { alias: "S2", sourceId: "excluded" }], sources: [...initial.sources, { ...initial.sources[0]!, id: "excluded", decision: "excluded" as const }], reportStream: { requestId: "r", sequence: 3, status: "streaming" as const, text: '{"summary":"真实结论[[source:S1]]。待证实[[source:S2]][[source:missing]]' } };
    render(<GuidedResearchReportPreview state={state} />);
    expect(screen.getByTestId("research-inline-citation")).toHaveAttribute("href", initial.sources[0]!.url);
    expect(screen.getByTestId("research-preview-citations-pending")).toHaveTextContent("2 处草稿引用待核对");
    expect(screen.queryByText(/来源不可用/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("research-report-references")).getAllByRole("listitem")).toHaveLength(1);
  });
  it("keeps invalid final citations visible and does not accept draft aliases for a final report", () => {
    const initial = runtimeFixture("report");
    const doc = researchReportDocument({ title: "Report", summary: "[[source:S1]][[source:missing", sections: [] }, initial.sources, initial.outline, { aliases: [{ alias: "S1", sourceId: "source1" }] });
    expect(doc.references).toHaveLength(0); expect(doc.summary).toBe("〔来源不可用〕〔来源不可用〕");
  });
  it("keeps checkpoint chapters on refresh and retries remaining chapters through one streaming command", async () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE", progress: { stage: "writing" as const, completed: 1, total: 2, sectionId: "o1" }, reportCheckpoint: { basis: "basis", chapters: [{ sectionId: "o1", body: "已经保存的章节[[source:source1]]", sourceIds: ["source1"] }] } };
    vi.mocked(getResearchRuntime).mockResolvedValue(state); vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    expect(await screen.findByText("已经保存的章节")).toBeInTheDocument();
    expect(screen.getByTestId("research-runtime-progress")).toHaveTextContent("已暂停");
    fireEvent.click(screen.getByRole("button", { name: "生成完整报告" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "retry", node: "report", expectedVersion: state.version }), expect.any(Function), expect.any(AbortSignal));
  });
  it("resumes checkpoint chapters after a server lease expires without an error code", async () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, busy: true, leaseUntil: "2000-01-01T00:00:00.000Z", errorCode: null, reportCheckpoint: { basis: "basis", chapters: [{ sectionId: "o1", body: "重启前保存的章节", sourceIds: ["source1"] }] } };
    vi.mocked(getResearchRuntime).mockResolvedValue(state); vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    const resume = await screen.findByRole("button", { name: "生成完整报告" });
    expect(resume).toBeEnabled();
    expect(screen.getByText("重启前保存的章节")).toBeInTheDocument();
    fireEvent.click(resume);
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "retry", node: "report", expectedVersion: state.version }), expect.any(Function), expect.any(AbortSignal));
    expect(screen.getByText("重启前保存的章节")).toBeInTheDocument();
  });
  it("still exposes full regeneration separately from checkpoint resume", async () => {
    const initial = runtimeFixture("report");
    const state = { ...initial, report: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE", reportCheckpoint: { basis: "basis", chapters: initial.report!.sections } };
    vi.mocked(getResearchRuntime).mockResolvedValue(state); vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => undefined));
    render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "重新生成本步骤" }));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "generate", node: "report" }), expect.any(Function), expect.any(AbortSignal));
  });
});
