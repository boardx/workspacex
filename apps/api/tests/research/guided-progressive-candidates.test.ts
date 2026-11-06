import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import { SearchBudget } from "../../src/application/research/guided-search-budget";
import { executeTaskPipeline } from "../../src/application/research/guided-task-pipeline";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
const { screen } = vi.hoisted(() => ({ screen: vi.fn() }));
vi.mock("../../src/application/research/guided-source-relevance", async importOriginal => ({
  ...await importOriginal<object>(), screenResearchSources: screen,
}));
function fixture(parent?: AbortSignal) {
  const state: ResearchRuntime = { sessionId: "progressive", version: 1, revision: 0, currentNode: "research", availableNodes: ["research"],
    brief: { topic: "Policy", goal: "Compare", focus: "Evidence", region: "EU", timeRange: "2026" }, directions: [],
    outline: [{ id: "a", title: "Policy", order: 0, enabled: true, questions: ["What applies?"] }],
    tasks: [{ id: "task-a", sectionId: "a", query: "policy", status: "pending", attempts: 0, errorCode: null }],
    sources: [], report: null, busy: true, completed: false, generatedNodes: [], messages: [], modelCalls: [], proposal: null, errorCode: null, leaseUntil: null };
  const snapshots: ResearchRuntime[] = [];
  const persist: RuntimePersistence = Object.assign(async () => { snapshots.push(structuredClone(state)); }, { requestId: "progressive", observe: vi.fn() });
  const hits = Array.from({ length: 10 }, (_, i) => ({ title: `Policy ${i}`, url: `https://example.org/${i}`, content: "Policy evidence" }));
  const read = vi.fn(async () => ({ text: "Policy evidence from the document", contentKind: "text" as const, truncated: false }));
  const search = { search: vi.fn(async (_query: string) => hits), read };
  const budget = SearchBudget.perCall(90_000, "RESEARCH_SOURCE_MODEL_TIMEOUT", parent);
  const run = () => executeTaskPipeline(state, persist, search, budget, async () => { throw new Error("Unexpected model recovery"); });
  return { state, snapshots, read, search, budget, run, observe: vi.mocked(persist.observe) };
}
it("stops reading additional search hits after three approved document sources", async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.search.search).toHaveBeenCalledTimes(1);
  expect(f.state.sources).toHaveLength(3);
  expect(f.state.tasks[0]!.status).toBe("succeeded");
});
it("publishes approved sources before a later candidate batch finishes", async () => {
  let entered!: () => void, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  screen.mockImplementation(async (_state, candidates) => {
    if (candidates[0].url.endsWith("/0")) return candidates.slice(0, 1);
    entered(); await blocked; return candidates;
  });
  const f = fixture(), execution = f.run();
  try {
    await waiting;
    expect(f.state.sources).toHaveLength(1);
    expect(f.snapshots.some(snapshot => snapshot.sources.length === 1 && snapshot.tasks[0]!.status === "running")).toBe(true);
  } finally { release(); await execution; f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(5); // Only two additional approvals are needed after the first partial batch.
});
it("retains published approved documents when a later screening batch fails", async () => {
  screen.mockImplementation(async (_state, candidates) => {
    if (candidates[0].url.endsWith("/0")) return candidates.slice(0, 1);
    throw new Error("provider unavailable");
  });
  const f = fixture();
  try { await expect(f.run()).rejects.toThrow("RESEARCH_SEARCH_PARTIAL_FAILURE"); } finally { f.budget.dispose(); }
  expect(f.state.sources).toHaveLength(1);
  expect(f.state.tasks[0]!.status).toBe("failed");
  expect(f.state.report).toBeNull();
  expect(f.state.completed).toBe(false);
});
it("does not publish a late batch after cancellation, preserving the first approved batch", async () => {
  let entered!: () => void, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  screen.mockImplementation(async (_state, candidates) => {
    if (candidates[0].url.endsWith("/0")) return candidates.slice(0, 1);
    entered(); await blocked; return candidates;
  });
  const abort = new AbortController();
  const f = fixture(abort.signal), execution = f.run();
  try {
    await waiting;
    abort.abort(new Error("execution cancelled"));
    release();
    await expect(execution).rejects.toThrow();
    expect(f.state.sources).toHaveLength(1);
    expect(f.state.tasks[0]!.status).not.toBe("succeeded");
  } finally { release(); await execution.catch(() => {}); f.budget.dispose(); }
});
it("does not stop a retry on retained documents when the current window has no approved sources", async () => {
  screen.mockImplementation(async (_state, candidates) => candidates[0].url.endsWith("/0") ? [] : candidates);
  const f = fixture();
  f.state.sources = Array.from({ length: 3 }, (_, i) => ({ id: `old-${i}`, taskId: "task-a", taskIds: ["task-a"], title: "Retained", url: `https://example.org/old-${i}`,
    content: "Earlier evidence", document: { text: "Earlier evidence", contentHash: "a".repeat(64), contentKind: "text" as const, url: `https://example.org/old-${i}`, retrievedAt: "2026-10-09T00:00:00Z", truncated: false }, retrievedAt: "2026-10-09T00:00:00Z", decision: "accepted" as const }));
  // Already fetched sources bypass persisted pending-document work, but must not
  // supply this attempt's stopping count without current relevance validation.
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(6);
  expect(f.state.tasks[0]!.status).toBe("succeeded");
  expect(f.state.tasks[0]!.errorCode).toBeNull();
});
it('continues beyond three documents for a chapter with six confirmed questions', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  f.state.outline[0]!.questions = Array.from({ length: 6 }, (_, i) => `Confirmed question ${i}?`);
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(6);
  expect(f.state.sources.filter(source => source.decision === 'accepted' && source.document)).toHaveLength(6);
  expect(f.search.search).toHaveBeenCalledTimes(1);
});
it('bounds broader chapters to nine approved documents instead of reading every hit', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  f.state.outline[0]!.questions = Array.from({ length: 12 }, (_, i) => `Confirmed question ${i}?`);
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(9);
  expect(f.search.search).toHaveBeenCalledTimes(1);
});

it('uses distinct confirmed subsection questions without inflating duplicate question text', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  const questions = Array.from({ length: 6 }, (_, i) => `Subsection question ${i}?`);
  f.state.outline[0]!.questions = questions;
  f.state.outline[0]!.subsections = [{ id: 'sub', title: 'Confirmed subsection', questions }];
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(6);
});
it('refuses a plan without confirmed questions instead of claiming coverage', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture(); f.state.outline[0]!.questions = [];
  try { await expect(f.run()).rejects.toThrow(); } finally { f.budget.dispose(); }
  expect(f.state.completed).toBe(false);
  expect(f.state.report).toBeNull();
});
it('does not multiply the per-question legacy task window by the whole chapter size', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  f.state.outline[0]!.questions = Array.from({ length: 6 }, (_, i) => `Legacy question ${i}?`);
  f.state.tasks[0]!.questionId = 'chapter:0/question:0';
  f.state.tasks[0]!.objective = f.state.outline[0]!.questions[0];
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(3);
});
it('deduplicates discovery URLs across bounded supplements without claiming report coverage', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  f.state.outline[0]!.questions = Array.from({ length: 6 }, (_, i) => `Question ${i}?`);
  f.search.search.mockResolvedValue(Array.from({ length: 10 }, () => ({ title: 'Same page', url: 'https://example.org/same', content: 'Policy evidence' })));
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.state.sources.filter(source => source.decision === 'accepted' && source.document)).toHaveLength(1);
  expect(f.search.search.mock.calls.length).toBeLessThanOrEqual(7);
  expect(f.state.completed).toBe(false);
});

function existingDocuments(f: ReturnType<typeof fixture>, count: number) {
  f.state.tasks[0]!.status = 'succeeded';
  f.state.sources = Array.from({ length: count }, (_, i) => ({ id: `approved-${i}`, taskId: 'task-a', taskIds: ['task-a'], title: `Approved ${i}`, url: `https://example.org/approved-${i}`,
    content: 'Previously approved document', document: { text: 'Previously approved document', contentHash: createHash('sha256').update('Previously approved document').digest('hex'), contentKind: 'text' as const,
      url: `https://example.org/approved-${i}`, retrievedAt: '2026-10-19T00:00:00Z', truncated: false }, retrievedAt: '2026-10-19T00:00:00Z', decision: 'accepted' as const }));
}
it.each([[6, 5], [9, 8]])('fills only one remaining chapter document (%i target, %i existing)', async (target, existing) => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture(); f.state.outline[0]!.questions = Array.from({ length: target }, (_, i) => `Question ${i}?`);
  existingDocuments(f, existing);
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.search.search).toHaveBeenCalledTimes(1);
  expect(f.state.sources.filter(source => source.decision === 'accepted' && source.document)).toHaveLength(target);
});
it('does not spend a remaining quota on duplicate URLs across supplemental queries', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture(); f.state.outline[0]!.questions = Array.from({ length: 6 }, (_, i) => `Question ${i}?`);
  existingDocuments(f, 5);
  const duplicate = { title: 'Already counted', url: f.state.sources[0]!.url, content: 'Previously approved document' };
  f.search.search.mockResolvedValueOnce([duplicate, duplicate]).mockResolvedValueOnce([duplicate]);
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.search.search).toHaveBeenCalledTimes(3);
  expect(f.state.sources.filter(source => source.decision === 'accepted' && source.document)).toHaveLength(6);
});
it('does not count rejected supplemental material as the remaining approved document', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates.filter((source: { url: string }) => !source.url.endsWith('/0')));
  const f = fixture(); f.state.outline[0]!.questions = Array.from({ length: 6 }, (_, i) => `Question ${i}?`);
  existingDocuments(f, 5);
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.state.sources.filter(source => source.decision === 'accepted' && source.document)).toHaveLength(6);
});
it('keeps a legacy question at three documents when its supplement needs only one', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture(); f.state.tasks[0]!.questionId = 'chapter:0/question:0'; f.state.tasks[0]!.objective = f.state.outline[0]!.questions[0];
  existingDocuments(f, 2);
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(f.state.sources.filter(source => source.decision === 'accepted' && source.document)).toHaveLength(3);
});
it.each(['unread', 'excluded'] as const)('does not count an %s retained source toward supplemental quota', async kind => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture(); f.state.outline[0]!.questions = Array.from({ length: 6 }, (_, i) => `Question ${i}?`);
  existingDocuments(f, 5);
  if (kind === 'excluded') f.state.sources[0]!.decision = 'excluded';
  else { delete f.state.sources[0]!.document; f.state.sources[0]!.documentError = 'unsupported'; }
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.state.sources.filter(source => source.decision === 'accepted' && source.document)).toHaveLength(6);
});
it('sizes the last primary batch to its remaining approved target', async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture(); f.state.outline[0]!.questions = Array.from({ length: 4 }, (_, i) => `Question ${i}?`);
  try { await f.run(); } finally { f.budget.dispose(); }
  expect(f.read).toHaveBeenCalledTimes(4);
  expect(f.state.sources).toHaveLength(4);
});

it("publishes actual discovery and read counts while a screening batch is still pending", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  screen.mockImplementation(async (_state, candidates) => { entered(); await blocked; return candidates; });
  const f = fixture(), execution = f.run();
  try {
    await started;
    expect(f.state.sources).toHaveLength(0); // Counts must not promote unverified material.
    expect(f.state.progress).toMatchObject({ sourceCounts: { discovered: 10, read: 3, screened: 0, reading: 0, screening: 3 } });
    expect(f.observe.mock.calls.at(-1)?.[0]).toMatchObject({ type: "snapshot", state: { progress: f.state.progress } });
  } finally { release(); await execution; f.budget.dispose(); }
  expect(f.state.progress).toMatchObject({ sourceCounts: { discovered: 10, read: 3, screened: 3, reading: 0, screening: 0 } });
});

it("does not reserve an unread shared tail URL while unrelated admitted batches can proceed", async () => {
  let entered!: () => void, release!: () => void, secondStarted = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const f = fixture();
  f.state.outline.push({ ...f.state.outline[0]!, id: "b", order: 1 });
  f.state.tasks.push({ ...f.state.tasks[0]!, id: "task-b", sectionId: "b", query: "second" });
  f.search.search.mockImplementation(async query => {
    const prefix = query === "second" ? "b" : "a";
    return [...Array.from({ length: 3 }, (_, i) => ({ title: "Evidence", url: `https://example.org/${prefix}/${i}`, content: "Policy evidence" })),
      { title: "Unused shared tail", url: "https://example.org/shared-tail", content: "Policy evidence" }];
  });
  screen.mockImplementation(async (_state, candidates) => {
    if (candidates[0].taskId === "task-a") { entered(); await blocked; }
    else secondStarted = true;
    return candidates;
  });
  const execution = f.run();
  try {
    await started;
    await vi.waitFor(() => expect(secondStarted).toBe(true), { timeout: 150 });
    expect(f.read.mock.calls).toHaveLength(6);
  } finally { release(); await execution; f.budget.dispose(); }
  expect(f.state.tasks.every(task => task.status === "succeeded")).toBe(true);
});

it("does not add a database checkpoint per discovery/read/screen progress update", async () => {
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  try { await f.run(); } finally { f.budget.dispose(); }
  // Existing boundaries: attempt registration, task admission, approved batch,
  // and attempt completion. Phase starts add at most two checkpoints; rapid counters coalesce.
  expect(f.snapshots.length).toBeLessThanOrEqual(6);
  expect(f.snapshots.at(-1)?.progress).toMatchObject({ sourceCounts: { read: 3, screened: 3 } });
});

it("makes active reads visible to the normal polling transport before documents finish", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  screen.mockImplementation(async (_state, candidates) => candidates);
  const f = fixture();
  f.read.mockImplementation(async () => { entered(); await blocked; return { text: "Policy document evidence", contentKind: "text", truncated: false }; });
  const execution = f.run();
  try {
    await started;
    expect(f.snapshots.some(snapshot => (snapshot.progress?.sourceCounts?.reading ?? 0) > 0)).toBe(true);
  } finally { release(); await execution; f.budget.dispose(); }
});
