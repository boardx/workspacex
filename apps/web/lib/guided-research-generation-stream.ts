import { research } from "@repo/contracts";
import { ApiError } from "./api-client";
import { getResearchRuntime, type GuidedResearchRuntime, type GuidedResearchRuntimeCommand } from "./guided-research-api";
import type { ResearchStreamEvent } from "./guided-research-stream";
/** Normalize the common public protocol into private UI observations. State
 * recovery remains authenticated and uses the existing runtime read contract. */
export async function readResearchGenerationStream(response: Response, input: GuidedResearchRuntimeCommand,
  onEvent: (event: ResearchStreamEvent) => void, signal?: AbortSignal, baseline?: GuidedResearchRuntime) {
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffer = "", current = baseline;
  try {
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 2 * 1048576) throw new ApiError(502, "RESEARCH_STREAM_INVALID", null);
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary).trim(); buffer = buffer.slice(boundary + 1);
        if (!line) continue;
        const event = research.GuidedResearchGenerationStreamEvent.parse(JSON.parse(line));
        if (event.type === "failed") throw new ApiError(409, event.reasonCode, event);
        const source = event.source;
        if (source.sessionId !== input.sessionId || source.requestId !== input.requestId) throw new ApiError(502, "RESEARCH_STREAM_INVALID", null);
        if (event.type === "completed") {
          const state = await getResearchRuntime(input.sessionId, signal);
          if (state.version < source.version || state.version === source.version && state.revision < source.revision) throw new ApiError(502, "RESEARCH_STATE_SNAPSHOT_REQUIRED", null);
          onEvent({ type: "result", state }); return state;
        }
        if (source.version !== input.expectedVersion + 1) continue;
        if (event.type === "stage") {
          // Pending command polling already supplies plan/source/timeline updates.
          // Only a text-stream reset needs immediate local stream initialization.
          if (event.stream) {
            if (current?.version === source.version && current.reportStream?.requestId === source.requestId && current.reportStream.sequence > event.stream.sequence) continue;
            if (!current || current.version !== source.version || event.stream.offset) {
              current = await getResearchRuntime(input.sessionId, signal);
              onEvent({ type: "snapshot", state: current });
            } else {
              current = { ...current, reportStream: { requestId: source.requestId, sequence: event.stream.sequence, text: "", status: event.stream.status } };
              onEvent({ type: "report_reset", sessionId: source.sessionId, requestId: source.requestId, version: source.version, sequence: event.stream.sequence, status: event.stream.status });
            }
          }
          continue;
        }
        const delta: ResearchStreamEvent = { type: "report_delta", sessionId: source.sessionId, requestId: source.requestId, version: source.version, sequence: event.sequence, delta: event.delta };
        if (current?.reportStream?.requestId === source.requestId && event.sequence === current.reportStream.sequence + 1) {
          current = { ...current, reportStream: { ...current.reportStream, sequence: event.sequence, text: current.reportStream.text + event.delta } };
        }
        onEvent(delta);
      }
      if (chunk.done) throw new ApiError(502, "RESEARCH_STREAM_INTERRUPTED", null);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
