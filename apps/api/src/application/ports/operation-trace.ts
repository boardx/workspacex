import { AsyncLocalStorage } from 'node:async_hooks';

/** Server-owned correlation only; no credentials, payload or document state. */
const operationTrace = new AsyncLocalStorage<string>();
export function withOperationTrace<T>(traceId: string, work: () => T): T {
  return operationTrace.run(traceId, work);
}
export function currentOperationTraceId(): string | undefined {
  return operationTrace.getStore();
}
