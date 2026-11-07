import { DEFAULT_RUN_POLL_INTERVAL_MS } from './poll-budget';
/** Keep the durable run cancellation checkpoint live while the private transport is queued/running. */
export async function withScriptCancellation<T>(check: () => Promise<void>, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  await check();
  const controller = new AbortController();
  let pending: Promise<void> | undefined;
  let failure: unknown;
  let failed = false;
  const timer = setInterval(() => {
    if (pending || controller.signal.aborted) return;
    pending = check().catch(error => { failed = true; failure = error; controller.abort(); })
      .finally(() => { pending = undefined; });
  }, DEFAULT_RUN_POLL_INTERVAL_MS);
  try {
    try {
      const value = await work(controller.signal);
      await pending;
      if (failed) throw failure;
      return value;
    } catch (error) {
      await pending;
      throw failed ? failure : error;
    }
  } finally { clearInterval(timer); await pending; }
}
