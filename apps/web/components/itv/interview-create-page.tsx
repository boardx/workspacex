"use client";
import * as React from "react";
import { chatFileUpload } from "@repo/contracts";
import { useRouter } from "next/navigation";
import { createDigitalInterviewDraft } from "@/lib/live-interview-metadata";
import { getStoredSessionToken } from "@/lib/api-client";
import { initializeInterviewMarkdown, saveInterviewMarkdown, confirmInterviewMarkdown, generateInterviewMarkdown, uploadInterviewMarkdownAttachment } from "@/lib/interview-markdown-api";
import { importInterviewTextFile } from "@/lib/interview-text-import";
import { InterviewIntakeStep } from "./interview-intake-step";
import { InterviewWorkbenchHeader, INTERVIEW_WORKBENCH_STEPS } from "./interview-workbench-header";
import { Button } from "@/components/ui/button";

/** Create only identity metadata, then persist the research body as canonical Markdown. */
export function InterviewCreatePage({ projectId = null }: { projectId?: string | null }) {
  const router = useRouter();
  const [name, setName] = React.useState("未命名访谈");
  const [markdown, setMarkdown] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [intakeConfirmed, setIntakeConfirmed] = React.useState(false);
  const createdId = React.useRef<string | null>(null);
  const request = React.useRef<string | null>(null);
  async function ensureIdentity() {
    request.current ??= crypto.randomUUID();
    if (!createdId.current) {
      const created = await createDigitalInterviewDraft({ name: name.trim() || "未命名访谈", tags: [], scope: { kind: projectId ? "project" : "none", projectId, researchProjectId: null }, requestId: request.current });
      createdId.current = created.interviewId;
    }
    return createdId.current;
  }
  async function save() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const id = await ensureIdentity();
      let source = await initializeInterviewMarkdown(id);
      const intake = source.documents.find((doc) => doc.step === "intake");
      const immutable = source.states.some((state) => state.documentId === intake?.documentId && ["confirmed", "completed"].includes(state.status));
      setIntakeConfirmed(immutable);
      if (intake?.markdown !== markdown) source = await saveInterviewMarkdown(id, "intake", { markdown, expectedVersion: source.version, expectedDocumentVersion: intake?.version ?? 0 });
      const doc = source.documents.find((item) => item.step === "intake")!;
      if (!source.states.some((state) => state.documentId === doc.documentId && ["confirmed", "completed"].includes(state.status))) source = await confirmInterviewMarkdown(id, "intake", { expectedVersion: source.version, expectedDocumentVersion: doc.version });
      setIntakeConfirmed(true);
      if (!source.documents.some((item) => item.step === "analysis")) await generateInterviewMarkdown(id, "analysis", { expectedVersion: source.version, expectedDocumentVersion: 0 });
      router.push(`/itv/${encodeURIComponent(id)}/analysis`);
    } catch { setError("保存或分析未完成，当前 Markdown 已保留；再次尝试会恢复同一访谈，不会重复创建。"); }
    finally { setPending(false); }
  }
  return <main className="min-h-screen bg-background p-6 lg:p-10"><div className="mx-auto max-w-[1440px]">
    <div className="mb-6"><InterviewWorkbenchHeader name="新建访谈" tags={[]} steps={INTERVIEW_WORKBENCH_STEPS} activeStep="intake" status="尚未保存" version={1} topic={null} onStepChange={(step) => { if (step !== "intake") setError("请先保存并确认研究需求，后续步骤不会提前执行。"); }} onReturnToList={() => { if (!markdown.trim() || window.confirm("当前需求尚未保存，确定返回列表吗？")) router.push("/itv"); }} /></div>
    <label className="mb-5 block text-sm font-medium">访谈名称<input className="mt-2 block w-full max-w-xl rounded-lg border border-input bg-background px-4 py-3" maxLength={100} value={name} disabled={pending || Boolean(createdId.current)} onChange={(event) => setName(event.target.value)} /></label>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {intakeConfirmed && createdId.current && <div className="mb-4 flex items-center gap-3"><p className="text-sm text-muted-foreground">需求已确认并保存，原文只读。修改请进入工作台创建新修订。</p><Button variant="outline" onClick={() => router.push(`/itv/${encodeURIComponent(createdId.current!)}/intake`)}>进入已保存访谈</Button></div>}
    <InterviewIntakeStep readOnly={intakeConfirmed} voiceSessionToken={getStoredSessionToken() ?? undefined} markdown={markdown} onChange={setMarkdown} pending={pending} onImportFile={importInterviewTextFile} onUploadFile={async (file) => {
      if (file.size > chatFileUpload.ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES) throw new Error("研究文件不能超过同步提取上限");
      const id = await ensureIdentity();
      let current = await initializeInterviewMarkdown(id);
      const intake = current.documents.find((doc) => doc.step === "intake");
      if (markdown && intake?.markdown !== markdown) current = await saveInterviewMarkdown(id, "intake", { markdown, expectedVersion: current.version, expectedDocumentVersion: intake?.version ?? 0 });
      const result = await uploadInterviewMarkdownAttachment(id, file, { expectedVersion: current.version, expectedDocumentVersion: current.documents.find((doc) => doc.step === "intake")?.version ?? 0 });
      setMarkdown(result.source.documents.find((doc) => doc.step === "intake")?.markdown ?? markdown);
    }} onConfirm={save} />
  </div></main>;
}
