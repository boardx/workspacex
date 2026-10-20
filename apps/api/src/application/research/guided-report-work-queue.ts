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
