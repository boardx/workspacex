import { research as C } from "@repo/contracts";
import type { RuntimeStreamEvent } from "../../application/research/guided-runtime-ports";
/** Adapt internal observations, never serialize runtime patches into public NDJSON. */
export function researchGenerationEvents(requestId: string, write: (event: unknown) => void) {
  let last = "";
  let stream: { sequence: number; text: string; status: string } | undefined;
  let source: typeof C.GuidedResearchGenerationSource._type | undefined;
  const emit = (event: unknown) => write(C.GuidedResearchGenerationStreamEvent.parse(event));
  return (event: RuntimeStreamEvent) => {
    if (event.type === "error") { emit({ type: "failed", reasonCode: event.reasonCode }); return; }
    if (event.type === "report_delta") {
      if (!source) throw new Error("Research generation context required before delta");
      emit({ type: "delta", source: { ...source, sessionId: event.sessionId, version: event.version, requestId: event.requestId }, sequence: event.sequence, delta: event.delta });
      if (stream) stream = { ...stream, sequence: event.sequence, text: stream.text + event.delta };
      return;
    }
    if (event.type !== "snapshot" && event.type !== "result") throw new Error("Unsupported internal generation observation");
    const state = event.state;
    source = { sessionId: state.sessionId, requestId, version: state.version, revision: state.revision };
    if (event.type === "result") {
      emit(state.errorCode ? { type: "failed", reasonCode: state.errorCode } : { type: "completed", source }); return;
    }
    const stage = state.progress?.stage ?? state.currentNode;
    const descriptor = state.reportStream && (!stream || stream.sequence !== state.reportStream.sequence || stream.text !== state.reportStream.text || stream.status !== state.reportStream.status)
      ? { sequence: state.reportStream.sequence, offset: state.reportStream.text.length, status: state.reportStream.status } : undefined;
    const key = JSON.stringify([stage, state.currentNode, descriptor]);
    if (key !== last || descriptor) emit({ type: "stage", stage, source, ...(descriptor ? { stream: descriptor } : {}) });
    last = key;
    stream = state.reportStream ? { ...state.reportStream } : undefined;
  };
}
