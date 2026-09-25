import { Worker } from 'node:worker_threads';
import { WhiteboardCommandBatch, type WhiteboardCommand, type WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import { WhiteboardCollaborationError, type ValidatedWhiteboardUpdate, type WhiteboardUpdateValidator } from '../../application/whiteboard/collaboration-ports';
import type { WhiteboardObservability } from '../../application/whiteboard/observability';
import { WHITEBOARD_SCALE_POLICY } from '../../domain/whiteboard-scale-policy';
import { ProcessWhiteboardObservability } from './observability';

export const WHITEBOARD_VALIDATOR_LIMITS = {
  vectorBytes: WHITEBOARD_SCALE_POLICY.update.stateVectorBytes,
  commandBytes: WHITEBOARD_SCALE_POLICY.update.commandsEncodedBytes,
  workerHeapMb: WHITEBOARD_SCALE_POLICY.validator.workerHeapMb,
  timeoutMs: WHITEBOARD_SCALE_POLICY.validator.workerTimeoutMs,
  concurrent: WHITEBOARD_SCALE_POLICY.validator.workers,
  queued: WHITEBOARD_SCALE_POLICY.validator.queuedJobs,
  queuedBytes: WHITEBOARD_SCALE_POLICY.validator.queuedBytes,
  queueWaitMs: WHITEBOARD_SCALE_POLICY.validator.queueWaitMs,
} as const;
/** FIFO admission is bounded by count, retained input bytes and waiting time. */
export class WhiteboardValidationQueue {
  private active = 0;
  private bytes = 0;
  private readonly waiting: Array<{ bytes: number; timer: ReturnType<typeof setTimeout>; resolve: (release: () => void) => void }> = [];
  constructor(private readonly limits: { concurrent: number; queued: number; queuedBytes: number; queueWaitMs: number } = WHITEBOARD_VALIDATOR_LIMITS,
    private readonly observe: (active: number, queued: number) => void = () => undefined) {}
  async acquire(bytes: number): Promise<() => void> {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
    if (this.active < this.limits.concurrent) { this.active++; this.emit(); return this.releaseHandle(); }
    if (this.waiting.length >= this.limits.queued || this.bytes + bytes > this.limits.queuedBytes) throw new WhiteboardCollaborationError('VALIDATOR_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      const entry = { bytes, resolve, timer: setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) { this.waiting.splice(index, 1); this.bytes -= entry.bytes; this.emit(); }
        reject(new WhiteboardCollaborationError('VALIDATOR_UNAVAILABLE'));
      }, this.limits.queueWaitMs) };
      this.waiting.push(entry); this.bytes += bytes; this.emit();
    });
  }
  private emit(): void { this.observe(this.active, this.waiting.length); }
  private releaseHandle(): () => void {
    let released = false;
    return () => {
      if (released) return; released = true; this.active--;
      const entry = this.waiting.shift();
      if (entry) { clearTimeout(entry.timer); this.bytes -= entry.bytes; this.active++; entry.resolve(this.releaseHandle()); }
      this.emit();
    };
  }
}
function assertBytes(value: Uint8Array, max: number): void {
  if (!(value instanceof Uint8Array) || value.byteLength > max) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
}
/** Each invocation gets a fresh, disposable heap. No document state is retained. */
export class WorkerWhiteboardUpdateValidator implements WhiteboardUpdateValidator {
  private readonly admission: WhiteboardValidationQueue;
  constructor(private readonly timeoutMs: number = WHITEBOARD_VALIDATOR_LIMITS.timeoutMs,
    private readonly metrics: WhiteboardObservability = new ProcessWhiteboardObservability()) {
    this.admission = new WhiteboardValidationQueue(WHITEBOARD_VALIDATOR_LIMITS,
      (active, queued) => this.metrics.validatorState(active, queued));
  }
  async objects(snapshot: Uint8Array): Promise<WhiteboardObject[]> {
    return this.run({ mode: 'objects', snapshot }) as Promise<WhiteboardObject[]>;
  }
  async objectIds(snapshot: Uint8Array): Promise<string[]> {
    return this.run({ mode: 'object-ids', snapshot }) as Promise<string[]>;
  }
  async validate(snapshot: Uint8Array, update: Uint8Array, actorId?: string): Promise<ValidatedWhiteboardUpdate> {
    assertBytes(update, WHITEBOARD_UPDATE_LIMITS.bytes);
    return this.run({ mode: 'update', snapshot, update, actorId }) as Promise<ValidatedWhiteboardUpdate>;
  }
  async commands(snapshot: Uint8Array, commands: WhiteboardCommand[], actorId?: string): Promise<ValidatedWhiteboardUpdate> {
    // Input transport must enforce byte limits before JSON parsing as well.
    if (Buffer.byteLength(JSON.stringify(commands)) > WHITEBOARD_VALIDATOR_LIMITS.commandBytes) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
    const parsed = WhiteboardCommandBatch.safeParse(commands);
    if (!parsed.success) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
    return this.run({ mode: 'commands', snapshot, commands: parsed.data, actorId }) as Promise<ValidatedWhiteboardUpdate>;
  }
  async diff(snapshot: Uint8Array, vector?: Uint8Array): Promise<Uint8Array> {
    if (vector) assertBytes(vector, WHITEBOARD_VALIDATOR_LIMITS.vectorBytes);
    return this.run({ mode: 'diff', snapshot, vector }) as Promise<Uint8Array>;
  }
  private async run(payload: { snapshot: Uint8Array; [key: string]: unknown }): Promise<unknown> {
    assertBytes(payload.snapshot, WHITEBOARD_UPDATE_LIMITS.documentBytes);
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1) throw new WhiteboardCollaborationError('VALIDATOR_UNAVAILABLE');
    const inputBytes = Object.values(payload).reduce<number>((total, value) => total + (value instanceof Uint8Array ? value.byteLength : typeof value === 'object' && value !== undefined ? Buffer.byteLength(JSON.stringify(value)) : 0), 0);
    const started = performance.now();
    let outcome: 'accepted' | 'rejected' | 'error' = 'error';
    const release = await this.admission.acquire(inputBytes).catch(error => {
      this.metrics.reject('limit'); this.metrics.validation('rejected', performance.now() - started); throw error;
    });
    let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      worker = new Worker(new URL('./update-validator-worker.ts', import.meta.url), {
        execArgv: ['--import', 'tsx'], workerData: payload,
        resourceLimits: { maxOldGenerationSizeMb: WHITEBOARD_VALIDATOR_LIMITS.workerHeapMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        stdout: true, stderr: true,
      });
      worker.stdout.resume(); worker.stderr.resume();
      const result = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new WhiteboardCollaborationError('VALIDATOR_UNAVAILABLE')), Math.min(this.timeoutMs, WHITEBOARD_VALIDATOR_LIMITS.timeoutMs));
        worker!.once('message', message => {
          if (message && typeof message === 'object' && 'result' in message) resolve(message.result);
          else reject(new WhiteboardCollaborationError('VALIDATION_FAILED'));
        });
        worker!.once('error', () => reject(new WhiteboardCollaborationError('VALIDATOR_UNAVAILABLE')));
        worker!.once('exit', () => reject(new WhiteboardCollaborationError('VALIDATOR_UNAVAILABLE')));
      });
      outcome = 'accepted'; return result;
    } catch (error) {
      outcome = error instanceof WhiteboardCollaborationError && error.code === 'VALIDATION_FAILED' ? 'rejected' : 'error';
      throw error;
    } finally {
      this.metrics.validation(outcome, performance.now() - started);
      if (timer) clearTimeout(timer); try { await worker?.terminate(); } finally { release(); }
    }
  }
}
