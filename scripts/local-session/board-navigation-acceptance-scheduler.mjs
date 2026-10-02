export function createAcceptanceRequestScheduler({ intervalMs = 1000, now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let tail = Promise.resolve(), lastDispatch = -Infinity;
  const statistics = { intervalMs, requestCount: 0, throttleWaitMs: 0, actualMinDispatchSpacingMs: null };
  return {
    statistics,
    run(task) {
      const result = tail.then(async () => {
        let delay = Math.max(0, lastDispatch + intervalMs - now());
        const waitStarted = now();
        while (delay > 0) {
          await wait(delay);
          delay = Math.max(0, lastDispatch + intervalMs - now());
        }
        const dispatched = now(); statistics.throttleWaitMs += dispatched - waitStarted;
        if (Number.isFinite(lastDispatch)) statistics.actualMinDispatchSpacingMs = Math.min(statistics.actualMinDispatchSpacingMs ?? Infinity, dispatched - lastDispatch);
        lastDispatch = dispatched; statistics.requestCount++;
        return task();
      });
      tail = result.catch(() => {});
      return result;
    },
  };
}
