import { ResearchRuntimeError } from "./guided-runtime-ports";
export const GUIDED_SEARCH_BUDGET_MS = 180_000;
export const GUIDED_PLAN_BUDGET_MS = 55_000;
export class SearchBudget {
  private readonly abort = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly combinedSignal: AbortSignal;
  constructor(durationMs = GUIDED_SEARCH_BUDGET_MS, reasonCode = "RESEARCH_SEARCH_TIME_BUDGET_EXCEEDED", parent?: AbortSignal) {
    this.combinedSignal = parent ? AbortSignal.any([this.abort.signal, parent]) : this.abort.signal;
    this.timer = setTimeout(() => this.abort.abort(new ResearchRuntimeError(reasonCode)), durationMs);
  }
  get signal() { return this.combinedSignal; }
  check() { this.signal.throwIfAborted(); }
  dispose() { clearTimeout(this.timer); }
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const stop = () => reject(this.signal.reason);
      this.signal.addEventListener("abort", stop, { once: true });
      // Late provider responses have no state or persistence callback to execute.
      Promise.resolve().then(() => { this.check(); return work(); }).then(resolve, reject)
        .finally(() => this.signal.removeEventListener("abort", stop));
    });
  }
}
