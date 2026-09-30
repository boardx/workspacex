import { expect, it, vi } from "vitest";
import { collectSourceDocuments } from "../../src/application/research/guided-source-documents";
import { ResearchRuntimeError, type ResearchRuntime } from "../../src/application/research/guided-runtime-ports";

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
