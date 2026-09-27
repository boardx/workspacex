"use client";
import * as React from "react";
import { initializeInterviewMarkdown, loadInterviewMarkdown, confirmInterviewMarkdown, generateInterviewMarkdown, type InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { Button } from "@/components/ui/button";
import { InterviewRunsStep } from "./interview-runs-step";
import { InterviewReportStep } from "./interview-report-step";

export function InterviewMarkdownResultsStep({ interviewId, step, runs, onVersionChange, onReport }: {
  readonly interviewId: string; readonly step: "runs" | "report";
  readonly runs: DigitalInterviewWorkflowView["expertRuns"];
  readonly onVersionChange: (version: number) => void; readonly onReport: () => void;
}) {
  const [source, setSource] = React.useState<InterviewMarkdownEnvelope | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const callbacks = React.useRef({ onVersionChange, onReport }); callbacks.current = { onVersionChange, onReport };
  React.useEffect(() => {
    const controller = new AbortController();
    setSource(null); setError("");
    const reload = () => void loadInterviewMarkdown(interviewId, controller.signal).then((next) => {
      if (!controller.signal.aborted) { setSource(next); callbacks.current.onVersionChange(next.version); setError(""); }
    }).catch(() => { if (!controller.signal.aborted) setError("文档载入失败；已显示的内容保留，请重试。"); });
    void initializeInterviewMarkdown(interviewId, controller.signal).then((next) => {
      if (!controller.signal.aborted) { setSource(next); callbacks.current.onVersionChange(next.version); }
    }).catch(() => { if (!controller.signal.aborted) setError("文档初始化失败；请重试，不会用空编辑器替代旧材料。"); });
    const interval = step === "runs" ? window.setInterval(reload, 5000) : undefined;
    return () => { controller.abort(); if (interval !== undefined) window.clearInterval(interval); };
  }, [interviewId, step]);
  const document = source?.documents.find((item) => item.step === step);
  const state = source?.states.find((item) => item.documentId === document?.documentId);
  async function generateReport() {
    if (pending || !source || !runs.length || runs.some((run) => run.status !== "completed")) return;
    setPending(true); setError("");
    try {
      let current = await loadInterviewMarkdown(interviewId);
      const answers = current.documents.find((item) => item.step === "runs");
      if (!answers) throw new Error("Missing saved answers");
      if (current.states.find((item) => item.documentId === answers.documentId)?.status === "draft") {
        current = await confirmInterviewMarkdown(interviewId, "runs", { expectedVersion: current.version, expectedDocumentVersion: answers.version });
      }
      const next = await generateInterviewMarkdown(interviewId, "report", { expectedVersion: current.version, expectedDocumentVersion: current.documents.find((item) => item.step === "report")?.version ?? 0 });
      setSource(next); callbacks.current.onVersionChange(next.version); callbacks.current.onReport();
    } catch {
      try { const next = await loadInterviewMarkdown(interviewId); setSource(next); callbacks.current.onVersionChange(next.version); } catch { /* Keep previously loaded document. */ }
      setError("报告生成未完成，已保存文档保留。请重试；已确认版本不会被覆盖。");
    } finally { setPending(false); }
  }
  return <div>{error && <p role="alert" className="mb-4 rounded-lg border border-destructive/20 p-4 text-sm text-destructive">{error}</p>}{state?.status === "failed" && <p role="alert" className="mb-4 text-sm text-destructive">本次生成未完成，以下为已保存内容，不代表完整报告。</p>}{step === "runs" ? <InterviewRunsStep runs={runs} document={document} pending={pending} onGenerateReport={() => void generateReport()} /> : document ? <InterviewReportStep document={document} /> : <p className="text-sm text-muted-foreground">暂无已保存的报告 Markdown，请先完成访谈。</p>}{step === "report" && (state?.status === "failed" || error) && <div className="mt-4"><Button variant="outline" disabled={pending || !runs.length || runs.some((run) => run.status !== "completed")} onClick={() => void generateReport()}>继续生成报告</Button>{!runs.length && <p className="mt-2 text-sm text-muted-foreground">需要已完成的访谈任务后才能继续汇总。</p>}</div>}</div>;
}
