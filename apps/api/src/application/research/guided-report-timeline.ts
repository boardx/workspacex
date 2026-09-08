import type { ResearchRuntime } from "./guided-runtime-ports";
type Item = NonNullable<ResearchRuntime["reportTimeline"]>[number];
type Stage = Item["stage"];
export function reportTimelineId(stage: Stage, sectionId?: string) { return sectionId ? `${stage}:${sectionId}` : stage; }
export function initializeReportTimeline(state: ResearchRuntime, approved: readonly { sectionId: string }[]) {
  const sections = state.outline.filter((section) => section.enabled);
  const done = new Set(approved.map((chapter) => chapter.sectionId));
  const item = (stage: Stage, sectionId?: string, completed = false): Item => ({ id: reportTimelineId(stage, sectionId), stage, ...(sectionId ? { sectionId } : {}), status: completed ? "completed" : "pending", attempts: 0 });
  state.reportTimeline = [item("evidence", undefined, sections.length === done.size), ...sections.flatMap((section) => [item("chapter", section.id, done.has(section.id)), item("review", section.id, done.has(section.id))]), item("synthesis"), item("validation")];
  if (sections.length === done.size && state.reportEvidenceWarnings?.length) {
    state.reportTimeline[0]!.status = "warning";
    state.reportTimeline[0]!.reasonCode = "RESEARCH_CONTENT_REFERENCE_INVALID";
  }
}
export function updateReportTimeline(state: ResearchRuntime, stage: Stage, status: Item["status"], options: { sectionId?: string; attempt?: boolean; completed?: number; total?: number; reasonCode?: string } = {}) {
  const item = state.reportTimeline?.find((item) => item.id === reportTimelineId(stage, options.sectionId));
  if (!item) return;
  item.status = status;
  if (options.attempt) item.attempts++;
  if (status === "running" || status === "retrying") { item.startedAt ??= new Date().toISOString(); delete item.finishedAt; }
  if (["completed", "warning", "failed"].includes(status)) item.finishedAt = new Date().toISOString();
  if (options.completed !== undefined) item.completed = options.completed;
  if (options.total !== undefined) item.total = options.total;
  if (options.reasonCode) item.reasonCode = options.reasonCode; else delete item.reasonCode;
}
export function failActiveReportTimeline(state: ResearchRuntime, reasonCode: string) {
  const active = [...(state.reportTimeline ?? [])].reverse().find((item) => item.status === "running" || item.status === "retrying");
  if (active) updateReportTimeline(state, active.stage, "failed", { sectionId: active.sectionId, reasonCode });
}
