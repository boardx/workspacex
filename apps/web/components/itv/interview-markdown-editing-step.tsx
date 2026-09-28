"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { loadDigitalExperts, type DigitalExpertCatalogRow } from "@/lib/interview-api";
import { initializeInterviewMarkdown, loadInterviewMarkdown, saveInterviewMarkdown, confirmInterviewMarkdown, generateInterviewMarkdown, previewVirtualExpertMarkdown,
  type InterviewMarkdownEnvelope, type InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { InterviewExpertsStep } from "./interview-experts-step";
import { InterviewOutlineStep } from "./interview-outline-step";

export function InterviewMarkdownEditingStep({ interviewId, step, onVersionChange, onDirtyChange, onContinue }: {
  interviewId: string; step: "experts" | "outline"; onVersionChange: (version: number) => void;
  onDirtyChange: (dirty: boolean) => void; onContinue: (step: "outline" | "runs") => void;
}) {
  const [source, setSource] = React.useState<InterviewMarkdownEnvelope | null>(null);
  const [markdown, setMarkdown] = React.useState("");
  const [directory, setDirectory] = React.useState<readonly DigitalExpertCatalogRow[]>([]);
  const [directoryStatus, setDirectoryStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [directoryEpoch, setDirectoryEpoch] = React.useState(0);
  const [pending, setPending] = React.useState(true);
  const [error, setError] = React.useState("");
  const dirty = React.useRef(false);
  const callbacks = React.useRef({ onVersionChange, onDirtyChange, onContinue });
  callbacks.current = { onVersionChange, onDirtyChange, onContinue };
  function receive(next: InterviewMarkdownEnvelope) { setSource(next); callbacks.current.onVersionChange(next.version); return next; }
  React.useEffect(() => {
    const controller = new AbortController();
    setPending(true); setError("");
    void initializeInterviewMarkdown(interviewId, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setSource(next); setMarkdown(next.documents.find((doc) => doc.step === step)?.markdown ?? ""); dirty.current = false;
      callbacks.current.onVersionChange(next.version); callbacks.current.onDirtyChange(false);
    }).catch(() => { if (!controller.signal.aborted) setError("文档载入失败。请重试，不会用示例内容替代。"); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [interviewId, step]);
  React.useEffect(() => {
    let active = true;
    setDirectoryStatus("loading"); setDirectory([]);
    void loadDigitalExperts().then((result) => { if (active) { setDirectory(result.items); setDirectoryStatus("ready"); } })
      .catch(() => { if (active) setDirectoryStatus("error"); });
    return () => { active = false; };
  }, [interviewId, step, directoryEpoch]);
  async function action(operation: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError("");
    try { await operation(); }
    catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 409)) {
        try { const next = receive(await loadInterviewMarkdown(interviewId)); if (!dirty.current) setMarkdown(next.documents.find((doc) => doc.step === step)?.markdown ?? ""); } catch { /* Retain editable draft. */ }
      }
      setError(cause instanceof ApiError && cause.status === 409 ? "版本冲突或文档已确认；当前编辑保留，不能覆盖确认版本。" : "操作未完成，当前编辑保留。请重试。");
    } finally { setPending(false); }
  }
  async function save(current: InterviewMarkdownEnvelope) {
    const doc = current.documents.find((item) => item.step === step);
    if (doc?.markdown === markdown) return current;
    const next = receive(await saveInterviewMarkdown(interviewId, step, { markdown, expectedVersion: current.version, expectedDocumentVersion: doc?.version ?? 0 }));
    dirty.current = false; callbacks.current.onDirtyChange(false); return next;
  }
  async function confirm() {
    const saved = await save(source ?? await loadInterviewMarkdown(interviewId));
    const doc = saved.documents.find((item) => item.step === step)!;
    const status = saved.states.find((item) => item.documentId === doc.documentId)?.status;
    const confirmed = status === "confirmed" || status === "completed" ? saved : receive(await confirmInterviewMarkdown(interviewId, step, { expectedVersion: saved.version, expectedDocumentVersion: doc.version }));
    if (step === "experts" && !confirmed.documents.some((item) => item.step === "outline")) receive(await generateInterviewMarkdown(interviewId, "outline", { expectedVersion: confirmed.version, expectedDocumentVersion: 0 }));
    callbacks.current.onContinue(step === "experts" ? "outline" : "runs");
  }
  const saved = source?.documents.find((doc) => doc.step === step);
  const savedStatus = source?.states.find((item) => item.documentId === saved?.documentId)?.status;
  const immutable = savedStatus === "confirmed" || savedStatus === "completed";
  const document: InterviewMarkdownDocument = { ...(saved ?? { documentId: `unsaved-${step}`, step, version: 1, contentHash: "0".repeat(64), evidenceMode: "simulated" as const, references: [] }), markdown };
  const props = { document, pending: pending || immutable,
    avatarContext: source?.revisionId ? { interviewId, revisionId: source.revisionId } : undefined,
    savedExpertIds: saved ? interviewMarkdown.projectInterviewMarkdownExperts(saved).map((expert) => expert.expertId) : [],
    onChange: (text: string) => { setMarkdown(text); dirty.current = true; callbacks.current.onDirtyChange(true); },
    onSuggestVirtual: async (description: string) => {
      if (immutable) throw new Error("CONFIRMED_SOURCE_READ_ONLY");
      const current = source ?? await loadInterviewMarkdown(interviewId);
      const proposal = await previewVirtualExpertMarkdown(interviewId, { description, expectedVersion: current.version });
      return proposal.markdown;
    },
    onSave: () => void action(async () => { await save(source ?? await loadInterviewMarkdown(interviewId)); }),
    onConfirm: () => void action(confirm),
    onGenerate: () => {
      if (immutable) { setError("已确认文档只读；需创建新修订后才能重新生成。"); return; }
      if (markdown.trim() && markdown !== saved?.markdown) { setError("请先保存或审阅当前编辑，再生成新建议。当前文字不会被丢弃。"); return; }
      void action(async () => {
      const current = source ?? await loadInterviewMarkdown(interviewId);
      const next = receive(await generateInterviewMarkdown(interviewId, step, { expectedVersion: current.version, expectedDocumentVersion: current.documents.find((doc) => doc.step === step)?.version ?? 0 }));
      setMarkdown(next.documents.find((doc) => doc.step === step)?.markdown ?? ""); dirty.current = false; callbacks.current.onDirtyChange(false);
      });
    },
  };
  return <div>{immutable && <p role="status" className="mb-4 text-sm text-muted-foreground">已确认文档只读；创建新修订后才能编辑或重新生成。</p>}{error && <div role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><Button className="mt-3" variant="outline" disabled={pending} onClick={() => void action(async () => { const next = receive(await loadInterviewMarkdown(interviewId)); if (!dirty.current) setMarkdown(next.documents.find((doc) => doc.step === step)?.markdown ?? ""); setDirectoryEpoch((value) => value + 1); })}>重新载入（保留编辑）</Button></div>}{step === "experts" ? <InterviewExpertsStep {...props} directory={directory} directoryStatus={directoryStatus} showRecoveryContext={savedStatus === "failed"} onRetryDirectory={() => setDirectoryEpoch((value) => value + 1)} /> : <InterviewOutlineStep {...props} directory={directory} expertsDocument={source?.documents.find((doc) => doc.step === "experts")} />}</div>;
}
