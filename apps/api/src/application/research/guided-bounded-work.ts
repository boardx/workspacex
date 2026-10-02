/** External work is bounded; commits are serialized in completion order.
 * Drain in-flight work before propagating failure so it cannot mutate finalized state.
 */
export async function boundedWork<T, R>(items: readonly T[], concurrency: number,
  produce: (item: T, index: number) => Promise<R>,
  commit: (item: T, result: PromiseSettledResult<R>, index: number) => Promise<void>,
  begin?: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  let commits = Promise.resolve();
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++; const item = items[index]!;
      if (begin) {
        commits = commits.then(async () => {
          if (failed) return;
          try { await begin(item, index); }
          catch (error) { failed = true; failure = error; }
        });
        await commits;
        if (failed) return;
      }
      let result: PromiseSettledResult<R>;
      try { result = { status: "fulfilled", value: await produce(item, index) }; }
      catch (reason) { result = { status: "rejected", reason }; }
      const next = commits.then(async () => {
        if (failed) return;
        try { await commit(item, result, index); }
        catch (error) { failed = true; failure = error; }
      });
      commits = next;
      await next;
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  if (failed) throw failure;
}
