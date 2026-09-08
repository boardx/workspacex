import { createHash } from "node:crypto";
import { research as C } from "@repo/contracts";
import type { ResearchRuntime } from "../../application/research/guided-runtime-ports";

export function runtimeProgress(state: ResearchRuntime, requestId?: string, offset = 0, digest?: string) {
  const stream = state.reportStream;
  const start = stream && stream.requestId === requestId && offset <= stream.text.length && digest === createHash("sha256").update(stream.text.slice(0, offset)).digest("hex") ? offset : 0;
  return C.GuidedResearchRuntimeProgress.parse({
    sessionId: state.sessionId, version: state.version, revision: state.revision,
    currentNode: state.currentNode, availableNodes: state.availableNodes,
    busy: state.busy, leaseUntil: state.leaseUntil, errorCode: state.errorCode,
    completed: state.completed, progress: state.progress, reportTimeline: state.reportTimeline,
    reportPartial: state.reportPartial, reportSourceAliases: state.reportSourceAliases,
    stream: stream ? { requestId: stream.requestId, sequence: stream.sequence, offset: start,
      delta: stream.text.slice(start), status: stream.status } : null,
  });
}
