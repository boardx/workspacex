import { SearchBudget, GUIDED_REPORT_MODEL_BUDGET_MS } from "./guided-search-budget";

/** One request quota shared by evidence, prose and review, including retries.
 * Permits cover external calls only; never hold a permit while awaiting another.
 */
export function reportWorkQueue(limit = 4) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid report concurrency");
  let active = 0;
  const pending: Array<() => void> = [];
  const drain = () => { while (active < limit && pending.length) pending.shift()!(); };
  return {
    run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const abort = () => {
          const index = pending.indexOf(start);
          if (index >= 0) pending.splice(index, 1);
          reject(signal!.reason);
        };
        const start = () => {
          signal?.removeEventListener("abort", abort);
          if (signal?.aborted) { reject(signal.reason); return; }
          active++;
          Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; drain(); });
        };
        if (signal?.aborted) { reject(signal.reason); return; }
        signal?.addEventListener("abort", abort, { once: true });
        pending.push(start); drain();
      });
    },
  };
}

/** Provider time begins at admission. A timeout rejects the caller without
 * releasing its permit before the actual (possibly abort-ignoring) request ends.
 */
export async function queuedReportRequest<T>(queue: ReturnType<typeof reportWorkQueue>, work: (budget: SearchBudget) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let admit!: (budget: SearchBudget) => void;
  let rejectAdmission!: (error: unknown) => void;
  const admitted = new Promise<SearchBudget>((resolve, reject) => { admit = resolve; rejectAdmission = reject; });
  const request = queue.run(async () => {
    const budget = new SearchBudget(GUIDED_REPORT_MODEL_BUDGET_MS, "RESEARCH_REPORT_MODEL_TIME_BUDGET_EXCEEDED", signal);
    try {
      budget.check();
      admit(budget);
      return await work(budget);
    }
    finally { budget.dispose(); }
  }, signal);
  // Parent cancellation may reject a queued request before any budget exists.
  // Keep this handler even after admission to consume late provider rejection.
  void request.catch(rejectAdmission);
  const budget = await admitted;
  try { return await budget.run(() => request); }
  finally { budget.dispose(); }
}
