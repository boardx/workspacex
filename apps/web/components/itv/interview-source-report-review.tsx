"use client";
import * as React from "react";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import { loadInterviewMarkdown, reviewInterviewMarkdownReport } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";

/** Review metadata never rewrites or silently approves the canonical report body. */
export function InterviewSourceReportReview({ source, onSaved }: {
  source: InterviewMarkdownEnvelope; onSaved: (source: InterviewMarkdownEnvelope) => void;
}) {
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestId = React.useRef<string | null>(null);
  const document = source.documents.find((item) => item.step === "report");
  async function requestChanges() {
    if (!document || !source.revisionId || pending) return;
    setPending(true); setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      await reviewInterviewMarkdownReport(source.interviewId, {
        expectedVersion: source.version, requestId: requestId.current,
        revisionId: source.revisionId, documentId: document.documentId,
        documentVersion: document.version, contentHash: document.contentHash,
        status: "changes_requested", note: note.trim() || null,
      });
      onSaved(await loadInterviewMarkdown(source.interviewId));
      requestId.current = null;
    } catch { setError("复核未提交，原报告保留。请重新载入版本后重试。"); }
    finally { setPending(false); }
  }
  async function refreshVersion() {
    setPending(true);
    try { onSaved(await loadInterviewMarkdown(source.interviewId)); requestId.current = null; setError(""); }
    catch { setError("版本载入失败，当前报告与复核备注保留，请重试。"); }
    finally { setPending(false); }
  }
  if (!document) return null;
  return <section className="mt-5 rounded-xl border border-border p-5 print:hidden" aria-label="报告人工复核">
    <h3 className="font-semibold">人工复核：{source.review?.status === "changes_requested" ? "要求修改" : "尚未批准"}</h3>
    {source.review && <p className="mt-2 text-sm">当前版本复核备注：{source.review.note ?? "无备注"}</p>}
    <label className="mt-4 block text-sm">复核备注<textarea className="mt-2 block min-h-24 w-full rounded-lg border border-input bg-background p-3" maxLength={1000} value={note} disabled={pending} onChange={(event) => { setNote(event.target.value); requestId.current = null; }} /></label>
    <p className="my-3 text-sm text-muted-foreground">{document.evidenceMode === "simulated" ? "AI 模拟访谈不具备真实用户证据资格，不能批准为用户验证结论。" : "当前版本缺少可信证据质量复核，不能批准；不会用空检查绕过门禁。"}</p>
    {error && <div className="mb-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={pending} onClick={() => void refreshVersion()}>重新载入复核版本（保留备注）</Button></div>}
    <div className="flex gap-3"><Button variant="outline" disabled={pending} onClick={() => void requestChanges()}>要求修改</Button><Button disabled>批准报告</Button></div>
  </section>;
}
