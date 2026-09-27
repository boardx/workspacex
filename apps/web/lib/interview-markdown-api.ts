import { interviewMarkdown } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

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
