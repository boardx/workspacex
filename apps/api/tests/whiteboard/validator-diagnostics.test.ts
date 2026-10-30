import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ConsoleLogger } from '../../src/infrastructure/logging/console-logger';
import { WorkerWhiteboardUpdateValidator, WhiteboardValidationQueue, WHITEBOARD_VALIDATOR_LIMITS } from '../../src/infrastructure/whiteboard/update-validator';

const fake = vi.hoisted(() => ({
  instances: [] as Array<{ emit: (event: string, ...args: unknown[]) => boolean; terminate: ReturnType<typeof vi.fn>; options: { resourceLimits: { maxOldGenerationSizeMb: number } } }>,
}));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    stdout = { resume: vi.fn() }; stderr = { resume: vi.fn() };
    terminate = vi.fn(async () => { this.emit('exit', 1); return 1; });
    constructor(_url: unknown, readonly options: { resourceLimits: { maxOldGenerationSizeMb: number } }) { super(); fake.instances.push(this); }
  } };
});
let logs: MockInstance<ConsoleLogger['error']>;
const work: Promise<unknown>[] = [];
function run(validator = new WorkerWhiteboardUpdateValidator()) {
  const promise = validator.diff(new Uint8Array([0, 0]));
  work.push(promise); void promise.catch(() => undefined);
  return promise;
}
function detail() {
  expect(logs).toHaveBeenCalledTimes(1);
  const [name, fields] = logs.mock.calls[0]!;
  expect(name).toBe('whiteboard_validator_unavailable');
  expect(fields.traceId).toMatch(/^[0-9a-f-]{36}$/);
  const error = fields.err as Record<string, unknown>;
  expect(error.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(error.inputBytes).toBeGreaterThanOrEqual(0);
  return error;
}
beforeEach(() => { fake.instances.length = 0; work.length = 0; logs = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined); });
afterEach(async () => {
  for (const worker of fake.instances) worker.emit('exit', 1);
  await Promise.allSettled(work);
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe('safe validator failure diagnostics without changing admission or public codes', () => {
  it('distinguishes queue capacity rejection and keeps FIFO capacity available', async () => {
    const queue = new WhiteboardValidationQueue({ concurrent: 1, queued: 0, queuedBytes: 0, queueWaitMs: 100 });
    const release = await queue.acquire(2);
    try { await expect(queue.acquire(4)).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE', message: 'VALIDATOR_UNAVAILABLE' }); }
    finally { release(); }
    expect(detail()).toMatchObject({ reason: 'queue_capacity', inputBytes: 4 });
    (await queue.acquire(2))();
  });
  it('distinguishes queue wait expiry and releases queued byte/count budgets', async () => {
    vi.useFakeTimers();
    const queue = new WhiteboardValidationQueue({ concurrent: 1, queued: 1, queuedBytes: 4, queueWaitMs: 25 });
    const release = await queue.acquire(2), waiting = queue.acquire(4);
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(26); await rejected;
    expect(detail()).toMatchObject({ reason: 'queue_deadline', inputBytes: 4 });
    release(); (await queue.acquire(4))();
  });
  it('retains the hard worker deadline, joins termination and does not log teardown exit as another failure', async () => {
    vi.useFakeTimers();
    const pending = run(new WorkerWhiteboardUpdateValidator(WHITEBOARD_VALIDATOR_LIMITS.timeoutMs * 2));
    const rejected = expect(pending).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
    await Promise.resolve();
    let finishTermination!: () => void, completed = false;
    fake.instances[0]!.terminate.mockImplementation(() => new Promise<number>(resolve => { finishTermination = () => resolve(1); }));
    void pending.then(() => { completed = true; }, () => { completed = true; });
    await vi.advanceTimersByTimeAsync(WHITEBOARD_VALIDATOR_LIMITS.timeoutMs + 1);
    expect(completed).toBe(false);
    finishTermination(); await rejected;
    expect(detail()).toMatchObject({ reason: 'worker_deadline', mode: 'diff', inputBytes: 2 });
    expect(fake.instances[0]!.options.resourceLimits.maxOldGenerationSizeMb).toBe(WHITEBOARD_VALIDATOR_LIMITS.workerHeapMb);
    expect(fake.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });
  it.each(['ERR_WORKER_OUT_OF_MEMORY', 'PRIVATE_DOCUMENT_SECRET'])('logs only allowlisted worker error codes: %s', async code => {
    const pending = run(); await Promise.resolve();
    fake.instances[0]!.emit('error', Object.assign(new Error('PRIVATE_DOCUMENT_SECRET'), { code }));
    await expect(pending).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE', message: 'VALIDATOR_UNAVAILABLE' });
    expect(detail()).toMatchObject({ reason: 'worker_error', mode: 'diff', errorCode: code === 'ERR_WORKER_OUT_OF_MEMORY' ? code : 'other' });
    expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE_DOCUMENT_SECRET');
    expect(fake.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1])('distinguishes exit before result, including exit %s', async exitCode => {
    const pending = run(); await Promise.resolve(); fake.instances[0]!.emit('exit', exitCode);
    await expect(pending).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
    expect(detail()).toMatchObject({ reason: 'worker_exit', exitCode });
  });
  it.each([null, 'PRIVATE_DOCUMENT_SECRET'])('handles non-Error worker exceptions without leaking or throwing from the listener: %s', async error => {
    const pending = run(); await Promise.resolve(); fake.instances[0]!.emit('error', error);
    await expect(pending).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
    expect(detail()).toMatchObject({ reason: 'worker_error', errorCode: 'other' });
    expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE_DOCUMENT_SECRET');
  });
  it('preserves public rejection and cleanup when the diagnostic sink fails', async () => {
    logs.mockImplementation(() => { throw new Error('PRIVATE_DOCUMENT_SECRET'); });
    const pending = run(); await Promise.resolve(); fake.instances[0]!.emit('exit', 1);
    await expect(pending).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
    expect(fake.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });
  it('reports command byte counts without retaining document text or payload', async () => {
    const pending = new WorkerWhiteboardUpdateValidator().commands(new Uint8Array([0, 0]), [{ type: 'create', object: {
      id: 'private-object', schemaVersion: 1, kind: 'sticky', text: 'PRIVATE_DOCUMENT_SECRET', style: {}, parentId: null, orderKey: '',
      geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    } }]);
    work.push(pending); void pending.catch(() => undefined);
    await Promise.resolve(); fake.instances[0]!.emit('exit', 1);
    await expect(pending).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
    expect(detail()).toMatchObject({ reason: 'worker_exit', mode: 'commands' });
    expect(detail().inputBytes).toBeGreaterThan(2);
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/PRIVATE_DOCUMENT_SECRET|private-object|workerData|snapshot/);
  });
  it('keeps valid results and malformed-message rejection free of false unavailable diagnostics', async () => {
    const valid = run(); await Promise.resolve(); fake.instances[0]!.emit('message', { result: new Uint8Array([0, 0]) });
    await expect(valid).resolves.toEqual(new Uint8Array([0, 0]));
    const invalid = run(); await Promise.resolve(); fake.instances[1]!.emit('message', { private: 'PRIVATE_DOCUMENT_SECRET' });
    await expect(invalid).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(logs).not.toHaveBeenCalled();
    for (const worker of fake.instances) expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});

it('waits through progress and retains safe phase timing on timeout', async () => {
  vi.useFakeTimers();
  const pending = run();
  const rejected = expect(pending).rejects.toMatchObject({ code: 'VALIDATOR_UNAVAILABLE' });
  await Promise.resolve();
  fake.instances[0]!.emit('message', { phase: 'ready' });
  fake.instances[0]!.emit('message', { phase: 'snapshot-applied' });
  await vi.advanceTimersByTimeAsync(5001);
  await rejected;
  expect(detail()).toMatchObject({ reason: 'worker_deadline', lastPhase: 'snapshot-applied' });
});
it('does not accept an unknown progress phase as a result', async () => {
  const pending = run(); await Promise.resolve();
  fake.instances[0]!.emit('message', { phase: 'private-secret', result: true });
  await expect(pending).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});

it('waits through all known phases for a final rejection', async () => {
  const pending = run(); await Promise.resolve();
  for (const phase of ['ready', 'snapshot-applied', 'validated']) fake.instances[0]!.emit('message', { phase });
  fake.instances[0]!.emit('message', { rejected: true });
  await expect(pending).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(logs).not.toHaveBeenCalled();
});
it('keeps product service barrels outside the worker dependency graph', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve, dirname } = await import('node:path');
  const root = resolve('../../packages/whiteboard-core/src');
  const visited = new Set<string>();
  async function visit(path: string): Promise<void> {
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, 'utf8');
    expect(source).not.toMatch(/from ['"]@repo\/whiteboard-core['"]/);
    for (const match of source.matchAll(/(?:from|export\s*\*)\s*['"](\.\/[^'"]+)['"]/g)) {
      await visit(resolve(dirname(path), match[1] + '.ts'));
    }
  }
  await visit(resolve(root, 'validation-worker.ts'));
  for (const module of ['index', 'ai-proposal', 'presentation', 'artifact-handoff', 'operation-kernel', 'collaboration', 'import-mapping']) {
    expect(visited.has(resolve(root, module + '.ts'))).toBe(false);
  }
});
