import { createHash } from "node:crypto";
import { research as C } from "@repo/contracts";
import type { ResearchRuntime } from "../../application/research/guided-runtime-ports";

export function runtimeProgress(state: ResearchRuntime, requestId?: string, offset = 0, digest?: string, sourceCursor?: string) {
  const stream = state.reportStream;
  const start = stream && stream.requestId === requestId && offset <= stream.text.length && digest === createHash("sha256").update(stream.text.slice(0, offset)).digest("hex") ? offset : 0;
  const sources = state.currentNode === "research" ? state.sources.map(({ id, taskId, taskIds, title, url, retrievedAt, decision, presentation, documentError, addedByUser }) =>
    ({ id, taskId, taskIds, title, url, retrievedAt, decision, presentation, documentError, addedByUser })) : [];
  const cursor = createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  return C.GuidedResearchRuntimeProgress.parse({
    sessionId: state.sessionId, version: state.version, revision: state.revision,
    currentNode: state.currentNode, availableNodes: state.availableNodes,
    busy: state.busy, leaseUntil: state.leaseUntil, errorCode: state.errorCode,
    completed: state.completed, progress: state.progress, reportTimeline: state.reportTimeline, executionGoal: state.executionGoal,
    planRevision: state.planRevision, controlStatus: state.controlStatus, activity: state.activity,
    reportSavedChapterCount: state.reportCheckpoint?.chapters.length ?? 0,
    reportPartial: state.reportPartial, reportSourceAliases: state.reportSourceAliases, reportQualityWarnings: state.reportQualityWarnings ?? [],
    ...(state.currentNode === "research" ? { research: { cursor, tasks: state.tasks, ...(sourceCursor === cursor ? {} : { sources }) } } : {}),
    stream: stream ? { requestId: stream.requestId, sequence: stream.sequence, offset: start,
      delta: stream.text.slice(start), status: stream.status } : null,
  });
}
