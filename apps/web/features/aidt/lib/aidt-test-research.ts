import { z } from "zod";
import type { InterviewMarkdownDocument, InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import type { AidtTestGroup } from "./aidt-test-groups";

import { AidtTestResearchPath, AIDT_TEST_RESEARCH_LABELS, AidtVirtualResearchBindingSchema as Binding, AIDT_TEST_VIRTUAL_RESEARCH_PREFIX as prefix, type AidtVirtualResearchBinding } from "@repo/contracts/aidt-test-research";
export { AidtTestResearchPath, AIDT_TEST_RESEARCH_LABELS, AIDT_TEST_VIRTUAL_RESEARCH_PREFIX, type AidtVirtualResearchBinding } from "@repo/contracts/aidt-test-research";

export function aidtTestResearchPath(group: AidtTestGroup): z.infer<typeof AidtTestResearchPath> {
  return group.researchPath ?? (group.method === "survey" ? "survey" : "offline");
}
export function readAidtVirtualResearch(draft: AidtUiStageDraft, id: string): AidtVirtualResearchBinding | null {
  const raw = draft.fields[prefix + id];
  if (!raw || raw.length > 6000) return null;
  try { return Binding.parse(JSON.parse(raw)); } catch { return null; }
}
export function writeAidtVirtualResearch(draft: AidtUiStageDraft, group: AidtTestGroup, binding: AidtVirtualResearchBinding): AidtUiStageDraft {
  if (group.archived || aidtTestResearchPath(group) !== "virtual" || group.source?.kind !== "interview" || group.source.id !== binding.interviewId) return draft;
  const key = prefix + group.id, value = JSON.stringify(Binding.parse(binding));
  if (value.length > 6000 || value === draft.fields[key] || (!(key in draft.fields) && Object.keys(draft.fields).length >= 100)) return draft;
  return { ...draft, fields: { ...draft.fields, [key]: value, reflectionConfirmed: "" } };
}
const pin = (document: InterviewMarkdownDocument) => ({ documentId: document.documentId, version: document.version, contentHash: document.contentHash });
export function aidtVirtualResearchBinding(source: InterviewMarkdownEnvelope): AidtVirtualResearchBinding | null {
  const outline = source.documents.find(item => item.step === "outline"), runs = source.documents.find(item => item.step === "runs"), report = source.documents.find(item => item.step === "report");
  if (!source.revisionId || !outline || !runs || !report || [outline, runs, report].some(item => item.evidenceMode !== "simulated")) return null;
  if (![outline, runs].every(item => source.states.some(state => state.documentId === item.documentId && ["confirmed", "completed"].includes(state.status)))) return null;
  if (!source.states.some(state => state.documentId === report.documentId && ["draft", "confirmed", "completed"].includes(state.status))) return null;
  return Binding.parse({ interviewId: source.interviewId, revisionId: source.revisionId, envelopeVersion: source.version, outline: pin(outline), runs: pin(runs), report: pin(report), findings: [] });
}
export async function verifyAidtVirtualResearch(source: InterviewMarkdownEnvelope, binding: AidtVirtualResearchBinding) {
  if (source.interviewId !== binding.interviewId || source.revisionId !== binding.revisionId) return null;
  const found = (["outline", "runs", "report"] as const).map(step => source.documents.find(document => document.step === step && document.documentId === binding[step].documentId && document.version === binding[step].version && document.contentHash === binding[step].contentHash && document.evidenceMode === "simulated"));
  if (found.some(document => !document)) return null;
  for (const document of found) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document!.markdown))), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== document!.contentHash) return null;
  }
  const [outline, runs, report] = found as [InterviewMarkdownDocument, InterviewMarkdownDocument, InterviewMarkdownDocument];
  const references = report.references.flatMap(reference => {
    const locator = reference.locator;
    if (!locator || reference.documentId !== runs.documentId || reference.version !== runs.version || locator.sourceHash !== runs.contentHash || locator.evidenceMode !== "simulated" || locator.end > runs.markdown.length || runs.markdown.slice(locator.start, locator.end) !== locator.quote) return [];
    return [{ anchor: reference.anchor, quote: locator.quote, start: locator.start, end: locator.end }];
  });
  for (const finding of binding.findings) {
    const reference = references.find(item => item.anchor === finding.anchor);
    if (!reference || finding.start !== reference.start || finding.end !== finding.start + finding.quote.length
      || finding.quote !== reference.quote.slice(0, 500) || runs.markdown.slice(finding.start, finding.end) !== finding.quote) return null;
  }
  return { outline, runs, report, references };
}
export function aidtVirtualResearchHref(projectId: string, interviewId: string, step: "intake" | "outline" | "runs" | "report", binding?: AidtVirtualResearchBinding) {
  const params = new URLSearchParams(projectId ? { projectId } : {});
  if (step === "report" && binding) { params.set("documentId", binding.report.documentId); params.set("version", String(binding.report.version)); }
  return `/itv/${encodeURIComponent(interviewId)}/${step}?${params}`;
}
