import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WhiteboardCommandBatch, type WhiteboardCommand, type WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core/validation-worker';
import { WhiteboardCollaborationError, type WhiteboardDeletionChange, type WhiteboardDeletionProof, type ValidatedWhiteboardUpdate, type WhiteboardUpdateValidator } from '../../application/whiteboard/collaboration-ports';
import { ConsoleLogger } from '../logging/console-logger';
import type { WorkerValidationInput } from './update-validator-input';
import { currentOperationTraceId } from '../../application/ports/operation-trace';

type ValidationMode = WorkerValidationInput['mode'];
type DiagnosticContext = { traceId: string; validatorCallId: string; startedAt: number; inputBytes: number; mode?: ValidationMode };
type UnavailableReason = 'queue_capacity' | 'queue_deadline' | 'invalid_deadline' | 'worker_deadline' | 'worker_error' | 'worker_exit';
const diagnosticLogger = new ConsoleLogger();
function diagnosticContext(inputBytes: number, mode?: ValidationMode): DiagnosticContext {
  const validatorCallId = randomUUID();
  return { traceId: currentOperationTraceId() ?? validatorCallId, validatorCallId, startedAt: performance.now(), inputBytes, mode };
}
function unavailable(context: DiagnosticContext, reason: UnavailableReason, extra: { queueElapsedMs?: number; workerElapsedMs?: number; errorCode?: string; exitCode?: number; lastPhase?: string; phaseElapsedMs?: Record<string, number> } = {}) {
  // Never include workerData, stdout/stderr, raw errors or document identifiers.
  try { diagnosticLogger.error('whiteboard_validator_unavailable', { traceId: context.traceId, err: {
    reason, validatorCallId: context.validatorCallId, mode: context.mode, inputBytes: context.inputBytes,
    elapsedMs: Math.max(0, Math.round(performance.now() - context.startedAt)), ...extra,
  } }); } catch { /* Diagnostic sink failure must preserve the validator rejection. */ }
  return new WhiteboardCollaborationError('VALIDATOR_UNAVAILABLE');
}

// 10k document writes clone the Yjs graph: 128 MiB exhausts the worker heap.
// Two 256 MiB workers retain the previous aggregate 512 MiB old-generation cap.
export const WHITEBOARD_VALIDATOR_LIMITS = { vectorBytes: WHITEBOARD_SYNC.stateVectorBytes, commandBytes: 262144, workerHeapMb: 256, timeoutMs: 5000, concurrent: 2, queued: 64, queuedBytes: 64 * 1024 * 1024, queueWaitMs: 10000 } as const;
/** FIFO admission is bounded by count, retained input bytes and waiting time. */
export class WhiteboardValidationQueue {
  private active = 0;
  private bytes = 0;
  private readonly waiting: Array<{ bytes: number; timer: ReturnType<typeof setTimeout>; resolve: (release: () => void) => void }> = [];
  constructor(private readonly limits: { concurrent: number; queued: number; queuedBytes: number; queueWaitMs: number } = WHITEBOARD_VALIDATOR_LIMITS) {}
  async acquire(bytes: number, context: DiagnosticContext = diagnosticContext(bytes)): Promise<() => void> {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
    if (this.active < this.limits.concurrent) { this.active++; return this.releaseHandle(); }
    if (this.waiting.length >= this.limits.queued || this.bytes + bytes > this.limits.queuedBytes) throw unavailable(context, 'queue_capacity');
    return new Promise((resolve, reject) => {
      const entry = { bytes, resolve, timer: setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) { this.waiting.splice(index, 1); this.bytes -= entry.bytes; }
        reject(unavailable(context, 'queue_deadline'));
      }, this.limits.queueWaitMs) };
      this.waiting.push(entry); this.bytes += bytes;
    });
  }
  private releaseHandle(): () => void {
    let released = false;
    return () => {
      if (released) return; released = true; this.active--;
      const entry = this.waiting.shift();
      if (entry) { clearTimeout(entry.timer); this.bytes -= entry.bytes; this.active++; entry.resolve(this.releaseHandle()); }
    };
  }
}
const admission = new WhiteboardValidationQueue();
function assertBytes(value: Uint8Array, max: number): void {
  if (!(value instanceof Uint8Array) || value.byteLength > max) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
}
/** Each invocation gets a fresh, disposable heap. No document state is retained. */
export class WorkerWhiteboardUpdateValidator implements WhiteboardUpdateValidator {
  constructor(private readonly timeoutMs: number = WHITEBOARD_VALIDATOR_LIMITS.timeoutMs) {}
  async compensate(snapshot:Uint8Array,before:Uint8Array):Promise<ValidatedWhiteboardUpdate>{assertBytes(before,WHITEBOARD_UPDATE_LIMITS.documentBytes);return this.run({mode:'compensate',snapshot,before}) as Promise<ValidatedWhiteboardUpdate>;}
  async restoreDeletion(snapshot:Uint8Array,proof:WhiteboardDeletionProof[],changes?:WhiteboardDeletionChange[],inverseUpdate?:Uint8Array):Promise<ValidatedWhiteboardUpdate>{
    if(Buffer.byteLength(JSON.stringify({proof,changes}))>WHITEBOARD_UPDATE_LIMITS.documentBytes)throw new WhiteboardCollaborationError('VALIDATION_FAILED');
    if(inverseUpdate)assertBytes(inverseUpdate,WHITEBOARD_UPDATE_LIMITS.bytes);
    return this.run({mode:'restore-deletion',snapshot,proof,changes,inverseUpdate}) as Promise<ValidatedWhiteboardUpdate>;
  }
  async objects(snapshot: Uint8Array): Promise<WhiteboardObject[]> {
    return this.run({ mode: 'objects', snapshot }) as Promise<WhiteboardObject[]>;
  }
  async objectIds(snapshot: Uint8Array): Promise<string[]> {
    return this.run({ mode: 'object-ids', snapshot }) as Promise<string[]>;
  }
  async validate(snapshot: Uint8Array, update: Uint8Array): Promise<ValidatedWhiteboardUpdate> {
    assertBytes(update, WHITEBOARD_UPDATE_LIMITS.bytes);
    return this.run({ mode: 'update', snapshot, update }) as Promise<ValidatedWhiteboardUpdate>;
  }
  async commands(snapshot: Uint8Array, commands: WhiteboardCommand[]): Promise<ValidatedWhiteboardUpdate> {
    // Input transport must enforce byte limits before JSON parsing as well.
    if (Buffer.byteLength(JSON.stringify(commands)) > WHITEBOARD_VALIDATOR_LIMITS.commandBytes) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
    const parsed = WhiteboardCommandBatch.safeParse(commands);
    if (!parsed.success) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
    return this.run({ mode: 'commands', snapshot, commands: parsed.data }) as Promise<ValidatedWhiteboardUpdate>;
  }
  async diff(snapshot: Uint8Array, vector?: Uint8Array): Promise<Uint8Array> {
    if (vector) assertBytes(vector, WHITEBOARD_VALIDATOR_LIMITS.vectorBytes);
    return this.run({ mode: 'diff', snapshot, vector }) as Promise<Uint8Array>;
  }
  private async run(payload: WorkerValidationInput): Promise<unknown> {
    assertBytes(payload.snapshot, WHITEBOARD_UPDATE_LIMITS.documentBytes);
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1) throw unavailable(diagnosticContext(payload.snapshot.byteLength, payload.mode), 'invalid_deadline');
    const inputBytes = Object.values(payload).reduce<number>((total, value) => total + (value instanceof Uint8Array ? value.byteLength : typeof value === 'object' && value !== undefined ? Buffer.byteLength(JSON.stringify(value)) : 0), 0);
    const context = diagnosticContext(inputBytes, payload.mode);
    const release = await admission.acquire(inputBytes, context);
    const acquiredAt = performance.now();
    let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      worker = new Worker(new URL('./update-validator-worker.ts', import.meta.url), {
        execArgv: ['--import', 'tsx'], workerData: payload,
        resourceLimits: { maxOldGenerationSizeMb: WHITEBOARD_VALIDATOR_LIMITS.workerHeapMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        stdout: true, stderr: true,
      });
      worker.stdout.resume(); worker.stderr.resume();
      return await new Promise((resolve, reject) => {
        let settled = false;
        let lastPhase: string | undefined;
        const phaseElapsedMs: Record<string, number> = {};

        const fail = (reason: UnavailableReason, extra: { errorCode?: string; exitCode?: number } = {}) => {
          if (settled) return; settled = true;
          reject(unavailable(context, reason, { queueElapsedMs: Math.max(0, Math.round(acquiredAt - context.startedAt)), workerElapsedMs: Math.max(0, Math.round(performance.now() - acquiredAt)), ...extra, lastPhase, phaseElapsedMs }));
        };
        timer = setTimeout(() => fail('worker_deadline'), Math.min(this.timeoutMs, WHITEBOARD_VALIDATOR_LIMITS.timeoutMs));
        worker!.on('message', message => {
          if (settled) return;
          if (message && typeof message === 'object' && 'phase' in message) {
            if (Object.keys(message).length === 1 && ['ready', 'snapshot-applied', 'validated'].includes(message.phase)) {
              lastPhase = message.phase;
              phaseElapsedMs[lastPhase!] = Math.max(0, Math.round(performance.now() - acquiredAt));
              return;
            }
            settled = true;
            reject(new WhiteboardCollaborationError('VALIDATION_FAILED'));
            return;
          }
          settled = true;
          if (message && typeof message === 'object' && 'result' in message) resolve(message.result);
          else reject(new WhiteboardCollaborationError('VALIDATION_FAILED'));
        });
        worker!.once('error', error => fail('worker_error', { errorCode: typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'ERR_WORKER_OUT_OF_MEMORY' : 'other' }));
        worker!.once('exit', exitCode => fail('worker_exit', { exitCode }));
      });
    } finally { if (timer) clearTimeout(timer); try { await worker?.terminate(); } finally { release(); } }
  }
}
