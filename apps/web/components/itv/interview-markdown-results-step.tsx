"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { useInterviewSource } from "./interview-session-provider";
import { interviewMarkdown } from "@repo/contracts";
import { ApiError } from "@/lib/api-client";
import { initializeInterviewMarkdown, loadInterviewMarkdown, confirmInterviewMarkdown, streamInterviewMarkdownReport, executeInterviewMarkdown, type InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";
import { InterviewRunsStep } from "./interview-runs-step";
import { InterviewReportStep } from "./interview-report-step";
import { getInterviewGenerationSession, subscribeInterviewGeneration, runInterviewGeneration } from "@/lib/interview-generation-session";
import { InterviewReportGeneration } from "./interview-report-generation";
import { InterviewStepHeader, InterviewStepActions } from "./interview-step-header";
import { interviewReportFailureKey } from "@/lib/interview-report-failure";
import { interviewExpertDisplayNames } from "./interview-transcript-display";

export function InterviewMarkdownResultsStep({ interviewId, step, runs, legacySelectedExpertIds, onVersionChange, onReport, reportPin, onBusyChange, onRunningStepChange }: {
  readonly interviewId: string; readonly step: "runs" | "report";
  readonly runs: DigitalInterviewWorkflowView["expertRuns"];
  readonly legacySelectedExpertIds?: readonly string[];
  readonly onVersionChange: (version: number) => void; readonly onReport: () => void;
  readonly reportPin?: { documentId: string; version: number };
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onRunningStepChange?: (step: string | null) => void;
}) {
 const { t } = useI18n();
  const session = React.useSyncExternalStore(subscribeInterviewGeneration, () => getInterviewGenerationSession(interviewId), () => null);
  const { source, setSource, refresh, cache } = useInterviewSource(interviewId);
  const [pending, setPending] = React.useState(false);
  const generatingReport = session?.step === "report" && session.status === "running" && Boolean(source && session.revisionId === source.revisionId);
  const [error, setError] = React.useState<import("@/lib/i18n/messages").MessageKey | "">("");
  const dispatching = React.useRef(false);
  const mounted = React.useRef(true);
  const latestVersion = React.useRef(0);
  const acceptedSource = React.useRef<InterviewMarkdownEnvelope | null>(null);
  const dispatchDelay = React.useRef(250);
  const callbacks = React.useRef({ onVersionChange, onReport }); callbacks.current = { onVersionChange, onReport };
  const receive = React.useCallback((next: InterviewMarkdownEnvelope) => {
    if (!mounted.current || next.interviewId !== interviewId || next.version < latestVersion.current) return;
    const previous = acceptedSource.current;
    if (previous?.interviewId === next.interviewId && previous.revisionId === next.revisionId) {
      const saved = previous.documents.find(item => item.step === "report");
      const incoming = next.documents.find(item => item.step === "report");
      // Canonical saves append a new document ID for each version. Identity is stable
      // only within a version; both envelope and report must advance for a new ID.
      if (saved && (!incoming || incoming.version < saved.version ||
          (incoming.version === saved.version && (incoming.documentId !== saved.documentId || incoming.contentHash !== saved.contentHash)) ||
          (incoming.version > saved.version && next.version <= previous.version))) return;
    }
    acceptedSource.current = next;
    latestVersion.current = next.version; setSource(next); callbacks.current.onVersionChange(next.version);
  }, [interviewId, setSource]);
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
        setError("itv.results.executionFailed");
      }
    } finally {
      if (action !== "pause") { dispatching.current = false; if (mounted.current) setPending(false); }
    }
  }, [interviewId, receive]);
  const autoStartedRevision = React.useRef<string | null>(null);
  const [verifiedRevision, setVerifiedRevision] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (step !== "runs" || !source || verifiedRevision !== source.revisionId || source.execution || pending || error || autoStartedRevision.current === source.revisionId) return;
    const outline = source.documents.find(doc => doc.step === "outline");
    if (!outline?.markdown.trim() || !source.states.some(state => state.documentId === outline.documentId && ["confirmed", "completed"].includes(state.status))) return;
    autoStartedRevision.current = source.revisionId;
    void execute("start");
  }, [source, step, pending, error, execute, verifiedRevision]);
  React.useEffect(() => { onBusyChange?.(pending); }, [pending, onBusyChange]);
  React.useEffect(() => { onRunningStepChange?.(generatingReport ? "report" : pending ? step : source?.execution?.status === "running" ? "runs" : null); }, [pending, generatingReport, source?.execution?.status, step, onRunningStepChange]);
  React.useEffect(() => () => onRunningStepChange?.(null), [onRunningStepChange]);
  React.useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  React.useEffect(() => {
    if (step !== "runs" || !source || verifiedRevision !== source.revisionId || source.execution?.status !== "running" || pending || error) return;
    const timer = window.setTimeout(() => void execute("advance"), dispatchDelay.current);
    return () => window.clearTimeout(timer);
  }, [source, step, pending, error, execute, verifiedRevision]);
  React.useEffect(() => {
    const controller = new AbortController();
    setVerifiedRevision(undefined); setError("");
    const enteredRevision = cache?.get<InterviewMarkdownEnvelope>(`source/${interviewId}`)?.revisionId ?? acceptedSource.current?.revisionId;
    let initialLoadFailed = false;
    const reload = () => void loadInterviewMarkdown(interviewId, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        receive(next);
        if (initialLoadFailed) {
          if (enteredRevision === undefined || enteredRevision === next.revisionId) setVerifiedRevision(next.revisionId);
          setError(""); initialLoadFailed = false;
        }
      }
    }).catch(() => { if (!controller.signal.aborted) setError("itv.results.loadFailed"); });
    void (cache?.get<InterviewMarkdownEnvelope>(`source/${interviewId}`) ? refresh() : cache ? cache.read(`source/${interviewId}`, () => initializeInterviewMarkdown(interviewId)) : initializeInterviewMarkdown(interviewId, controller.signal)).then((next) => {
      if (!controller.signal.aborted) { receive(next); setVerifiedRevision(next.revisionId); }
    }).catch(() => { if (!controller.signal.aborted) { initialLoadFailed = true; setError("itv.results.initializeFailed"); } });
    const interval = step === "runs" ? window.setInterval(reload, 5000) : undefined;
    return () => { controller.abort(); if (interval !== undefined) window.clearInterval(interval); };
  }, [interviewId, step, receive, cache, refresh]);
  const reconciledReport = React.useRef<typeof session>(null);
  const reportRevisionId = source?.revisionId;
  React.useEffect(() => {
    if (session?.step !== "report" || step !== "report" || !reportRevisionId || session.revisionId !== reportRevisionId) return;
    if (session.status === "running" || reconciledReport.current === session) return;
    reconciledReport.current = session;
    if (session.status === "completed" && session.source?.revisionId === reportRevisionId) {
      receive(session.source);
      setError("");
      return;
    }
    // The route that dispatched the request may already be unmounted. A failed
    // transport can still follow a successful save, so reconcile durable state
    // here rather than relying on the old route's catch handler or a refresh.
    const controller = new AbortController();
    setError(interviewReportFailureKey(session.error instanceof ApiError ? session.error.reasonCode : null));
    void loadInterviewMarkdown(interviewId, controller.signal).then(next => {
      if (!controller.signal.aborted && next.revisionId === session.revisionId) receive(next);
    }).catch(() => { /* Preserve the current saved document and actual failure. */ });
    return () => controller.abort();
  }, [session, step, receive, reportRevisionId, interviewId]);
  const reportAttempt = session?.attempt ?? 0;
  const reportSessionStatus = session?.status;
  const reportSessionRevisionId = session?.revisionId;
  React.useEffect(() => {
    if (step !== "report" || reportSessionStatus !== "running" || reportAttempt < 2 || !reportRevisionId || reportSessionRevisionId !== reportRevisionId) return;
    // The server saves a rejected candidate before starting its bounded repair.
    // Read it once per attempt, independently of streamed deltas, so it stays readable.
    const controller = new AbortController();
    void loadInterviewMarkdown(interviewId, controller.signal).then(next => {
      if (!controller.signal.aborted && next.revisionId === reportSessionRevisionId) receive(next);
    }).catch(() => { /* Previous preview and saved document remain readable. */ });
    return () => controller.abort();
  }, [step, reportSessionStatus, reportAttempt, reportRevisionId, reportSessionRevisionId, interviewId, receive]);
  const document = source?.documents.find((item) => item.step === step);
  const state = source?.states.find((item) => item.documentId === document?.documentId);
  if (step === "report" && source && reportPin && (!document || document.documentId !== reportPin.documentId || document.version !== reportPin.version)) return <p role="alert" className="rounded-lg border border-border p-5">{t("itv.results.pinChanged")}</p>;
  const execution = source?.execution;
  const experts = source?.documents.find((item) => item.step === "experts");
  const names = experts ? interviewExpertDisplayNames(experts) : new Map<string, string>();
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
        if (event.type === "attempt") { const previousCandidateMarkdown = markdown; markdown = ""; update({ attempt: event.attempt, markdown, previousCandidateMarkdown }); }
        if (event.type === "stage") update({ stage: event.stage });
        if (event.type === "delta") { markdown += event.delta; update({ markdown, previousCandidateMarkdown: undefined }); }
      });
    }, { revisionId: source.revisionId, version: source.version });
    callbacks.current.onReport();
    try { const next = await request; if (mounted.current) receive(next); }
    catch (cause) {
      if (mounted.current) {
        try { receive(await loadInterviewMarkdown(interviewId)); } catch { /* Retain saved source. */ }
        setError(interviewReportFailureKey(cause instanceof ApiError ? cause.reasonCode : null));
      }
    } finally { if (mounted.current) setPending(false); }
  }
  if (!source && !error) return <><InterviewStepHeader title={step === "runs" ? t("itv.runs.title") : t("itv.report.title")} /><p role="status" className="animate-pulse rounded-xl border border-border p-8 text-sm text-muted-foreground">{step === "runs" ? t("itv.results.loadingRuns") : t("itv.results.loadingReport")}</p></>;
  if (step === "report" && generatingReport && session && !document) return <InterviewReportGeneration session={session} />;
  const reportRetry = step === "report" && !generatingReport && (!document || state?.status === "failed" || error) ? <ActionButton variant="primary" loading={pending} disabled={pending || !sourceRuns.length || sourceRuns.some((run) => run.status !== "completed")} onClick={() => void generateReport()}>{t("itv.results.continueReport")}</ActionButton> : null;
  return <div>
    {step === "report" && generatingReport && session && document && <InterviewReportGeneration session={session} />}
    {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/20 p-4 text-sm text-destructive"><p>{t(error)}</p><ActionButton variant="outline" className="mt-3" disabled={pending} onClick={() => void loadInterviewMarkdown(interviewId).then((next) => { receive(next); setVerifiedRevision(next.revisionId); setError(""); }).catch(() => setError("itv.results.reloadFailed"))}>{t("itv.results.reload")}</ActionButton></div>}
    {state?.status === "failed" && !error && <p role="alert" className="mb-4 text-sm text-destructive">{t(interviewReportFailureKey(state.failure?.code))}{t("itv.results.incompleteReport")}</p>}
    {step === "runs" ? <InterviewRunsStep runs={sourceRuns} taskProgress={Boolean(execution)} document={document} pending={pending} generatingReport={generatingReport} onGenerateReport={() => void generateReport()} actions={<>
      {!execution && <ActionButton variant="primary" loading={pending} disabled={pending || !source} onClick={() => void execute("start")}>{t("itv.results.start")}</ActionButton>}
      {execution?.status === "running" && <ActionButton variant="outline" onClick={() => void execute("pause")}>{t("itv.results.pause")}</ActionButton>}
      {execution?.status === "paused" && <ActionButton variant="primary" loading={pending} disabled={pending} onClick={() => void execute("resume")}>{t("itv.continue")}</ActionButton>}
      {execution?.status === "failed" && <ActionButton variant="primary" loading={pending} disabled={pending} onClick={() => void execute("retry")}>{t("itv.results.retryExperts")}</ActionButton>}
    </>} /> : document ? <InterviewReportStep interviewId={interviewId} revisionId={source?.revisionId} actions={reportRetry} document={document} sourceDocuments={source?.documents ?? []} expertsDocument={experts} execution={execution} legacySelectedExpertIds={legacySelectedExpertIds} legacyRuns={runs} reportStatus={state?.status} shareUrl={`/itv/${encodeURIComponent(interviewId)}/report?documentId=${encodeURIComponent(document.documentId)}&version=${document.version}`} /> : <><InterviewStepHeader title={t("itv.report.title")}/><p className="text-sm text-muted-foreground">{t("itv.results.noReport")}</p><InterviewStepActions>{reportRetry}</InterviewStepActions></>}
  </div>;
}
