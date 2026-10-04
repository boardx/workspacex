import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterviewMarkdownResultsStep } from "@/components/itv/interview-markdown-results-step";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
const api = vi.hoisted(() => ({ initializeInterviewMarkdown: vi.fn(), loadInterviewMarkdown: vi.fn(), executeInterviewMarkdown: vi.fn(), confirmInterviewMarkdown: vi.fn(), generateInterviewMarkdown: vi.fn(), streamInterviewMarkdownReport: vi.fn() }));
vi.mock("@/lib/interview-markdown-api", () => api);
const source: InterviewMarkdownEnvelope = { interviewId: "itv-execution-7", revisionId: "revision-7", version: 2, documents: [], states: [], execution: null, review: null };
const active: InterviewMarkdownEnvelope = { ...source, version: 3, execution: { status: "running", tasks: [{ expertId: "nurse-7", status: "completed", errorCode: null }, { expertId: "doctor-8", status: "running", errorCode: null }] } };
beforeEach(() => { Object.values(api).forEach((mock) => mock.mockReset()); api.initializeInterviewMarkdown.mockResolvedValue(source); api.loadInterviewMarkdown.mockResolvedValue({ ...source, version: 9 }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function savedReport(id: string): InterviewMarkdownEnvelope {
  return { ...source, interviewId: id, version: 12, documents: [{ documentId: "report-saved", step: "report", version: 2, markdown: "# 合成报告\n\n已持久化的正文与反例。", contentHash: "b".repeat(64), evidenceMode: "simulated", references: [] }], states: [{ documentId: "report-saved", status: "completed", failure: null }] };
}
it("keeps the previous saved report visible during a new streaming attempt", async () => {
  const { runInterviewGeneration } = await import("@/lib/interview-generation-session");
  const id = "itv-report-retry-visible";
  const saved = savedReport(id);
  let finish!: (value: InterviewMarkdownEnvelope) => void;
  const request = runInterviewGeneration(id, "report", update => {
    update({ markdown: "本次未保存输出" });
    return new Promise(resolve => { finish = resolve; });
  }, { revisionId: source.revisionId, version: 12 });
  api.initializeInterviewMarkdown.mockResolvedValue(saved);
  render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
  expect(screen.getByTestId("itv-report-stream-markdown")).toHaveTextContent("本次未保存输出");
  await act(async () => { finish(saved); await request; });
});
it("receives completion even when generation finished before report source loaded", async () => {
  const { runInterviewGeneration } = await import("@/lib/interview-generation-session");
  const id = "itv-terminal-before-mount";
  const saved = savedReport(id);
  await runInterviewGeneration(id, "report", async () => saved, { revisionId: source.revisionId, version: 2 });
  api.initializeInterviewMarkdown.mockResolvedValue({ ...source, interviewId: id });
  render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
});
it("reconciles a failed remounted report request against durable source without manual refresh", async () => {
  const { runInterviewGeneration } = await import("@/lib/interview-generation-session");
  const id = "itv-failed-remount";
  let fail!: (cause: Error) => void;
  const request = runInterviewGeneration(id, "report", async () => new Promise<InterviewMarkdownEnvelope>((_resolve, reject) => { fail = reject; }), { revisionId: source.revisionId, version: 2 }).catch(() => {});
  api.initializeInterviewMarkdown.mockResolvedValue({ ...source, interviewId: id });
  api.loadInterviewMarkdown.mockResolvedValue(savedReport(id));
  render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  expect(await screen.findByTestId("itv-report-generation")).toBeVisible();
  await act(async () => { fail(new Error("REPORT_STREAM_INTERRUPTED")); await request; });
  expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
  expect(screen.getByRole("alert")).toHaveTextContent("报告");
});
const renderResults = () => render(<InterviewMarkdownResultsStep interviewId="itv-execution-7" step="runs" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
it("keeps durable interviewing highlighted on runs while viewing report", async () => {
  api.initializeInterviewMarkdown.mockResolvedValue(active);
  const runningStep = vi.fn();
  render(<InterviewMarkdownResultsStep interviewId="itv-execution-7" step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} onRunningStepChange={runningStep} />);
  await waitFor(() => expect(runningStep).toHaveBeenCalledWith("runs"));
  expect(runningStep).not.toHaveBeenCalledWith("report");
});
it("starting execution sends a freshly read source version rather than the initial version", async () => {
  api.executeInterviewMarkdown.mockResolvedValue({ ...active, version: 10, execution: { ...active.execution!, status: "paused" } });
  renderResults();
  await waitFor(() => expect(screen.getByRole("button", { name: "开始模拟访谈" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "开始模拟访谈" }));
  await waitFor(() => expect(api.executeInterviewMarkdown).toHaveBeenCalledWith("itv-execution-7", { expectedVersion: 9, action: "start" }));
  expect(await screen.findByRole("button", { name: "继续访谈" })).toBeEnabled();
});
it("persisted runtime tasks supply progress even when legacy runs are empty", async () => {
  api.initializeInterviewMarkdown.mockResolvedValue({ ...active, execution: { ...active.execution!, status: "paused" } });
  renderResults();
  expect(await screen.findByRole("heading", { name: "nurse-7" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "doctor-8" })).toBeVisible();
  expect(screen.getByText("已完成专家 1/2")).toBeVisible();
  expect(screen.queryByText("暂无已登记访谈任务，不会显示示例进度。")).not.toBeInTheDocument();
});
it("pause remains callable while an advance request is still pending", async () => {
  let finishAdvance!: (value: InterviewMarkdownEnvelope) => void;
  api.initializeInterviewMarkdown.mockResolvedValue(active);
  api.executeInterviewMarkdown.mockImplementation((_id: string, input: { action: string }) => input.action === "advance" ? new Promise<InterviewMarkdownEnvelope>((resolve) => { finishAdvance = resolve; }) : Promise.resolve({ ...active, version: 10, execution: { ...active.execution!, status: "paused" } }));
  renderResults();
  await waitFor(() => expect(api.executeInterviewMarkdown).toHaveBeenCalledWith("itv-execution-7", { expectedVersion: 9, action: "advance" }));
  const pause = screen.getByRole("button", { name: "暂停后续访谈" });
  expect(pause).toBeEnabled();
  fireEvent.click(pause);
  await waitFor(() => expect(api.executeInterviewMarkdown).toHaveBeenCalledWith("itv-execution-7", { expectedVersion: 9, action: "pause" }));
  expect(await screen.findByRole("button", { name: "继续访谈" })).toBeDisabled();
  finishAdvance({ ...active, version: 11, execution: { ...active.execution!, status: "paused" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "继续访谈" })).toBeEnabled());
});
it("an unchanged running response backs off dispatch instead of calling the model every 250 milliseconds", async () => {
  vi.useFakeTimers();
  api.initializeInterviewMarkdown.mockResolvedValue(active);
  api.loadInterviewMarkdown.mockImplementation(async () => ({ ...active }));
  api.executeInterviewMarkdown.mockImplementation(async () => ({ ...active }));
  renderResults();
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(api.executeInterviewMarkdown).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
  expect(api.executeInterviewMarkdown).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
  expect(api.executeInterviewMarkdown).toHaveBeenCalledTimes(2);
});
it("a delayed running poll cannot replace the newer persisted pause", async () => {
  vi.useFakeTimers();
  let finishPoll!: (value: InterviewMarkdownEnvelope) => void;
  let finishAdvance!: (value: InterviewMarkdownEnvelope) => void;
  api.initializeInterviewMarkdown.mockResolvedValue(active);
  api.loadInterviewMarkdown.mockImplementation((_id: string, signal?: AbortSignal) => signal ? new Promise<InterviewMarkdownEnvelope>((resolve) => { finishPoll = resolve; }) : Promise.resolve(active));
  const paused: InterviewMarkdownEnvelope = { ...active, version: 4, execution: { ...active.execution!, status: "paused" } };
  api.executeInterviewMarkdown.mockImplementation((_id: string, input: { action: string }) => input.action === "advance" ? new Promise<InterviewMarkdownEnvelope>((resolve) => { finishAdvance = resolve; }) : Promise.resolve(paused));
  renderResults();
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(api.executeInterviewMarkdown).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "暂停后续访谈" })); });
  expect(screen.getByRole("button", { name: "继续访谈" })).toBeVisible();
  await act(async () => { finishPoll(active); });
  expect(screen.queryByRole("button", { name: "暂停后续访谈" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续访谈" })).toBeVisible();
  await act(async () => { finishAdvance({ ...paused, version: 5 }); });
});
it("navigates immediately but does not publish a version callback after unmount", async () => {
  const answers: InterviewMarkdownEnvelope = { ...source, version: 9,
    documents: [{ documentId: "answers-7", step: "runs", version: 1, markdown: "## [护理](#expert-nurse-7)\n\n已保存回答。", contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] }],
    states: [{ documentId: "answers-7", status: "confirmed", failure: null }],
    execution: { status: "completed", tasks: [{ expertId: "nurse-7", status: "completed", errorCode: null }] } };
  let finishReport!: (value: InterviewMarkdownEnvelope) => void;
  api.initializeInterviewMarkdown.mockResolvedValue(answers);
  api.loadInterviewMarkdown.mockResolvedValue(answers);
  api.streamInterviewMarkdownReport.mockImplementation(() => new Promise<InterviewMarkdownEnvelope>((resolve) => { finishReport = resolve; }));
  const report = vi.fn(); const version = vi.fn();
  const view = render(<InterviewMarkdownResultsStep interviewId="itv-execution-7" step="runs" runs={[]} onVersionChange={version} onReport={report} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "生成报告" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
  await waitFor(() => expect(api.streamInterviewMarkdownReport).toHaveBeenCalledWith("itv-execution-7", { expectedVersion: 9, expectedDocumentVersion: 0 }, expect.any(Function)));
  const notifications = version.mock.calls.length;
  view.unmount();
  await act(async () => { finishReport({ ...answers, version: 10 }); });
  expect(report).toHaveBeenCalledTimes(1);
  expect(version).toHaveBeenCalledTimes(notifications);
});

it("automatically starts confirmed questions without a second start click", async () => {
  const outline = { documentId: "outline-auto", step: "outline" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown: "## [护理专家](#expert-nurse-7)\n\n1. 最近一次发生了什么？" };
  api.initializeInterviewMarkdown.mockResolvedValue({ ...source, interviewId: "itv-auto", documents: [outline], states: [{ documentId: outline.documentId, status: "confirmed", failure: null }] });
  api.loadInterviewMarkdown.mockResolvedValue({ ...source, interviewId: "itv-auto", version: 9 });
  api.executeInterviewMarkdown.mockResolvedValue({ ...active, interviewId: "itv-auto", execution: { ...active.execution!, status: "paused" } });
  render(<InterviewMarkdownResultsStep interviewId="itv-auto" step="runs" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  await waitFor(() => expect(api.executeInterviewMarkdown).toHaveBeenCalledWith("itv-auto", { expectedVersion: 9, action: "start" }));
  expect(api.executeInterviewMarkdown).toHaveBeenCalledTimes(1);
});

it("keeps report timeline and real deltas visible across a route remount", async () => {
  const answers: InterviewMarkdownEnvelope = { ...source, interviewId: "itv-live-stream", version: 9,
    documents: [{ documentId: "answers-stream", step: "runs", version: 1, markdown: "## [护理](#expert-nurse-7)\n\n已保存回答。", contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] }],
    states: [{ documentId: "answers-stream", status: "confirmed", failure: null }],
    execution: { status: "completed", tasks: [{ expertId: "nurse-7", status: "completed", errorCode: null }] } };
  api.initializeInterviewMarkdown.mockResolvedValue(answers); api.loadInterviewMarkdown.mockResolvedValue(answers);
  let emit!: (event: { type: string; stage?: string; delta?: string; attempt?: number }) => void;
  let finish!: (value: InterviewMarkdownEnvelope) => void;
  api.streamInterviewMarkdownReport.mockImplementation((_id, _versions, onEvent) => { emit = onEvent; return new Promise(resolve => { finish = resolve; }); });
  const navigate = vi.fn();
  const runs = render(<InterviewMarkdownResultsStep interviewId="itv-live-stream" step="runs" runs={[]} onVersionChange={vi.fn()} onReport={navigate} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(emit).toBeTypeOf("function"));
  runs.unmount();
  render(<InterviewMarkdownResultsStep interviewId="itv-live-stream" step="report" runs={[]} onVersionChange={vi.fn()} onReport={navigate} />);
  expect(await screen.findByRole("list", { name: "报告生成进度" })).toBeVisible();
  await act(async () => { emit({ type: "stage", stage: "model" }); emit({ type: "delta", delta: "## 正在输出\n首段真实模型内容。" }); });
  expect(screen.getByTestId("itv-report-stream-markdown")).toHaveTextContent("首段真实模型内容");
  expect(screen.queryByRole("button", { name: "导出 Word" })).not.toBeInTheDocument();
  await act(async () => { emit({ type: "attempt", attempt: 2 }); emit({ type: "delta", delta: "新的完整修订。" }); });
  expect(screen.getByTestId("itv-report-stream-markdown")).not.toHaveTextContent("首段真实模型内容");
  await act(async () => { finish({ ...answers, version: 10 }); });
  expect(api.streamInterviewMarkdownReport).toHaveBeenCalledTimes(1);
});

it("does not show old revision report deltas or accept its later completion", async () => {
  const { runInterviewGeneration } = await import("@/lib/interview-generation-session");
  let finish!: (value: InterviewMarkdownEnvelope) => void;
  const request = runInterviewGeneration("itv-revision-stream", "report", update => {
    update({ stage: "model", markdown: "旧修订私有报告内容" });
    return new Promise(resolve => { finish = resolve; });
  }, { revisionId: "rev-old", version: 2 });
  const newer = { ...source, interviewId: "itv-revision-stream", revisionId: "rev-new", version: 5 };
  api.initializeInterviewMarkdown.mockResolvedValue(newer);
  const version = vi.fn();
  render(<InterviewMarkdownResultsStep interviewId="itv-revision-stream" step="report" runs={[]} onVersionChange={version} onReport={vi.fn()} />);
  await waitFor(() => expect(version).toHaveBeenCalledWith(5));
  expect(screen.queryByTestId("itv-report-generation")).not.toBeInTheDocument();
  expect(screen.queryByText("旧修订私有报告内容")).not.toBeInTheDocument();
  await act(async () => { finish({ ...newer, revisionId: "rev-old", version: 6 }); await request; });
  expect(version).not.toHaveBeenCalledWith(6);
});

it("does not reveal cached report fragments when current source authorization fails", async () => {
  const { runInterviewGeneration } = await import("@/lib/interview-generation-session");
  let finish!: (value: InterviewMarkdownEnvelope) => void;
  const request = runInterviewGeneration("itv-denied-stream", "report", update => {
    update({ stage: "model", markdown: "当前无权限读取的缓存正文" });
    return new Promise(resolve => { finish = resolve; });
  }, { revisionId: "rev-denied", version: 2 });
  api.initializeInterviewMarkdown.mockRejectedValue(new Error("NO_INTERVIEW_ACCESS"));
  const version = vi.fn();
  render(<InterviewMarkdownResultsStep interviewId="itv-denied-stream" step="report" runs={[]} onVersionChange={version} onReport={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("文档初始化失败");
  expect(screen.queryByTestId("itv-report-generation")).not.toBeInTheDocument();
  expect(screen.queryByText("当前无权限读取的缓存正文")).not.toBeInTheDocument();
  await act(async () => { finish({ ...source, interviewId: "itv-denied-stream", revisionId: "rev-denied", version: 3 }); await request; });
  expect(version).not.toHaveBeenCalled();
});
