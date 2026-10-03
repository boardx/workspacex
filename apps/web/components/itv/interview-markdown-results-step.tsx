"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { ApiError } from "@/lib/api-client";
import { initializeInterviewMarkdown, loadInterviewMarkdown, confirmInterviewMarkdown, streamInterviewMarkdownReport, executeInterviewMarkdown, type InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { Button } from "@/components/ui/button";
import { InterviewRunsStep } from "./interview-runs-step";
import { InterviewReportStep } from "./interview-report-step";
import { InterviewSourceReportReview } from "./interview-source-report-review";
import { getInterviewGenerationSession, subscribeInterviewGeneration, runInterviewGeneration } from "@/lib/interview-generation-session";
import { InterviewReportGeneration } from "./interview-report-generation";
import { InterviewStepHeader } from "./interview-step-header";

export function InterviewMarkdownResultsStep({ interviewId, step, runs, legacySelectedExpertIds, onVersionChange, onReport, reportPin, onBusyChange, onRunningStepChange }: {
  readonly interviewId: string; readonly step: "runs" | "report";
  readonly runs: DigitalInterviewWorkflowView["expertRuns"];
  readonly legacySelectedExpertIds?: readonly string[];
  readonly onVersionChange: (version: number) => void; readonly onReport: () => void;
  readonly reportPin?: { documentId: string; version: number };
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onRunningStepChange?: (step: string | null) => void;
}) {
  const session = React.useSyncExternalStore(subscribeInterviewGeneration, () => getInterviewGenerationSession(interviewId), () => null);
  const [source, setSource] = React.useState<InterviewMarkdownEnvelope | null>(null);
  const [pending, setPending] = React.useState(false);
  const generatingReport = session?.step === "report" && session.status === "running" && Boolean(source && session.revisionId === source.revisionId);
  const [error, setError] = React.useState("");
  const dispatching = React.useRef(false);
  const mounted = React.useRef(true);
  const latestVersion = React.useRef(0);
  const dispatchDelay = React.useRef(250);
  const callbacks = React.useRef({ onVersionChange, onReport }); callbacks.current = { onVersionChange, onReport };
  const receive = React.useCallback((next: InterviewMarkdownEnvelope) => {
    if (!mounted.current || next.interviewId !== interviewId || next.version < latestVersion.current) return;
    latestVersion.current = next.version; setSource(next); callbacks.current.onVersionChange(next.version);
  }, [interviewId]);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const execute = React.useCallback(async (action: "start" | "advance" | "pause" | "resume" | "retry") => {
    if (action !== "pause" && dispatching.current) return;
    if (action !== "pause") { dispatching.current = true; setPending(true); }
    setError("");
    try {
      let current = await loadInterviewMarkdown(interviewId);
      let next: InterviewMarkdownEnvelope;
      try { next = await executeInterviewMarkdown(interviewId, { expectedVersion: current.version, action }); }
      catch (cause) {
        if (action !== "pause" || !(cause instanceof ApiError && cause.status === 409)) throw cause;
        current = await loadInterviewMarkdown(interviewId);
        next = await executeInterviewMarkdown(interviewId, { expectedVersion: current.version, action });
      }
      dispatchDelay.current = next.version === current.version ? 5000 : 250;
      if (mounted.current) receive(next);
    } catch {
      if (mounted.current) {
        try { receive(await loadInterviewMarkdown(interviewId)); } catch { /* Retain saved answers. */ }
        setError("访谈执行未完成，已保存回答保留。请审阅状态后重试。");
      }
    } finally {
      if (action !== "pause") { dispatching.current = false; if (mounted.current) setPending(false); }
    }
  }, [interviewId, receive]);
  const autoStartedRevision = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (step !== "runs" || !source || source.execution || pending || error || autoStartedRevision.current === source.revisionId) return;
    const outline = source.documents.find(doc => doc.step === "outline");
    if (!outline?.markdown.trim() || !source.states.some(state => state.documentId === outline.documentId && ["confirmed", "completed"].includes(state.status))) return;
    autoStartedRevision.current = source.revisionId;
    void execute("start");
  }, [source, step, pending, error, execute]);
  React.useEffect(() => { onBusyChange?.(pending); }, [pending, onBusyChange]);
  React.useEffect(() => { onRunningStepChange?.(generatingReport ? "report" : pending ? step : source?.execution?.status === "running" ? "runs" : null); }, [pending, generatingReport, source?.execution?.status, step, onRunningStepChange]);
  React.useEffect(() => () => onRunningStepChange?.(null), [onRunningStepChange]);
  React.useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  React.useEffect(() => {
    if (step !== "runs" || source?.execution?.status !== "running" || pending || error) return;
    const timer = window.setTimeout(() => void execute("advance"), dispatchDelay.current);
    return () => window.clearTimeout(timer);
  }, [source, step, pending, error, execute]);
  React.useEffect(() => {
    const controller = new AbortController();
    setSource(null); setError("");
    const reload = () => void loadInterviewMarkdown(interviewId, controller.signal).then((next) => {
      if (!controller.signal.aborted) receive(next);
    }).catch(() => { if (!controller.signal.aborted) setError("文档载入失败；已显示的内容保留，请重试。"); });
    void initializeInterviewMarkdown(interviewId, controller.signal).then((next) => {
      if (!controller.signal.aborted) receive(next);
    }).catch(() => { if (!controller.signal.aborted) setError("文档初始化失败；请重试，不会用空编辑器替代旧材料。"); });
    const interval = step === "runs" ? window.setInterval(reload, 5000) : undefined;
    return () => { controller.abort(); if (interval !== undefined) window.clearInterval(interval); };
  }, [interviewId, step, receive]);
  const observedReport = React.useRef(false);
  React.useEffect(() => {
    if (session?.step !== "report" || step !== "report" || !source || session.revisionId !== source.revisionId) return;
    if (session.status === "running") { observedReport.current = true; return; }
    if (session.status === "failed" && source && session.revisionId === source.revisionId) { setError("报告生成未完成，已保存文档保留。请重试；已确认版本不会被覆盖。"); return; }
    if (!observedReport.current) return;
    observedReport.current = false;
    if (session.status === "completed" && session.source) receive(session.source);
    if (session.status === "failed") setError("报告生成未完成，已保存文档保留。请重试；已确认版本不会被覆盖。");
  }, [session, step, receive, source]);
  const document = source?.documents.find((item) => item.step === step);
  const state = source?.states.find((item) => item.documentId === document?.documentId);
  if (step === "report" && source && reportPin && (!document || document.documentId !== reportPin.documentId || document.version !== reportPin.version)) return <p role="alert" className="rounded-lg border border-border p-5">分享链接指向的报告版本已不是当前版本。为避免冒用新结论，此处不显示或导出不同版本；请向报告所有者获取最新链接。</p>;
  const execution = source?.execution;
  const experts = source?.documents.find((item) => item.step === "experts");
  const names = new Map(experts ? interviewMarkdown.projectInterviewMarkdownExperts(experts).map((expert) => [expert.expertId, expert.displayName]) : []);
  // Before the first `start` command there is no durable execution row yet. Keep
  // the confirmed expert anchors visible in that state instead of rendering an
  // empty progress column; the start action will create the tasks from these IDs.
  const sourceRuns = execution
    ? execution.tasks.map((task) => ({ expertId: task.expertId, displayName: names.get(task.expertId) ?? task.expertId,
      status: task.status,
      completedQuestions: task.status === "completed" ? 1 : 0, totalQuestions: 1 }))
    : names.size
      ? [...names].map(([expertId, displayName]) => ({ expertId, displayName, status: "pending" as const, completedQuestions: 0, totalQuestions: 1 }))
      : runs;
  async function generateReport() {
    if (pending || !source || !sourceRuns.length || sourceRuns.some((run) => run.status !== "completed")) return;
    setPending(true); setError("");
    const request = runInterviewGeneration(interviewId, "report", async update => {
      let current = await loadInterviewMarkdown(interviewId);
      if (current.revisionId !== source.revisionId) throw new Error("REPORT_REVISION_CHANGED");
      const answers = current.documents.find(item => item.step === "runs");
      if (!answers) throw new Error("Missing saved answers");
      if (current.states.find(item => item.documentId === answers.documentId)?.status === "draft") {
        current = await confirmInterviewMarkdown(interviewId, "runs", { expectedVersion: current.version, expectedDocumentVersion: answers.version });
      }
      let markdown = "";
      return streamInterviewMarkdownReport(interviewId, { expectedVersion: current.version, expectedDocumentVersion: current.documents.find(item => item.step === "report")?.version ?? 0 }, event => {
        if (event.type === "attempt") { markdown = ""; update({ attempt: event.attempt, markdown }); }
        if (event.type === "stage") update({ stage: event.stage });
        if (event.type === "delta") { markdown += event.delta; update({ markdown }); }
      });
    }, { revisionId: source.revisionId, version: source.version });
    callbacks.current.onReport();
    try { const next = await request; if (mounted.current) receive(next); }
    catch {
      if (mounted.current) {
        try { receive(await loadInterviewMarkdown(interviewId)); } catch { /* Retain saved source. */ }
        setError("报告生成未完成，已保存文档保留。请重试；已确认版本不会被覆盖。");
      }
    } finally { if (mounted.current) setPending(false); }
  }
  if (step === "report" && !source && !error) return <><InterviewStepHeader title="研究报告" /><p role="status" className="text-sm text-muted-foreground">正在载入报告与生成进度…</p></>;
  if (step === "report" && generatingReport && session) return <InterviewReportGeneration session={session} />;
  const reportRetry = step === "report" && (state?.status === "failed" || error) ? <Button variant="outline" disabled={pending || !sourceRuns.length || sourceRuns.some((run) => run.status !== "completed")} onClick={() => void generateReport()}>继续生成报告</Button> : null;
  return <div>
    {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/20 p-4 text-sm text-destructive"><p>{error}</p><Button variant="outline" className="mt-3" disabled={pending} onClick={() => void loadInterviewMarkdown(interviewId).then((next) => { receive(next); setError(""); }).catch(() => setError("载入失败，请稍后重试。"))}>重新载入状态</Button></div>}
    {state?.status === "failed" && <p role="alert" className="mb-4 text-sm text-destructive">本次生成未完成，以下为已保存内容，不代表完整报告。</p>}
    {step === "runs" ? <InterviewRunsStep runs={sourceRuns} taskProgress={Boolean(execution)} document={document} pending={pending} onGenerateReport={() => void generateReport()} actions={<>
      {!execution && <Button variant="primary" disabled={pending || !source} onClick={() => void execute("start")}>开始模拟访谈</Button>}
      {execution?.status === "running" && <Button variant="outline" onClick={() => void execute("pause")}>暂停后续访谈</Button>}
      {execution?.status === "paused" && <Button variant="primary" disabled={pending} onClick={() => void execute("resume")}>继续访谈</Button>}
      {execution?.status === "failed" && <Button variant="primary" disabled={pending} onClick={() => void execute("retry")}>重试未完成专家</Button>}
    </>} /> : document ? <InterviewReportStep actions={reportRetry} document={document} sourceDocuments={source?.documents ?? []} expertsDocument={experts} execution={execution} legacySelectedExpertIds={legacySelectedExpertIds} legacyRuns={runs} reportStatus={state?.status} shareUrl={`/itv/${encodeURIComponent(interviewId)}/report?documentId=${encodeURIComponent(document.documentId)}&version=${document.version}`} /> : <><InterviewStepHeader title="研究报告">{reportRetry}</InterviewStepHeader><p className="text-sm text-muted-foreground">暂无已保存的报告 Markdown，请先完成访谈。</p></>}
    {step === "report" && source && document && <InterviewSourceReportReview source={source} onSaved={receive} />}
  </div>;
}
