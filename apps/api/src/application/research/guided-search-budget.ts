import { ResearchRuntimeError } from "./guided-runtime-ports";
export const GUIDED_SEARCH_BUDGET_MS = 180_000;
export class SearchBudget {
  private readonly abort = new AbortController();
  private readonly timer = setTimeout(() => this.abort.abort(new ResearchRuntimeError("RESEARCH_SEARCH_TIME_BUDGET_EXCEEDED")), GUIDED_SEARCH_BUDGET_MS);
  get signal() { return this.abort.signal; }
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
