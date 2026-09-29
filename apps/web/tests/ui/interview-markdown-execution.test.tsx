import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterviewMarkdownResultsStep } from "@/components/itv/interview-markdown-results-step";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
const api = vi.hoisted(() => ({ initializeInterviewMarkdown: vi.fn(), loadInterviewMarkdown: vi.fn(), executeInterviewMarkdown: vi.fn(), confirmInterviewMarkdown: vi.fn(), generateInterviewMarkdown: vi.fn() }));
vi.mock("@/lib/interview-markdown-api", () => api);
const source: InterviewMarkdownEnvelope = { interviewId: "itv-execution-7", revisionId: "revision-7", version: 2, documents: [], states: [], execution: null, review: null };
const active: InterviewMarkdownEnvelope = { ...source, version: 3, execution: { status: "running", tasks: [{ expertId: "nurse-7", status: "completed", errorCode: null }, { expertId: "doctor-8", status: "running", errorCode: null }] } };
beforeEach(() => { Object.values(api).forEach((mock) => mock.mockReset()); api.initializeInterviewMarkdown.mockResolvedValue(source); api.loadInterviewMarkdown.mockResolvedValue({ ...source, version: 9 }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const renderResults = () => render(<InterviewMarkdownResultsStep interviewId="itv-execution-7" step="runs" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
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
  expect(await screen.findByRole("button", { name: "查看nurse-7的模拟访谈" })).toBeVisible();
  expect(screen.getByRole("button", { name: "查看doctor-8的模拟访谈" })).toBeVisible();
  expect(screen.getByRole("progressbar", { name: "访谈整体进度" })).toHaveAttribute("aria-valuenow", "50");
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
it("a generated report resolving after unmount cannot navigate or publish a version callback", async () => {
  const answers: InterviewMarkdownEnvelope = { ...source, version: 9,
    documents: [{ documentId: "answers-7", step: "runs", version: 1, markdown: "## [护理](#expert-nurse-7)\n\n已保存回答。", contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] }],
    states: [{ documentId: "answers-7", status: "confirmed", failure: null }],
    execution: { status: "completed", tasks: [{ expertId: "nurse-7", status: "completed", errorCode: null }] } };
  let finishReport!: (value: InterviewMarkdownEnvelope) => void;
  api.initializeInterviewMarkdown.mockResolvedValue(answers);
  api.loadInterviewMarkdown.mockResolvedValue(answers);
  api.generateInterviewMarkdown.mockImplementation(() => new Promise<InterviewMarkdownEnvelope>((resolve) => { finishReport = resolve; }));
  const report = vi.fn(); const version = vi.fn();
  const view = render(<InterviewMarkdownResultsStep interviewId="itv-execution-7" step="runs" runs={[]} onVersionChange={version} onReport={report} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "汇总报告" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "汇总报告" }));
  await waitFor(() => expect(api.generateInterviewMarkdown).toHaveBeenCalledWith("itv-execution-7", "report", { expectedVersion: 9, expectedDocumentVersion: 0 }));
  const notifications = version.mock.calls.length;
  view.unmount();
  await act(async () => { finishReport({ ...answers, version: 10 }); });
  expect(report).not.toHaveBeenCalled();
  expect(version).toHaveBeenCalledTimes(notifications);
});
