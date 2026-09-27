"use client";

import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { loadInterviewMarkdown, saveInterviewMarkdown, confirmInterviewMarkdown, generateInterviewMarkdown,
  type InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { InterviewIntakeStep } from "./interview-intake-step";
import { InterviewAnalysisStep } from "./interview-analysis-step";

/** Planning routes use the Markdown source API exclusively; workflow JSON is metadata only. */
export function InterviewMarkdownPlanningStep({ interviewId, step, onVersionChange, onDirtyChange, onContinue }: {
  readonly interviewId: string;
  readonly step: "intake" | "analysis";
  readonly onVersionChange: (version: number) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onContinue: (step: "analysis" | "experts") => void;
}) {
  const [source, setSource] = React.useState<InterviewMarkdownEnvelope | null>(null);
  const [markdown, setMarkdown] = React.useState("");
  const [pending, setPending] = React.useState(true);
  const [error, setError] = React.useState("");
  const callbacks = React.useRef({ onVersionChange, onDirtyChange, onContinue });
  callbacks.current = { onVersionChange, onDirtyChange, onContinue };
  function receive(next: InterviewMarkdownEnvelope) {
    setSource(next); callbacks.current.onVersionChange(next.version);
    return next;
  }
  function showError(cause: unknown) {
    setError(cause instanceof ApiError && cause.status === 409
      ? "文档版本已改变或已确认，不能覆盖。当前草稿保留，请重新载入后审阅版本。"
      : "操作未完成，已保存内容和当前草稿保留。请重试。");
  }
  React.useEffect(() => {
    const controller = new AbortController();
    setPending(true); setError("");
    void loadInterviewMarkdown(interviewId, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setSource(next); setMarkdown(next.documents.find((doc) => doc.step === "intake")?.markdown ?? "");
      callbacks.current.onVersionChange(next.version);
      callbacks.current.onDirtyChange(false);
    }).catch((cause) => { if (!controller.signal.aborted) showError(cause); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [interviewId]);

  async function action(operation: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError("");
    try { await operation(); }
    catch (cause) {
      // A failed provider response may still have appended a partial document.
      // Refresh its version before retry; never replace the user's editable intake.
      try { receive(await loadInterviewMarkdown(interviewId)); } catch { /* Preserve the original failure and local draft. */ }
      showError(cause);
    }
    finally { setPending(false); }
  }
  async function saveIntake(current: InterviewMarkdownEnvelope) {
    const document = current.documents.find((doc) => doc.step === "intake");
    if (document?.markdown === markdown) return current;
    const next = receive(await saveInterviewMarkdown(interviewId, "intake", {
      markdown, expectedVersion: current.version, expectedDocumentVersion: document?.version ?? 0,
    }));
    callbacks.current.onDirtyChange(false);
    return next;
  }
  async function confirmStep(current: InterviewMarkdownEnvelope, target: "intake" | "analysis") {
    const document = current.documents.find((doc) => doc.step === target);
    if (!document) throw new Error("DOCUMENT_REQUIRED");
    const state = current.states.find((item) => item.documentId === document.documentId)?.status;
    if (state === "confirmed" || state === "completed") return current;
    return receive(await confirmInterviewMarkdown(interviewId, target, {
      expectedVersion: current.version, expectedDocumentVersion: document.version,
    }));
  }
  async function generateAnalysis(current: InterviewMarkdownEnvelope) {
    const document = current.documents.find((doc) => doc.step === "analysis");
    return receive(await generateInterviewMarkdown(interviewId, "analysis", {
      expectedVersion: current.version, expectedDocumentVersion: document?.version ?? 0,
    }));
  }
  const analysis = source?.documents.find((document) => document.step === "analysis") ?? null;
  const failure = analysis && source?.states.find((state) => state.documentId === analysis.documentId)?.status === "failed"
    ? "分析生成未完成" : null;
  return <div>
    {error && <div role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><Button className="mt-3" variant="outline" disabled={pending} onClick={() => void action(async () => { receive(await loadInterviewMarkdown(interviewId)); })}>重新载入已保存版本（保留编辑文字）</Button></div>}
    {step === "intake" ? <InterviewIntakeStep markdown={markdown} pending={pending} onChange={(text) => { setMarkdown(text); callbacks.current.onDirtyChange(true); }}
      onSave={() => action(async () => { await saveIntake(source ?? await loadInterviewMarkdown(interviewId)); })}
      onConfirm={() => action(async () => {
        const saved = await saveIntake(source ?? await loadInterviewMarkdown(interviewId));
        const confirmed = await confirmStep(saved, "intake");
        callbacks.current.onDirtyChange(false);
        if (!confirmed.documents.some((doc) => doc.step === "analysis")) await generateAnalysis(confirmed);
        callbacks.current.onContinue("analysis");
      })} /> : <InterviewAnalysisStep document={analysis} pending={pending} failure={failure}
        onGenerate={() => void action(async () => { await generateAnalysis(source ?? await loadInterviewMarkdown(interviewId)); })}
        onConfirm={() => void action(async () => { await confirmStep(source ?? await loadInterviewMarkdown(interviewId), "analysis"); callbacks.current.onContinue("experts"); })} />}
  </div>;
}
