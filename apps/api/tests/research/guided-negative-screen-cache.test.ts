import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { screenResearchSources } from "../../src/application/research/guided-source-relevance";
import { NegativeSourceScreenCache } from "../../src/application/research/guided-negative-screen-cache";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const text = "Unrelated publicly synthetic material. ".repeat(2000).slice(0, 60000);
  const state: ResearchRuntime = { sessionId: "negative-cache", version: 3, revision: 0, currentNode: "research", availableNodes: ["research"],
    brief: { topic: "Grid policy", goal: "Compare public regulation", region: "EU", focus: "Policy", timeRange: "2026" }, directions: [],
    outline: [{ id: "section", title: "Regulation", enabled: true, order: 0, questions: ["What policy applies?"] }],
    tasks: [{ id: "task", sectionId: "section", questionId: "chapter:0/question:0", query: "grid policy", status: "running", attempts: 1, errorCode: null }],
    sources: [], report: null, generatedNodes: [], messages: [], modelCalls: [], proposal: null, busy: true, completed: false, errorCode: null, leaseUntil: null };
  const source = (id: string): ResearchRuntime["sources"][number] => ({ id, taskId: "task", taskIds: ["task"], title: "Public synthetic page", url: "https://example.org/page", content: "Search discovery excerpt", retrievedAt: `discovery-${id}`, decision: "accepted",
    document: { url: "https://example.org/page", text, contentHash: hash(text), retrievedAt: `read-${id}`, contentKind: "text", truncated: false } });
  const complete = vi.fn(async (_system: string, context: unknown, validate: (value: unknown) => void) => {
    const input = context as { chunks: { sourceId: string; chunkId: string }[] };
    const output = { evaluations: input.chunks.map(chunk => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: true, matches: [] })) };
    validate(output); return output;
  });
  return { state, source, complete, cache: new NegativeSourceScreenCache() };
}
it("reuses only a complete negative scan across three discovery queries/UUIDs in one execution", async () => {
  const f = fixture();
  for (const query of ["original", "recovery-one", "recovery-two"]) {
    const source = f.source(query);
    expect(await screenResearchSources(f.state, [source], f.complete, { adaptive: true, negativeCache: f.cache })).toEqual([]);
    expect(source.decision).toBe("accepted"); expect(source).not.toHaveProperty("relevanceBasis");
  }
  expect(f.complete).toHaveBeenCalledTimes(4);
  expect(f.cache.size).toBe(1);
});
it.each(["task", "taskObjective", "taskQuery", "question", "brief", "policy", "sourceUrl", "documentUrl", "body", "execution", "session", "materialKind"])("does not reuse a negative after changing %s", async change => {
  const f = fixture(); await screenResearchSources(f.state, [f.source("first")], f.complete, { adaptive: true, negativeCache: f.cache });
  const next = f.source("next");
  if (change === "task") { f.state.tasks[0]!.id = "other-task"; next.taskId = "other-task"; next.taskIds = ["other-task"]; }
  if (change === "taskObjective") f.state.tasks[0]!.objective = "A different confirmed objective";
  if (change === "taskQuery") f.state.tasks[0]!.query = "different confirmed query";
  if (change === "question") f.state.outline[0]!.questions[0] = "What other policy applies?";
  if (change === "brief") f.state.brief.focus = "Different scope";
  if (change === "policy") f.state.sourcePolicy = { mode: "restrict", domains: ["example.org"], internalSourceIds: [], revision: 1 };
  if (change === "sourceUrl") next.url = "https://example.org/other-page";
  if (change === "documentUrl") next.document!.url = "https://example.org/redirected-page";
  if (change === "body") { next.document!.text = "Changed" + next.document!.text.slice(7); next.document!.contentHash = hash(next.document!.text); }
  if (change === "execution") f.state.version++;
  if (change === "session") f.state.sessionId = "other-session";
  if (change === "materialKind") delete next.document;
  expect(await screenResearchSources(f.state, [next], f.complete, { adaptive: true, negativeCache: f.cache })).toEqual([]);
  expect(f.complete.mock.calls.length).toBeGreaterThan(4);
});
it.each(["provider", "protocol", "repair", "abort"])("does not memoize a scan containing %s failure", async mode => {
  const f = fixture(), controller = new AbortController(); let calls = 0;
  const complete = vi.fn(async (system: string, context: unknown, validate: (value: unknown) => void) => {
    calls++;
    if (mode === "provider" && calls === 2) throw new Error("controlled provider failure");
    if (mode === "protocol" || (mode === "repair" && calls === 1)) { const bad = { evaluations: [] }; validate(bad); return bad; }
    const value = await f.complete(system, context, validate);
    if (mode === "abort" && calls === 2) controller.abort(new Error("controlled cancellation"));
    return value;
  });
  const operation = screenResearchSources(f.state, [f.source("first")], complete, { adaptive: true, negativeCache: f.cache, signal: controller.signal });
  if (mode === "repair") expect(await operation).toEqual([]); else await expect(operation).rejects.toThrow();
  expect(f.cache.size).toBe(0);
  f.complete.mockClear();
  await screenResearchSources(f.state, [f.source("retry")], f.complete, { adaptive: true, negativeCache: f.cache });
  expect(f.complete).toHaveBeenCalledTimes(4);
});
it("does not store an adaptive positive with an unscanned tail as a negative", async () => {
  const f = fixture();
  const positive = vi.fn(async (_system: string, context: unknown, validate: (value: unknown) => void) => {
    const c = context as { chunks: { sourceId: string; chunkId: string; questionIds: string[]; quoteOptions: { quoteRef: string }[] }[] };
    const output = { evaluations: c.chunks.map(chunk => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false,
      matches: [{ questionId: chunk.questionIds[0]!, quoteRef: chunk.quoteOptions[0]!.quoteRef, insight: "Controlled synthetic exact quote match", relevance: "context" }] })) };
    validate(output); return output;
  });
  expect(await screenResearchSources(f.state, [f.source("first")], positive, { adaptive: true, negativeCache: f.cache })).toHaveLength(1);
  expect(positive).toHaveBeenCalledTimes(1); expect(f.cache.size).toBe(0);
  await screenResearchSources(f.state, [f.source("next")], positive, { adaptive: true, negativeCache: f.cache });
  expect(positive).toHaveBeenCalledTimes(2);
});
it("does not memoize absent question scopes, invalid policy or inconsistent document hashes", async () => {
  for (const mode of ["no-question", "invalid-policy", "invalid-hash"]) {
    const f = fixture(), source = f.source("first");
    if (mode === "no-question") f.state.tasks[0]!.questionId = "chapter:0/question:99";
    if (mode === "invalid-policy") f.state.sourcePolicy = { mode: "restrict", domains: [], internalSourceIds: [], revision: 1 };
    if (mode === "invalid-hash") source.document!.contentHash = "0".repeat(64);
    expect(await screenResearchSources(f.state, [source], f.complete, { adaptive: true, negativeCache: f.cache })).toEqual([]);
    expect(f.cache.size).toBe(0);
  }
});
it("keeps the default uncached screening path and never mutates manual/excluded intent", async () => {
  const f = fixture();
  for (const id of ["first", "second"]) await screenResearchSources(f.state, [f.source(id)], f.complete, { adaptive: true });
  expect(f.complete).toHaveBeenCalledTimes(8);
  const excluded = { ...f.source("excluded"), decision: "excluded" as const }, manual = { ...f.source("manual"), addedByUser: true };
  expect(await screenResearchSources(f.state, [excluded, manual], f.complete, { adaptive: true, negativeCache: f.cache })).toEqual([excluded, manual]);
  expect(f.complete).toHaveBeenCalledTimes(8); expect(f.cache.size).toBe(0);
});
it("bounds digest-only cache storage and clears every execution fact", () => {
  const cache = new NegativeSourceScreenCache(2), keys = ["one", "two", "three"].map(hash);
  keys.forEach(key => cache.remember(key)); expect(cache.size).toBe(2); expect(cache.has(keys[0]!)).toBe(false); expect(cache.has(keys[2]!)).toBe(true);
  expect(() => cache.remember("raw source text")).toThrow(); expect(cache.size).toBe(2);
  cache.clear(); expect(cache.size).toBe(0); expect(cache.has(keys[2]!)).toBe(false);
});
it("does not let a cached source-wide negative skip a newly associated task scope", async () => {
  const f = fixture(); await screenResearchSources(f.state, [f.source("first")], f.complete, { adaptive: true, negativeCache: f.cache });
  f.state.tasks.push({ ...f.state.tasks[0]!, id: "other-task", objective: "Another task scope" });
  const shared = { ...f.source("shared"), taskIds: ["task", "other-task"] };
  await screenResearchSources(f.state, [shared], f.complete, { adaptive: true, negativeCache: f.cache });
  const supplied = f.complete.mock.calls.slice(4).flatMap(call => (call[1] as { chunks: { taskId: string }[] }).chunks);
  expect(new Set(supplied.map(chunk => chunk.taskId))).toEqual(new Set(["task", "other-task"]));
  expect(supplied).toHaveLength(20);
});
