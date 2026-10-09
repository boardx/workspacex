import { research as C } from "@repo/contracts";
import type { RuntimeStreamEvent } from "../../application/research/guided-runtime-ports";
/** NDJSON is opt-in; respect explicit rejection and legacy clients' preference. */
export function acceptsResearchNdjson(accept = "") {
  const ranges = accept.toLowerCase().split(",").map((entry, index) => {
    const [media = "", ...params] = entry.trim().split(";").map(value => value.trim());
    const raw = params.find(value => value.startsWith("q="));
    const quality = raw ? Number(raw.slice(2)) : 1;
    return { media, index, quality: Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0 };
  });
  const preferred = (media: string) => ranges.filter(range => range.media === media || range.media === media.split("/")[0] + "/*" || range.media === "*/*")
    .sort((a, b) => (b.media === media ? 2 : b.media === "*/*" ? 0 : 1) - (a.media === media ? 2 : a.media === "*/*" ? 0 : 1) || a.index - b.index)[0];
  const ndjson = preferred("application/x-ndjson"), sse = preferred("text/event-stream");
  const specificity = (media: string) => media === "*/*" ? 0 : media.endsWith("/*") ? 1 : 2;
  return Boolean(ndjson?.media === "application/x-ndjson" && ndjson.quality > 0 && (!sse || ndjson.quality > sse.quality || (ndjson.quality === sse.quality && (specificity(ndjson.media) > specificity(sse.media) || (specificity(ndjson.media) === specificity(sse.media) && ndjson.index < sse.index)))));
}
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
