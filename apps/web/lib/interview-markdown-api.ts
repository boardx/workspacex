import { interviewMarkdown, chatFileUpload } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";
import { SubmitInterviewMarkdownReportReview, InterviewMarkdownReportReviewResult } from "@repo/contracts/interview-markdown-report-review";

export type InterviewMarkdownEnvelope = z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>;
export type InterviewMarkdownDocument = z.infer<typeof interviewMarkdown.InterviewMarkdownDocument>;
type Step = InterviewMarkdownDocument["step"];
type Versions = z.infer<typeof interviewMarkdown.GenerateInterviewMarkdown>;

function sourcePath(interviewId: string, step?: Step) {
  return `/interviews/digital/${encodeURIComponent(interviewId)}/markdown${step ? `/${step}` : ""}`;
}
async function sourceRequest(path: string, body?: unknown, signal?: AbortSignal): Promise<InterviewMarkdownEnvelope> {
  const response = await apiRequest<unknown>(path, { method: body === undefined ? "GET" : "POST", body, signal });
  return interviewMarkdown.InterviewMarkdownEnvelope.parse(response);
}
export function loadInterviewMarkdown(interviewId: string, signal?: AbortSignal) {
  return sourceRequest(sourcePath(interviewId), undefined, signal);
}
export function executeInterviewMarkdown(interviewId: string, input: z.infer<typeof interviewMarkdown.ExecuteInterviewMarkdown>) {
  return sourceRequest(`${sourcePath(interviewId)}/execution`, interviewMarkdown.ExecuteInterviewMarkdown.parse(input));
}
export function branchInterviewMarkdown(interviewId: string, input: z.infer<typeof interviewMarkdown.BranchInterviewMarkdownRevision>) {
  return sourceRequest(`${sourcePath(interviewId)}/revision`, interviewMarkdown.BranchInterviewMarkdownRevision.parse(input));
}
export async function reviewInterviewMarkdownReport(interviewId: string, input: z.infer<typeof SubmitInterviewMarkdownReportReview>) {
  return InterviewMarkdownReportReviewResult.parse(await apiRequest(`${sourcePath(interviewId)}/report/review`, {
    method: "POST", body: SubmitInterviewMarkdownReportReview.parse(input),
  }));
}
export async function uploadInterviewMarkdownAttachment(interviewId: string, file: File, input: Versions) {
  const versions = interviewMarkdown.GenerateInterviewMarkdown.parse(input);
  const mime = chatFileUpload.normalizeAttachmentMime(file.name, file.type);
  const original = mime === file.type ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified });
  const form = new FormData(); form.append("file", original);
  return interviewMarkdown.InterviewMarkdownAttachmentResult.parse(await apiRequest(`${sourcePath(interviewId)}/attachments`, {
    method: "POST", multipartBody: form,
    query: { expectedVersion: String(versions.expectedVersion), expectedDocumentVersion: String(versions.expectedDocumentVersion) },
  }));
}
/** Explicit, authorized initialization is separate from the read-only GET. */
export async function initializeInterviewMarkdown(interviewId: string, signal?: AbortSignal) {
  const current = await loadInterviewMarkdown(interviewId, signal);
  if (current.documents.length) return current;
  return sourceRequest(`${sourcePath(interviewId)}/initialize`, interviewMarkdown.InitializeInterviewMarkdown.parse({ expectedVersion: current.version }), signal);
}
export function saveInterviewMarkdown(interviewId: string, step: Step,
  input: z.infer<typeof interviewMarkdown.SaveInterviewMarkdownDraft>) {
  return sourceRequest(sourcePath(interviewId, step), interviewMarkdown.SaveInterviewMarkdownDraft.parse(input));
}
export function confirmInterviewMarkdown(interviewId: string, step: Step, input: Versions) {
  return sourceRequest(`${sourcePath(interviewId, step)}/confirm`, interviewMarkdown.ConfirmInterviewMarkdown.parse(input));
}
export function generateInterviewMarkdown(interviewId: string,
  step: z.infer<typeof interviewMarkdown.InterviewMarkdownGenerationStep>, input: Versions) {
  return sourceRequest(`${sourcePath(interviewId, step)}/generate`, interviewMarkdown.GenerateInterviewMarkdown.parse(input));
}
export async function previewVirtualExpertMarkdown(interviewId: string, input: z.infer<typeof interviewMarkdown.PreviewVirtualExpertMarkdown>) {
  return interviewMarkdown.VirtualExpertMarkdownProposal.parse(await apiRequest(`${sourcePath(interviewId)}/virtual-expert/preview`, {
    method: "POST", body: interviewMarkdown.PreviewVirtualExpertMarkdown.parse(input),
  }));
}

/** Canonical report streaming: one request, real provider fragments, final saved source. */
export async function streamInterviewMarkdownReport(interviewId: string, input: Versions,
  onEvent: (event: interviewMarkdown.InterviewMarkdownReportStreamEvent) => void) {
  const { apiUrl, getStoredSessionToken, ApiError } = await import("./api-client");
  const token = getStoredSessionToken();
  const response = await fetch(apiUrl(`${sourcePath(interviewId, "report")}/generate-stream`), {
    method: "POST", credentials: "include",
    headers: { Accept: "application/x-ndjson", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(interviewMarkdown.GenerateInterviewMarkdown.parse(input)),
  });
  if (!response.ok) throw new ApiError(response.status, null, null);
  if (!response.body) throw new Error("REPORT_STREAM_UNAVAILABLE");
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ""; let completed: InterviewMarkdownEnvelope | undefined;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = interviewMarkdown.InterviewMarkdownReportStreamEvent.parse(JSON.parse(line));
    if (event.type === "completed") {
      if (event.source.interviewId !== interviewId) throw new Error("REPORT_SOURCE_MISMATCH");
      completed = event.source;
    }
    if (event.type === "failed") throw new ApiError(503, event.reasonCode, null);
    onEvent(event);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) !== -1) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1); }
      if (done) { consume(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!completed) throw new Error("REPORT_STREAM_INTERRUPTED");
  return completed;
}
