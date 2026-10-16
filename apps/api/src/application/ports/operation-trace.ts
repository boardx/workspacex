import { AsyncLocalStorage } from 'node:async_hooks';

/** Server-owned correlation only; no credentials, payload or document state. */
const operationTrace = new AsyncLocalStorage<string | undefined>();
export function withOperationTrace<T>(traceId: string, work: () => T): T {
  return operationTrace.run(traceId, work);
}
export function currentOperationTraceId(): string | undefined {
  return operationTrace.getStore();
}
/** A queue may drain under another operation. Restore the producer's trace, including absence. */
export function bindOperationTrace<T>(work: () => T): () => T {
  const traceId = operationTrace.getStore();
  return () => operationTrace.run(traceId, work);
}
