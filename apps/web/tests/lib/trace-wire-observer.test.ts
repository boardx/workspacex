import { afterEach, describe, expect, it, vi } from 'vitest';
import { exactTraceRun, installTraceWireObserver, type TraceWireState } from '../../e2e/support/trace-wire-observer';
import { judgeLiveness } from '../../e2e/support/trace-liveness';
const RUN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const fakePasswordSentinel = 'must-not-retain';
const message = (runId = RUN) => ({ type: 'CUSTOM', name: 'execution_event', value: { runId, seq: 1, kind: 'tool_start', args: { password: fakePasswordSentinel }, result: 'private-user-content' } });
const encode = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
function fixture(chunks: string[]) {
  const response = new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } }));
  const original = vi.fn(async () => response);
  const scope = { fetch: original as typeof fetch, location: { origin: 'https://fixture.invalid' }, __traceWire: undefined as TraceWireState | undefined, __stopTraceWire: undefined as (() => void) | undefined };
  vi.stubGlobal('window', scope);
  installTraceWireObserver();
  return { scope, original };
}
afterEach(() => { (globalThis as unknown as { window?: { __stopTraceWire?: () => void } }).window?.__stopTraceWire?.(); vi.unstubAllGlobals(); });
async function consume(scope: ReturnType<typeof fixture>['scope'], path = '/api/copilotkit/agent/default/run') {
  const response = await scope.fetch(path, { method: 'POST' });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder(); let body = '';
  while (true) { const chunk = await reader.read(); if (chunk.done) break; body += decoder.decode(chunk.value, { stream: true }); }
  reader.releaseLock();
  await vi.waitFor(() => expect(scope.__traceWire?.records.some(r => r.kind === 'stream-end') || scope.__traceWire?.overflow || scope.__traceWire?.error || scope.__traceWire?.requests === 0).toBe(true));
  return body;
}
describe('exact response run metadata', () => {
  it('binds durable CUSTOM run, not AGUI correlation; keeps original bytes and removes values', async () => {
    const source = encode({ type: 'RUN_STARTED', runId: OTHER }) + encode({ type: 'CUSTOM', name: 'chat_thread_id', value: 'private-thread-id' }) + encode(message()) + encode({ type: 'RUN_FINISHED', runId: OTHER });
    const { scope, original } = fixture([source.slice(0, 13), source.slice(13)]);
    expect(await consume(scope)).toBe(source);
    expect(exactTraceRun(scope.__traceWire!)).toBe(RUN);
    expect(scope.__traceWire!.threadGeneration).toBe(1);
    expect(scope.__traceWire!.hookGeneration).toBeNull();
    const safe = JSON.stringify(scope.__traceWire);
    for (const secret of [fakePasswordSentinel, 'private-user-content', 'private-thread-id', OTHER, 'password']) expect(safe).not.toContain(secret);
    scope.__stopTraceWire!(); expect(scope.fetch).toBe(original);
  });
  it('cannot substitute client run id or accept two durable runs', async () => {
    let f = fixture([encode({ type: 'RUN_STARTED', runId: RUN })]);
    await consume(f.scope); expect(exactTraceRun(f.scope.__traceWire!)).toBeNull();
    f.scope.__stopTraceWire!();
    f = fixture([encode(message()) + encode(message(OTHER))]);
    await consume(f.scope); expect(exactTraceRun(f.scope.__traceWire!)).toBeNull();
  });
  it('ignores unrelated origin and endpoint even with run-shaped content', async () => {
    for (const path of ['https://other.invalid/api/copilotkit/agent/default/run', '/api/copilotkit/agent/default/run-extra']) {
      const f = fixture([encode(message())]); await consume(f.scope, path);
      expect(f.scope.__traceWire!.requests).toBe(0); expect(exactTraceRun(f.scope.__traceWire!)).toBeNull(); f.scope.__stopTraceWire!();
    }
  });
  it('caps records and rejects incomplete metadata without printing malformed content', async () => {
    const f = fixture(Array.from({ length: 2050 }, () => encode(message())));
    await consume(f.scope); expect(f.scope.__traceWire!.records.length).toBeLessThanOrEqual(2048);
    expect(f.scope.__traceWire!.overflow).toBe(true); expect(exactTraceRun(f.scope.__traceWire!)).toBeNull();
    f.scope.__stopTraceWire!();
    const bad = fixture(['data: {"private":"must-not-retain"\n\n']);
    await consume(bad.scope); expect(bad.scope.__traceWire!.error).toBe(true);
    expect(JSON.stringify(bad.scope.__traceWire)).not.toContain('must-not-retain');
  });
  it('a live historical/other panel cannot satisfy the actual response run', async () => {
    const f = fixture([encode(message())]); await consume(f.scope);
    const run = exactTraceRun(f.scope.__traceWire!);
    const samples = [{ at: 10, counts: { [OTHER]: 4 }, total: 4 }];
    expect(judgeLiveness(samples, {}, OTHER, 1, 20).live).toBe(true);
    expect(judgeLiveness(samples, {}, run, 1, 20).live).toBe(false);
  });
  it('does not advance a slow consumer and preserves response, cancel, release and restore', async () => {
    let pulls = 0; const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      pulls++; controller.enqueue(new TextEncoder().encode(encode(message())));
    }, cancel }, { highWaterMark: 0 });
    const response = new Response(body, { status: 201, headers: { 'x-fixture': 'yes' } });
    const originalGetReader = body.getReader; const originalClone = response.clone;
    const scope = { fetch: vi.fn(async () => response) as typeof fetch, location: { origin: 'https://fixture.invalid' }, __traceWire: undefined as TraceWireState | undefined, __stopTraceWire: undefined as (() => void) | undefined };
    vi.stubGlobal('window', scope); installTraceWireObserver();
    expect(await scope.fetch('/api/copilotkit/agent/default/run', { method: 'POST' })).toBe(response);
    expect(response.status).toBe(201); expect(response.headers.get('x-fixture')).toBe('yes'); expect(response.clone).toBe(originalClone);
    await new Promise(resolve => setTimeout(resolve, 10)); expect(pulls).toBe(0);
    const reader = body.getReader();
    await new Promise(resolve => setTimeout(resolve, 10)); expect(pulls).toBe(0);
    await reader.read(); expect(pulls).toBe(1); expect(exactTraceRun(scope.__traceWire!)).toBe(RUN);
    await new Promise(resolve => setTimeout(resolve, 10)); expect(pulls).toBe(1);
    await reader.cancel('original-reason'); expect(cancel).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledWith('original-reason');
    reader.releaseLock(); expect(body.locked).toBe(false);
    scope.__stopTraceWire!(); expect(body.getReader).toBe(originalGetReader);
  });
  it('passes BYOB mode and application read rejection through unchanged', async () => {
    const failure = new Error('application-error-not-retained');
    const body = new ReadableStream<Uint8Array>({ type: 'bytes', pull(controller) { controller.error(failure); } });
    const response = new Response(body);
    const scope = { fetch: vi.fn(async () => response) as typeof fetch, location: { origin: 'https://fixture.invalid' }, __traceWire: undefined as TraceWireState | undefined, __stopTraceWire: undefined as (() => void) | undefined };
    vi.stubGlobal('window', scope); installTraceWireObserver();
    await scope.fetch('/api/copilotkit/agent/default/run', { method: 'POST' });
    const reader = body.getReader({ mode: 'byob' });
    await expect(reader.read(new Uint8Array(1024))).rejects.toBe(failure);
    expect(scope.__traceWire!.error).toBe(true); expect(JSON.stringify(scope.__traceWire)).not.toContain(failure.message);
    reader.releaseLock();
  });
  it('never accepts multiple matching requests', () => {
    const f = fixture([]); const state = f.scope.__traceWire!;
    state.requests = 2; state.records.push({ requestOrdinal: 1, at: 1, kind: 'tool_start', runId: RUN, seq: 0 });
    expect(exactTraceRun(state)).toBeNull();
  });
});
