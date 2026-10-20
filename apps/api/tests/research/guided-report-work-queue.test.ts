import { expect, it } from "vitest";
import { reportWorkQueue } from "../../src/application/research/guided-report-work-queue";

it("shares a bound across report work and releases permits on failure", async () => {
  const queue = reportWorkQueue(4);
  let active = 0, peak = 0;
  const values = await Promise.allSettled(Array.from({ length: 15 }, (_, index) => queue.run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    if (index === 2) throw new Error("provider failed");
    return index;
  })));
  expect(peak).toBe(4); expect(active).toBe(0);
  expect(values.filter(value => value.status === "rejected")).toHaveLength(1);
  expect(await queue.run(async () => "available")).toBe("available");
});

it("cancels queued requests without starting external work or losing a permit", async () => {
  const queue = reportWorkQueue(1); let release!: () => void;
  const first = queue.run(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  const abort = new AbortController(); let started = false;
  const waiting = queue.run(async () => { started = true; }, abort.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  abort.abort(); await rejected; release(); await first;
  expect(started).toBe(false);
  expect(await queue.run(async () => 1)).toBe(1);
});
