import { createHash } from "node:crypto";
import type { ResearchRuntime } from "./guided-runtime-ports";
import { sourceAllowedByPolicy } from "./guided-source-policy";

/** Search completion is not question coverage. This only admits a strict draft
 * extraction; the extractor must independently validate current questions. */
export function canRecoverPartialReport(state: ResearchRuntime): boolean {
  if (!state.tasks.length || !state.tasks.some(task => task.status === "failed") ||
    state.tasks.some(task => task.status === "pending" || task.status === "running" || task.searchAttempts?.some(attempt => attempt.status === "running"))) return false;
  const documents = state.sources.filter(source => source.decision === "accepted" && sourceAllowedByPolicy(source, state.sourcePolicy) && source.document);
  return documents.length > 0 && documents.every(source =>
    createHash("sha256").update(source.document!.text).digest("hex") === source.document!.contentHash);
}
export function isUnresolvedPartialDraft(state: ResearchRuntime): boolean {
  return Boolean(state.reportPartial && state.reportDraft && state.tasks.some(task => task.status !== "succeeded"));
}
