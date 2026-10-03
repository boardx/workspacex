/** Two independent chapter calculations; only the confirmed prefix is committed.
 * Every started computation is settled before failure returns to the service.
 */
export async function orderedChapterWork<T, R>(items: readonly T[], compute: (item: T, index: number) => Promise<R>, commit: (result: R, index: number) => Promise<void>) {
  const pending = new Map<number, Promise<PromiseSettledResult<R>>>();
  let failed = false;
  const start = (index: number) => {
    if (index >= items.length || failed) return;
    pending.set(index, Promise.resolve().then(() => compute(items[index]!, index)).then(
      (value): PromiseSettledResult<R> => ({ status: "fulfilled", value }),
      (reason): PromiseSettledResult<R> => { failed = true; return { status: "rejected", reason }; },
    ));
  };
  start(0); start(1);
  try {
    for (let index = 0; index < items.length; index++) {
      const task = pending.get(index);
      if (!task) throw new Error("Chapter computation stopped before its ordered turn.");
      const result = await task;
      if (result.status === "rejected") throw result.reason;
      await commit(result.value, index);
      start(index + 2);
    }
  } finally {
    failed = true;
    await Promise.all(pending.values());
  }
}
