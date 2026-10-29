import { expect, it, vi } from "vitest";
import { InterviewSessionCache } from "@/lib/interview-session-cache";

it("shares an in-flight read and keeps the last snapshot during refresh failure", async () => {
  const cache = new InterviewSessionCache();
  let resolve!: (value: { version: number }) => void;
  const read = vi.fn(() => new Promise<{ version: number }>(done => { resolve = done; }));
  const first = cache.read("metadata/a", read);
  const second = cache.read("metadata/a", read);
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1);
  resolve({ version: 1 });
  await Promise.all([first, second]);
  await expect(cache.read("metadata/a", () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
  expect(cache.get("metadata/a")).toEqual({ version: 1 });
});

it("does not let a read started before a mutation overwrite its newer snapshot", async () => {
  const cache = new InterviewSessionCache();
  let resolve!: (value: { version: number }) => void;
  const pending = cache.read("metadata/a", () => new Promise<{ version: number }>(done => { resolve = done; }));
  await Promise.resolve();
  cache.put("metadata/a", { version: 9 });
  resolve({ version: 8 });
  await pending;
  expect(cache.get("metadata/a")).toEqual({ version: 9 });
});

it("rejects older canonical versions and prevents disposed scope callbacks from restoring data", async () => {
  const cache = new InterviewSessionCache();
  cache.put("metadata/a", { version: 9 });
  cache.put("metadata/a", { version: 8 });
  expect(cache.get("metadata/a")).toEqual({ version: 9 });
  cache.dispose();
  cache.put("metadata/a", { version: 10 });
  expect(cache.get("metadata/a")).toBeNull();
});
