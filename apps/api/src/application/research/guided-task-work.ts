/** Local FIFO queues share a fixed task budget. Reserve one recovery slot while
 * primaries remain; after the producer drains, recovery can borrow all slots.
 * Callbacks own their existing model/read/URL permits, never this coordinator. */
export async function fairTaskWork<T>(items: readonly T[], limit: number,
  primary: (item: T) => Promise<boolean>, recover: (item: T) => Promise<void>,
  check: () => void, stop: (error: unknown) => void): Promise<void> {
  const recoveries: T[] = [];
  const active = new Set<Promise<void>>();
  let cursor = 0, recoveryCursor = 0, primaries = 0, recovering = 0;
  let failed = false, failure: unknown;
  const fail = (error: unknown) => { if (!failed) { failed = true; failure = error; stop(error); } };
  const dispatch = (item: T, recovery: boolean) => {
    if (recovery) recovering++; else primaries++;
    const work = Promise.resolve().then(async () => {
      check();
      if (recovery) await recover(item);
      else if (await primary(item)) recoveries.push(item);
    }).catch(fail).finally(() => {
      if (recovery) recovering--; else primaries--;
      active.delete(work);
    });
    active.add(work);
  };
  try {
    for (;;) {
      if (failed) break;
      check();
      while (cursor < items.length && primaries < Math.max(1, limit - 1) && active.size < limit) dispatch(items[cursor++]!, false);
      const producerDone = cursor === items.length && primaries === 0;
      const recoveryLimit = producerDone ? limit : 1;
      while (recoveryCursor < recoveries.length && recovering < recoveryLimit && active.size < limit) dispatch(recoveries[recoveryCursor++]!, true);
      if (!active.size) break;
      await Promise.race(active);
    }
  } catch (error) { fail(error); }
  // Every dispatched stateful callback settles before the caller can finalize.
  await Promise.all(active);
  if (failed) throw failure;
  check();
}
