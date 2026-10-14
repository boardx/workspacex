/** Test-only metadata observer. Never retains request bodies, headers or event values. */
export type TraceWireRecord = {
  requestOrdinal: number; at: number; kind: string; runId?: string; seq?: number;
  observedThreadGeneration?: number;
};
export type TraceWireState = {
  records: TraceWireRecord[]; requests: number; overflow: boolean; error: boolean;
  threadGeneration: number; hookGeneration: null; anchorSelection: null;
};

/** Standalone for page.evaluate: no module closure, no product instrumentation. */
export function installTraceWireObserver(): void {
  const scope = window as unknown as { fetch: typeof fetch; location: Location; __traceWire: TraceWireState; __stopTraceWire?: () => void };
  scope.__stopTraceWire?.();
  const original = scope.fetch;
  const state: TraceWireState = { records: [], requests: 0, overflow: false, error: false, threadGeneration: 0, hookGeneration: null, anchorSelection: null };
  scope.__traceWire = state;
  let active = true;
  let lastThread: string | null = null;
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const record = (value: TraceWireRecord) => {
    if (!active) return;
    if (state.records.length >= 2048) { state.overflow = true; return; }
    state.records.push(value);
  };
  const wrapped: typeof fetch = async (input, init) => {
    const response = await original.call(scope, input, init);
    let matches = false;
    try {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), scope.location.origin);
      matches = (init?.method ?? request?.method ?? 'GET').toUpperCase() === 'POST'
        && url.origin === scope.location.origin && /^\/api\/copilotkit\/agent\/[^/]+\/run$/.test(url.pathname);
    } catch { /* No input or URL is retained. */ }
    if (!active || !matches) return response;
    const requestOrdinal = ++state.requests;
    record({ requestOrdinal, at: Date.now(), kind: 'response-headers' });
    // Reading a clone leaves the original stream and application timing contract intact.
    // Bounded diagnostics may be incomplete; overflow is explicitly not admissible evidence.
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try { reader = response.clone().body!.getReader(); }
    catch { state.error = true; return response; }
    readers.add(reader);
    void (async () => {
      let pending = ''; let bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (active) {
          const chunk = await reader.read();
          if (chunk.done) { record({ requestOrdinal, at: Date.now(), kind: 'stream-end' }); break; }
          bytes += chunk.value.byteLength;
          if (bytes > 2 * 1024 * 1024) { state.overflow = true; break; }
          pending += decoder.decode(chunk.value, { stream: true });
          if (pending.length > 65536) { state.overflow = true; break; }
          let end: number;
          while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
            if (!line.startsWith('data:')) continue;
            let event: Record<string, unknown>;
            try { event = JSON.parse(line.slice(5)); } catch { state.error = true; continue; }
            if (!event || typeof event !== 'object') { state.error = true; continue; }
            if (event.type === 'CUSTOM' && event.name === 'execution_event') {
              const value = event.value as Record<string, unknown> | null;
              const kinds = ['status', 'text_delta', 'final_message', 'tool_start', 'tool_end', 'tool_progress', 'skill_activity', 'progress'];
              if (value && typeof value.runId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.runId)
                && typeof value.kind === 'string' && Number.isSafeInteger(value.seq) && Number(value.seq) >= 0) {
                record({ requestOrdinal, at: Date.now(), kind: kinds.includes(value.kind) ? value.kind : 'other-execution-kind', runId: value.runId, seq: Number(value.seq) });
              } else state.error = true;
            } else if (event.type === 'CUSTOM' && event.name === 'chat_thread_id' && typeof event.value === 'string') {
              if (lastThread !== event.value) { lastThread = event.value; state.threadGeneration += 1; }
              record({ requestOrdinal, at: Date.now(), kind: 'thread-observed', observedThreadGeneration: state.threadGeneration });
            } else if (event.type === 'RUN_STARTED' || event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') {
              // AGUI runId is client correlation, NOT the durable execution run.
              record({ requestOrdinal, at: Date.now(), kind: event.type });
            }
          }
        }
      } catch { if (active) state.error = true; }
      finally { readers.delete(reader); void reader.cancel().catch(() => {}); }
    })();
    return response;
  };
  scope.fetch = wrapped;
  scope.__stopTraceWire = () => {
    active = false;
    if (scope.fetch === wrapped) scope.fetch = original;
    for (const reader of readers) void reader.cancel().catch(() => {});
    readers.clear();
  };
}

export function exactTraceRun(state: TraceWireState): string | null {
  if (state.error || state.overflow || state.requests !== 1) return null;
  const runs = [...new Set(state.records.filter(row => row.requestOrdinal === 1 && row.runId).map(row => row.runId!))];
  return runs.length === 1 ? runs[0]! : null;
}
