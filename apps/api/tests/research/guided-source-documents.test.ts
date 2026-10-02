import { expect, it, vi } from "vitest";
import { collectSourceDocuments } from "../../src/application/research/guided-source-documents";
import { ResearchRuntimeError, type ResearchRuntime } from "../../src/application/research/guided-runtime-ports";

it("reduces the controlled mixed-latency workload from three batch barriers to a continuous queue", async () => {
  vi.useFakeTimers();
  try {
    const sources = Array.from({ length: 7 }, (_, index) => ({ id: String(index), taskId: "t", title: "Policy", content: "snippet", url: `https://example.org/${index}`, decision: "accepted", retrievedAt: "now" })) as ResearchRuntime["sources"];
    const durations = [100, 10, 10, 100, 10, 10, 100];
    const start = Date.now();
    const operation = collectSourceDocuments(sources, async (url) => {
      await new Promise((resolve) => setTimeout(resolve, durations[Number(new URL(url).pathname.slice(1))]));
      return { text: "Actual evidence.", contentKind: "text", truncated: false };
    }, async () => undefined);
    await vi.runAllTimersAsync(); await operation;
    expect(Date.now() - start).toBe(130);
    expect([0, 3, 6].reduce((total, offset) => total + Math.max(...durations.slice(offset, offset + 3)), 0)).toBe(300);
    expect(sources.every((source) => source.document)).toBe(true);
  } finally { vi.useRealTimers(); }
});

it("persists a fast document and starts the next read without waiting for a slow sibling", async () => {
  const sources = Array.from({ length: 4 }, (_, index) => ({ id: String(index), taskId: "t", title: "Policy", content: "snippet", url: `https://example.org/${index}`, decision: "accepted", retrievedAt: "now" })) as ResearchRuntime["sources"];
  let release!: () => void;
  const slow = new Promise<void>((resolve) => { release = resolve; });
  let nextStarted!: () => void;
  const next = new Promise<void>((resolve) => { nextStarted = resolve; });
  const read = vi.fn(async (url: string) => {
    if (url.endsWith("/0")) await slow;
    if (url.endsWith("/3")) nextStarted();
    return { text: "Actual policy.", contentKind: "text" as const, truncated: false };
  });
  const snapshots: string[][] = [];
  const operation = collectSourceDocuments(sources, read, async () => { snapshots.push(sources.filter((source) => source.document).map((source) => source.id)); });
  try {
    await Promise.race([next, new Promise((_, reject) => setTimeout(() => reject(new Error("queue blocked by slow sibling")), 1000))]);
    expect(snapshots.some((snapshot) => snapshot.includes("1") && !snapshot.includes("0"))).toBe(true);
  } finally { release(); await operation; }
});

it("fetches concurrently with a bound, persists each body and an honest extractive summary", async () => {
  const sources = Array.from({ length: 7 }, (_, index) => ({ id: String(index), taskId: "t", title: "Policy", content: "search snippet", url: `https://example.org/${index}`, decision: "accepted", retrievedAt: "now" })) as ResearchRuntime["sources"];
  let active = 0, peak = 0;
  const read = vi.fn(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return { text: "Official policy requires permits.\n\nImplementation depends on local approval.", contentKind: "html" as const, truncated: false };
  });
  const persist = vi.fn(async () => undefined);
  await collectSourceDocuments(sources, read, persist);
  expect(peak).toBe(3);
  expect(persist).toHaveBeenCalledTimes(7);
  expect(sources.every((source) => source.document?.summary?.includes("Official policy requires permits."))).toBe(true);
  expect(sources.every((source) => source.document?.contentHash?.length === 64)).toBe(true);
  await collectSourceDocuments(sources, read, persist);
  expect(read).toHaveBeenCalledTimes(7);
});

it.each(["BLOCKED", "UNSUPPORTED"])("does not retry permanent %s failures", async (reason) => {
  const sources = [{ id: "s", taskId: "t", title: "Policy", content: "snippet", url: "https://example.org/policy", decision: "accepted", retrievedAt: "now" }] as ResearchRuntime["sources"];
  const read = vi.fn(async () => { throw new ResearchRuntimeError(`RESEARCH_DOCUMENT_${reason}`); });
  const persist = vi.fn(async () => undefined);
  await collectSourceDocuments(sources, read, persist);
  expect(sources[0]!.documentError).toBe(reason.toLowerCase());
  await collectSourceDocuments(sources, read, persist, { retryTransient: true });
  expect(read).toHaveBeenCalledTimes(1);
});

it("propagates persistence failure and resumes from the last durable snapshot", async () => {
  const sources = ["a", "b", "c"].map((id) => ({ id, taskId: "t", title: "Policy", content: "snippet", url: `https://example.org/${id}`, decision: "accepted", retrievedAt: "now" })) as ResearchRuntime["sources"];
  let durable = structuredClone(sources);
  const read = vi.fn(async () => ({ text: "Actual policy.", contentKind: "text" as const, truncated: false }));
  const persist = vi.fn().mockImplementationOnce(async () => { durable = structuredClone(sources); }).mockRejectedValueOnce(new Error("write failed"));
  await expect(collectSourceDocuments(sources, read, persist)).rejects.toThrow("write failed");
  expect(durable.filter((source) => source.document)).toHaveLength(1);
  read.mockClear();
  await collectSourceDocuments(durable, read, async () => undefined);
  expect(read).toHaveBeenCalledTimes(2);
  expect(durable.every((source) => source.document)).toBe(true);
});

it("retains successful documents, records errors and retries only transient failures", async () => {
  const sources = ["good", "bad"].map((id) => ({ id, taskId: "t", title: id, content: "snippet", url: `https://example.org/${id}`, decision: "accepted", retrievedAt: "now" })) as ResearchRuntime["sources"];
  const read = vi.fn(async (url: string) => { if (url.endsWith("bad")) throw new Error("temporary failure"); return { text: "Actual document.", contentKind: "text" as const, truncated: false }; });
  const persist = vi.fn(async () => undefined);
  await collectSourceDocuments(sources, read, persist);
  expect(sources[0]!.document).toBeDefined();
  expect(sources[1]!.documentError).toBe("unavailable");
  read.mockResolvedValue({ text: "Recovered document.", contentKind: "text", truncated: false });
  await collectSourceDocuments(sources, read, persist, { retryTransient: true });
  expect(read).toHaveBeenCalledTimes(3);
  expect(sources[1]!.document?.summary).toBe("Recovered document.");
});

it("drains in-flight reads and stops commits after a persistence failure", async () => {
  const sources = Array.from({ length: 4 }, (_, index) => ({ id: String(index), taskId: "t", title: "Policy", content: "snippet", url: `https://example.org/${index}`, decision: "accepted", retrievedAt: "now" })) as ResearchRuntime["sources"];
  let release!: () => void;
  const slow = new Promise<void>((resolve) => { release = resolve; });
  let failedWrite!: () => void;
  const written = new Promise<void>((resolve) => { failedWrite = resolve; });
  const read = vi.fn(async (url: string) => {
    if (url.endsWith("/0")) await slow;
    return { text: "Actual evidence.", contentKind: "text" as const, truncated: false };
  });
  const persist = vi.fn(async () => { failedWrite(); throw new Error("database offline"); });
  let finished = false;
  const operation = collectSourceDocuments(sources, read, persist).catch((error) => { finished = true; return error; });
  await written;
  await Promise.resolve(); expect(finished).toBe(false);
  release();
  expect(await operation).toMatchObject({ message: "database offline" });
  expect(read).toHaveBeenCalledTimes(3);
  expect(persist).toHaveBeenCalledOnce();
  expect(sources.filter((source) => source.document)).toHaveLength(1);
});
