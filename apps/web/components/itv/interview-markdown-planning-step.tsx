"use client";

import * as React from "react";
import { useInterviewSource } from "./interview-session-provider";
import { chatFileUpload } from "@repo/contracts";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { initializeInterviewMarkdown, loadInterviewMarkdown, saveInterviewMarkdown, confirmInterviewMarkdown, generateInterviewMarkdown,
  uploadInterviewMarkdownAttachment, type InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { InterviewIntakeStep } from "./interview-intake-step";
import { InterviewAnalysisStep } from "./interview-analysis-step";
import { importInterviewTextFile } from "@/lib/interview-text-import";

/** Planning routes use the Markdown source API exclusively; workflow JSON is metadata only. */
export function InterviewMarkdownPlanningStep({ interviewId, step, onVersionChange, onDirtyChange, onContinue, onRunningStepChange }: {
  readonly interviewId: string;
  readonly step: "intake" | "analysis";
  readonly onVersionChange: (version: number) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onContinue: (step: "analysis" | "experts") => void;
  readonly onRunningStepChange?: (step: string | null) => void;
}) {
  const { source, setSource, refresh, cache } = useInterviewSource(interviewId);
  const [markdown, setMarkdown] = React.useState(() => source?.documents.find(doc => doc.step === "intake")?.markdown ?? "");
  const [pending, setPending] = React.useState(!source);
  const [error, setError] = React.useState("");
  React.useEffect(() => { onRunningStepChange?.(pending ? step : null); }, [pending, step, onRunningStepChange]);
  React.useEffect(() => () => onRunningStepChange?.(null), [onRunningStepChange]);
  const dirty = React.useRef(false);
  const draftBase = React.useRef<{ revisionId: string | null; markdown: string } | null>(null);
  const draftConflict = Boolean(dirty.current && draftBase.current && source && (draftBase.current.revisionId !== source.revisionId || draftBase.current.markdown !== (source.documents.find(doc => doc.step === "intake")?.markdown ?? "")));
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
    setPending(!cache?.get(`source/${interviewId}`)); setError("");
    void (cache?.get<InterviewMarkdownEnvelope>(`source/${interviewId}`) ? refresh() : cache ? cache.read(`source/${interviewId}`, () => initializeInterviewMarkdown(interviewId)) : initializeInterviewMarkdown(interviewId, controller.signal)).then((next) => {
      if (controller.signal.aborted) return;
      setSource(next); if (!dirty.current) setMarkdown(next.documents.find((doc) => doc.step === "intake")?.markdown ?? "");
      callbacks.current.onVersionChange(next.version);
      if (!dirty.current) callbacks.current.onDirtyChange(false);
    }).catch((cause) => { if (!controller.signal.aborted) showError(cause); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [interviewId, cache, refresh, setSource]);

  async function action(operation: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError("");
    try { await operation(); }
    catch (cause) {
      // A failed provider response may still have appended a partial document.
      // Refresh its version before retry; never replace the user's editable intake.
      if (!(cause instanceof ApiError && cause.status === 409)) {
        try { receive(await loadInterviewMarkdown(interviewId)); } catch { /* Preserve the original failure and local draft. */ }
      }
      showError(cause);
    }
    finally { setPending(false); }
  }
  async function saveIntake(current: InterviewMarkdownEnvelope) {
    if (dirty.current && draftBase.current && (draftBase.current.revisionId !== current.revisionId || draftBase.current.markdown !== (current.documents.find(doc => doc.step === "intake")?.markdown ?? ""))) throw new Error("REMOTE_DRAFT_CONFLICT");
    const document = current.documents.find((doc) => doc.step === "intake");
    if (document?.markdown === markdown) return current;
    const next = receive(await saveInterviewMarkdown(interviewId, "intake", {
      markdown, expectedVersion: current.version, expectedDocumentVersion: document?.version ?? 0,
    }));
    dirty.current = false; callbacks.current.onDirtyChange(false);
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
  React.useEffect(() => { if (source && !dirty.current) setMarkdown(source.documents.find(doc => doc.step === "intake")?.markdown ?? ""); }, [source]);
  const analysis = source?.documents.find((document) => document.step === "analysis") ?? null;
  const intake = source?.documents.find((document) => document.step === "intake");
  const intakeImmutable = Boolean(intake && source?.states.some((state) => state.documentId === intake.documentId && ["confirmed", "completed"].includes(state.status)));
  const failure = analysis && source?.states.find((state) => state.documentId === analysis.documentId)?.status === "failed"
    ? "分析生成未完成" : null;
  return <div>
    {draftConflict && <div role="alert" className="mb-4 rounded-lg border border-border p-4 text-sm">后端需求已更新，当前未保存编辑已保留。请复制需要保留的修改，再采用最新版本。<Button variant="outline" className="ml-3" onClick={() => { setMarkdown(source?.documents.find(doc => doc.step === "intake")?.markdown ?? ""); dirty.current = false; draftBase.current = null; callbacks.current.onDirtyChange(false); }}>放弃本地修改，采用最新版本</Button></div>}
    {error && <div role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><Button className="mt-3" variant="outline" disabled={pending} onClick={() => void action(async () => { receive(await loadInterviewMarkdown(interviewId)); })}>重新载入已保存版本（保留编辑文字）</Button></div>}
    {step === "intake" ? <InterviewIntakeStep voiceSessionToken={getStoredSessionToken() ?? undefined} markdown={markdown} pending={pending} readOnly={intakeImmutable} onImportFile={importInterviewTextFile} onUploadFile={async (file) => {
      if (intakeImmutable) throw new Error("已确认需求需要创建新修订");
      if (file.size > chatFileUpload.ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES) throw new Error("研究文件不能超过同步提取上限");
      let current = await loadInterviewMarkdown(interviewId);
      // The attachment transaction can create the first intake. A blank editor
      // has no draft to persist and must not be sent to the nonempty save API.
      if (markdown.trim()) current = await saveIntake(current);
      const result = await uploadInterviewMarkdownAttachment(interviewId, file, { expectedVersion: current.version, expectedDocumentVersion: current.documents.find((doc) => doc.step === "intake")?.version ?? 0 });
      receive(result.source); setMarkdown(result.source.documents.find((doc) => doc.step === "intake")?.markdown ?? markdown); dirty.current = false; callbacks.current.onDirtyChange(false);
    }} onChange={(text) => { if (!dirty.current && source) draftBase.current = { revisionId: source.revisionId, markdown: source.documents.find(doc => doc.step === "intake")?.markdown ?? "" }; dirty.current = true; setMarkdown(text); callbacks.current.onDirtyChange(true); }}
      onConfirm={() => action(async () => {
        const saved = await saveIntake(source ?? await loadInterviewMarkdown(interviewId));
        const confirmed = await confirmStep(saved, "intake");
        dirty.current = false; callbacks.current.onDirtyChange(false);
        if (!confirmed.documents.some((doc) => doc.step === "analysis")) await generateAnalysis(confirmed);
        callbacks.current.onContinue("analysis");
      })} /> : <InterviewAnalysisStep document={analysis} pending={pending} failure={failure}
        onGenerate={() => void action(async () => { await generateAnalysis(source ?? await loadInterviewMarkdown(interviewId)); })}
        onConfirm={() => void action(async () => { await confirmStep(source ?? await loadInterviewMarkdown(interviewId), "analysis"); callbacks.current.onContinue("experts"); })} />}
  </div>;
}
