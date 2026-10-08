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

it("retains the first saved candidate during bounded repair and reconciles failure before refresh", async () => {
  const id = "itv-repair-saved-retention";
  const answers = { ...source, interviewId: id, version: 9,
    documents: [{ documentId: "repair-answers", step: "runs" as const, version: 1, markdown: "已保存原文。", contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [] }],
    states: [{ documentId: "repair-answers", status: "confirmed" as const, failure: null }],
    execution: { status: "completed" as const, tasks: [{ expertId: "expert-repair", status: "completed" as const, errorCode: null }] } };
  const saved = { ...savedReport(id), revisionId: answers.revisionId, version: 10, states: [{ documentId: "report-saved", status: "failed" as const, failure: { code: "REPORT_ACTION_VALIDATION_REJECTED", retryable: true } }] };
  api.initializeInterviewMarkdown.mockResolvedValue(answers); api.loadInterviewMarkdown.mockResolvedValue(answers);
  let emit!: (event: { type: string; stage?: string; delta?: string; attempt?: number }) => void;
  let fail!: (error: Error) => void;
  api.streamInterviewMarkdownReport.mockImplementation((_id, _versions, callback) => { emit = callback; return new Promise((_resolve,reject) => { fail = reject; }); });
  const runs = render(<InterviewMarkdownResultsStep interviewId={id} step="runs" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
  await waitFor(() => expect(emit).toBeTypeOf("function")); runs.unmount();
  const report = render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  await screen.findByTestId("itv-report-generation");
  await act(async () => { emit({type:"delta",delta:"# 第一轮候选\n\n已持久化的正文与反例。"}); });
  api.loadInterviewMarkdown.mockResolvedValue(saved);
  await act(async () => { emit({type:"attempt",attempt:2}); emit({type:"stage",stage:"model"}); });
  expect(screen.queryByText("正在准备报告…")).not.toBeInTheDocument();
  expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
  expect(screen.queryByRole("button", { name: "继续生成报告" })).not.toBeInTheDocument();
  await act(async () => { fail(new Error("controlled failure")); });
  await waitFor(() => expect(screen.queryByTestId("itv-report-generation")).not.toBeInTheDocument());
  expect(screen.getByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
  report.unmount(); api.initializeInterviewMarkdown.mockResolvedValue(saved);
  render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
  expect(saved.documents[0]!.contentHash).toBe("b".repeat(64));
});

it.each(["older-version", "conflicting-hash", "missing-document"])("rejects late repair snapshots with %s", async (mismatch) => {
  const { runInterviewGeneration } = await import("@/lib/interview-generation-session");
  const id = `itv-repair-late-snapshot-${mismatch}`;
  const current = savedReport(id);
  let finish!: (value: InterviewMarkdownEnvelope) => void;
  let reply!: (value: InterviewMarkdownEnvelope) => void;
  const request = runInterviewGeneration(id, "report", update => {
    update({ attempt: 2, markdown: "本次独立修订流。" });
    return new Promise(resolve => { finish = resolve; });
  }, { revisionId: current.revisionId, version: current.version });
  api.initializeInterviewMarkdown.mockResolvedValue(current);
  api.loadInterviewMarkdown.mockImplementation(() => new Promise(resolve => { reply = resolve; }));
  render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
  await waitFor(() => expect(reply).toBeTypeOf("function"));
  const mismatched = { ...current, version: current.version + 1, documents: mismatch === "missing-document" ? [] : [{ ...current.documents[0]!, version: mismatch === "older-version" ? 1 : 2, markdown: "过期候选不能替代用户已保存修改。", contentHash: "c".repeat(64) }] };
  await act(async () => { reply(mismatched); });
  expect(screen.getByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
  await act(async () => { finish(current); await request; });
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

it("reconciles a legitimate newer report ID after saved-failure resume without refresh", async () => {
  const {runInterviewGeneration}=await import("@/lib/interview-generation-session");
  const id="itv-new-report-version-id",old=savedReport(id);
  old.states=[{documentId:old.documents[0]!.documentId,status:"failed",failure:{code:"AI_GENERATION_UNAVAILABLE",retryable:true}}];
  let finish!:(next:InterviewMarkdownEnvelope)=>void;
  const request=runInterviewGeneration(id,"report",update=>{update({attempt:1,markdown:"新稿输出"});return new Promise(resolve=>{finish=resolve;});},{revisionId:old.revisionId,version:old.version});
  api.initializeInterviewMarkdown.mockResolvedValue(old);
  render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()}/>);
  expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
  const next={...old,version:old.version+1,documents:[{...old.documents[0]!,documentId:"report-new-version",version:3,markdown:"# 完整新稿\n\n已保存的新研究正文。",contentHash:"c".repeat(64)}],states:[{documentId:"report-new-version",status:"draft" as const,failure:null}]};
  await act(async()=>{finish(next);await request;});
  expect(screen.getByTestId("itv-source-report-markdown")).toHaveTextContent("已保存的新研究正文");
  expect(screen.getByTestId("itv-source-report-markdown")).not.toHaveTextContent("已持久化的正文与反例");
  expect(screen.queryByText(/已保存内容不代表完整报告/)).not.toBeInTheDocument();
});
it.each(["same-report-version","same-envelope-version"])("rejects changed report identity with %s",async mismatch=>{
 const {runInterviewGeneration}=await import("@/lib/interview-generation-session");
 const id=`itv-identity-conflict-${mismatch}`,old=savedReport(id);
 let finish!:(next:InterviewMarkdownEnvelope)=>void;
 const request=runInterviewGeneration(id,"report",()=>new Promise(resolve=>{finish=resolve;}),{revisionId:old.revisionId,version:old.version});
 api.initializeInterviewMarkdown.mockResolvedValue(old);
 render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()}/>);
 expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
 const next={...old,version:mismatch==="same-envelope-version"?old.version:old.version+1,documents:[{...old.documents[0]!,documentId:"conflicting-identity",version:mismatch==="same-report-version"?2:3,markdown:"不能覆盖旧稿。"}]};
 await act(async()=>{finish(next);await request;});
 expect(screen.getByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
});

it("keeps a newer persisted report when an earlier generation finishes late",async()=>{
 const {runInterviewGeneration}=await import("@/lib/interview-generation-session");
 const id="itv-concurrent-newer-report",old=savedReport(id);
 let finish!:(next:InterviewMarkdownEnvelope)=>void;
 let progress!:(patch:{attempt:number})=>void;
 const request=runInterviewGeneration(id,"report",update=>{progress=update;return new Promise(resolve=>{finish=resolve;});},{revisionId:old.revisionId,version:old.version});
 api.initializeInterviewMarkdown.mockResolvedValue(old);
 const newer={...old,version:old.version+2,documents:[{...old.documents[0]!,documentId:"report-persisted-later",version:4,markdown:"# 当前报告\n\n更新保存的正文不能被旧生成覆盖。",contentHash:"d".repeat(64)}],states:[{documentId:"report-persisted-later",status:"draft" as const,failure:null}]};
 api.loadInterviewMarkdown.mockResolvedValue(newer);
 render(<InterviewMarkdownResultsStep interviewId={id} step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()}/>);
 expect(await screen.findByTestId("itv-source-report-markdown")).toHaveTextContent("已持久化的正文与反例");
 await act(async()=>{progress({attempt:2});});
 await waitFor(()=>expect(screen.getByTestId("itv-source-report-markdown")).toHaveTextContent("更新保存的正文"));
 const stale={...old,version:old.version+1,documents:[{...old.documents[0]!,documentId:"report-earlier-generation",version:3,markdown:"过期生成正文。",contentHash:"c".repeat(64)}],states:[{documentId:"report-earlier-generation",status:"draft" as const,failure:null}]};
 await act(async()=>{finish(stale);await request;});
 expect(screen.getByTestId("itv-source-report-markdown")).toHaveTextContent("更新保存的正文");
 expect(screen.getByTestId("itv-source-report-markdown")).not.toHaveTextContent("过期生成正文");
});

