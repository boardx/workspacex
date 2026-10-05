import { ResearchRuntimeError } from "./guided-runtime-ports";
export const GUIDED_PLAN_BUDGET_MS = 55_000;
export const GUIDED_REPORT_MODEL_BUDGET_MS = 90_000;
export const GUIDED_SEARCH_CALL_BUDGET_MS = 45_000;
export const GUIDED_READ_CALL_BUDGET_MS = 10_000;
export class SearchBudget {
  private readonly abort = new AbortController();
  private readonly timer?: ReturnType<typeof setTimeout>;
  private callDuration?: number;
  private callReason = "RESEARCH_SOURCE_MODEL_TIMEOUT";
  private readonly combinedSignal: AbortSignal;
  constructor(durationMs: number | null = GUIDED_REPORT_MODEL_BUDGET_MS, reasonCode = "RESEARCH_SOURCE_MODEL_TIMEOUT", parent?: AbortSignal) {
    this.combinedSignal = parent ? AbortSignal.any([this.abort.signal, parent]) : this.abort.signal;
    if (durationMs !== null) this.timer = setTimeout(() => this.abort.abort(new ResearchRuntimeError(reasonCode)), durationMs);
  }
  /** Execution lifetime is cancellation-only; every external call has its own
   * finite timer. Queueing and prior successful calls consume no later budget. */
  static perCall(durationMs = GUIDED_REPORT_MODEL_BUDGET_MS, reasonCode = "RESEARCH_SOURCE_MODEL_TIMEOUT", parent?: AbortSignal) {
    const scope = new SearchBudget(null, reasonCode, parent);
    scope.callDuration = durationMs; scope.callReason = reasonCode;
    return scope;
  }
  get signal() { return this.combinedSignal; }
  check() { this.signal.throwIfAborted(); }
  dispose() { clearTimeout(this.timer); }
  async run<T>(work: (signal: AbortSignal) => Promise<T>, durationMs = this.callDuration, reasonCode = this.callReason, parent?: AbortSignal): Promise<T> {
    this.check(); parent?.throwIfAborted();
    const child = durationMs === undefined ? undefined : new SearchBudget(durationMs, reasonCode, this.signal);
    const ownSignal = child?.signal ?? this.signal;
    const signal = parent ? AbortSignal.any([ownSignal, parent]) : ownSignal;
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener("abort", stop); child?.dispose(); };
      const stop = () => { cleanup(); reject(signal.reason); };
      signal.addEventListener("abort", stop, { once: true });
      // Late provider responses have no state or persistence callback to execute.
      Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal); }).then(
        value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
}
