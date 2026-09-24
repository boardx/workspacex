import type { LoggerPort } from '../ports/logger.port';

export const WHITEBOARD_OBSERVABILITY = Symbol('WhiteboardObservability');

export type WhiteboardRejectReason =
  | 'access' | 'archive' | 'dependency' | 'limit' | 'protocol' | 'stale' | 'validation';
export type WhiteboardMetricOutcome = 'accepted' | 'rejected' | 'error';
export type WhiteboardTraceEvent = 'upgrade' | 'reject' | 'update';

/** Low-cardinality sink. No method accepts a board, organization, user or content value. */
export interface WhiteboardObservability {
  connection(delta: 1 | -1): void;
  reconnect(): void;
  reject(reason: WhiteboardRejectReason): void;
  validatorState(active: number, queued: number): void;
  validatorReady(maxQueued: number): boolean;
  update(outcome: WhiteboardMetricOutcome, elapsedMs: number): void;
  validation(outcome: WhiteboardMetricOutcome, elapsedMs: number): void;
  persisted(outcome: WhiteboardMetricOutcome, elapsedMs: number): void;
  compaction(outcome: WhiteboardMetricOutcome): void;
  trace(logger: LoggerPort | undefined, traceId: string, event: WhiteboardTraceEvent,
    fields: { readonly outcome: WhiteboardMetricOutcome; readonly reason?: WhiteboardRejectReason; readonly elapsedMs?: number }): void;
  prometheus(): string;
}

/** Adapter default for isolated gateway/store tests; production DI always supplies the process sink. */
export const NOOP_WHITEBOARD_OBSERVABILITY: WhiteboardObservability = {
  connection: () => undefined, reconnect: () => undefined, reject: () => undefined,
  validatorState: () => undefined, validatorReady: () => true,
  update: () => undefined, validation: () => undefined, persisted: () => undefined, compaction: () => undefined,
  trace: () => undefined, prometheus: () => '',
};

export function whiteboardRejectReason(code: string): WhiteboardRejectReason {
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND' || code === 'PERMISSION_CHANGED') return 'access';
  if (code === 'ARCHIVED') return 'archive';
  if (code === 'STALE_EPOCH') return 'stale';
  if (code === 'VALIDATION_FAILED') return 'validation';
  if (code.includes('PROTOCOL') || code === 'HELLO_REQUIRED') return 'protocol';
  if (code.includes('LIMIT') || code === 'VALIDATOR_UNAVAILABLE' || code === 'RATE_LIMITED') return 'limit';
  return 'dependency';
}
