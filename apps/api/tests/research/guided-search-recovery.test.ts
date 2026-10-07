import { fairTaskWork } from "../../src/application/research/guided-task-work";
import { createHash } from "node:crypto";
import { executeTaskPipeline } from "../../src/application/research/guided-task-pipeline";
import { SearchBudget } from "../../src/application/research/guided-search-budget";
import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { ResearchRuntimeError, type ResearchRuntime, type GuidedRuntimeStore, type GuidedSearchPort } from "../../src/application/research/guided-runtime-ports";
import { toOrgId } from "../../src/domain/org-id";
import { guidedResearchReply } from "../../scripts/loopback-guided-research";

const original = '"Honor of Kings" international Southeast Asia market share "Mobile Legends: Bang Bang" comparison 2023-2027 localization strategy';
const short = 'Honor of Kings Southeast Asia official launch';
const second = 'Honor of Kings Mobile Legends market share';
const hit = { title: "Honor of Kings official", url: "https://example.org/hok", content: "Honor of Kings launched in Southeast Asia with localized events." };
const car = { title: "Cars", url: "https://example.org/cars", content: "Controlled unrelated vehicle inventory" };
const session = C.GuidedResearchSession.parse({ sessionId: "recovery", title: "王者荣耀", brief: { topic: "王者荣耀", goal: "国际版市场", region: "东南亚", timeRange: "2023-2027", focus: "本地化" }, stage: "researching", resumeStage: "researching", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
function seed() {
  const state = initialRuntime(session);
  state.currentNode = "research"; state.availableNodes = ["brief", "directions", "outline", "research"]; state.generatedNodes = ["brief", "directions", "outline", "research"];
  state.outline = [{ id: "market", title: "市场进入", questions: ["国际版如何本地化？"], enabled: true, order: 0 }];
  state.tasks = [{ id: "task", sectionId: "market", title: "东南亚本地化", objective: "查明王者荣耀在东南亚的本地化", query: original, status: "pending", attempts: 0, errorCode: null }];
  return state;
}
function fixture(initial = seed(), read?: GuidedSearchPort["read"]) {
  let state = structuredClone(initial);
  const writes: ResearchRuntime[] = [];
  const write = vi.fn(async (_actor: unknown, _request: string, next: ResearchRuntime): Promise<ResearchRuntime | void> => { state = structuredClone(next); writes.push(state); });
  const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim: async () => { state.version++; state.errorCode = null; state.busy = true; return { state: structuredClone(state), replay: false }; }, write };
  let queries = [short, second];
  const model = { complete: vi.fn(async (input: { system: string; user: string }) => {
    const context = JSON.parse(input.user);
    if (context.researchStage === "search_recovery") return { text: JSON.stringify({ queries }) };
    return { text: guidedResearchReply(input.system, input.user)! };
  }) };
  const search = vi.fn(async (query: string) => query === original ? [] : [hit]);
  const actor = { orgId: toOrgId("recovery-org"), userId: "owner", sessionId: session.sessionId };
  const service = new GuidedRuntimeService(store, model, { search, read }, { provider: "test", id: "test" });
  return { model, search, writes, write, setQueries: (next: string[]) => { queries = next; },
    saveBrief: (value: ResearchRuntime["brief"]) => service.execute(actor, session, { node: "brief", action: "save", draft: { node: "brief", value }, sessionId: session.sessionId, requestId: String(state.version), expectedVersion: state.version }),
    run: (action: "start" | "retry" | "complete" = "start", allowPartialResearch = false) => service.execute(actor, session, { node: "research", action, sessionId: session.sessionId, requestId: String(state.version), expectedVersion: state.version, ...(allowPartialResearch ? { allowPartialResearch: true } : {}) }) };
}

describe("bounded search query recovery", () => {
  it.each(["none", "failed", "success"].flatMap(readMode => [false, true].map(reverse => ({ readMode, reverse }))))(
    "binds same-URL task approvals to the actual stored bytes ($readMode, reverse=$reverse)", async ({ readMode, reverse }) => {
      const state = seed(); state.outline[0]!.questions = ["A evidence?", "B evidence?"];
      state.tasks = ["A", "B"].map(name => ({ ...state.tasks[0]!, id: name, query: `query-${name}`, objective: `${name} evidence?` }));
      const body = "A-only evidence is verified.\n\nB-only evidence is verified.";
      const read = readMode === "none" ? undefined : async () => {
        if (readMode === "failed") throw new ResearchRuntimeError("RESEARCH_DOCUMENT_UNAVAILABLE");
        return { text: body, contentKind: "text" as const, truncated: false };
      };
      const f = fixture(state, read);
      const first = reverse ? "B" : "A";
      f.search.mockImplementation(async query => {
        const name = query === "query-A" ? "A" : "B";
        if (name !== first) await new Promise(resolve => setTimeout(resolve, 2));
        return [{ ...hit, content: `${name}-only evidence is verified.` }];
      });
      const approvals: Array<{ taskId: string; quote: string }> = [];
      f.model.complete.mockImplementation(async input => {
        const context = JSON.parse(input.user);
        if (context.researchStage === "search_recovery") return { text: JSON.stringify({ queries: ["retry-B"] }) };
        if (context.chunks.some((chunk: { taskId: string }) => chunk.taskId === first)) await new Promise(resolve => setTimeout(resolve, 8));
        return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; taskId: string; questionIds: string[]; quoteOptions: { quoteRef: string; text: string }[] }) => {
          const quote = chunk.quoteOptions.find(option => option.text.includes(`${chunk.taskId}-only`));
          if (quote) approvals.push({ taskId: chunk.taskId, quote: quote.text });
          const question = context.questions.find((question: { id: string; question: string }) => chunk.questionIds.includes(question.id) && question.question === `${chunk.taskId} evidence?`);
          return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: !quote,
            matches: quote ? [{ questionId: question.id, quoteRef: quote.quoteRef, insight: "Task-specific controlled evidence.", relevance: "direct" }] : [] };
        }) }) };
      });
      const result = await f.run();
      const stored = result.sources[0]!;
      expect(result.sources).toHaveLength(1);
      const storedBytes = stored.document?.text ?? stored.content;
      for (const taskId of stored.taskIds!) {
        const quotes = approvals.filter(approval => approval.taskId === taskId);
        expect(quotes.length).toBeGreaterThan(0);
        expect(quotes.every(approval => storedBytes.includes(approval.quote))).toBe(true);
      }
      if (readMode === "success") {
        expect(result.tasks.every(task => task.status === "succeeded")).toBe(true);
        expect(new Set(stored.taskIds)).toEqual(new Set(["A", "B"]));
        expect(stored.document?.contentHash).toBe(createHash("sha256").update(body).digest("hex"));
      } else {
        expect(result.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
        expect(stored.taskIds).toEqual([first]);
        expect(result.tasks.find(task => task.id !== first)?.status).toBe("failed");
        if (readMode === "failed") expect(stored.documentError).toBe("unavailable");
        const approvedBeforeRetry = approvals.filter(approval => approval.taskId === first).length;
        const retried = await f.run("retry");
        expect(retried.sources[0]?.content).toBe(stored.content);
        expect(retried.sources[0]?.taskIds).toEqual([first]);
        expect(retried.tasks.find(task => task.id === first)?.status).toBe("succeeded");
        expect(retried.tasks.find(task => task.id !== first)?.status).toBe("failed");
        expect(approvals.filter(approval => approval.taskId === first)).toHaveLength(approvedBeforeRetry);
      }
    });

  it.each(["A", "B"])("does not erase stored A evidence when a later successful read supports only %s", async documentTask => {
    const state = seed(); state.outline[0]!.questions = ["A evidence?", "B evidence?"];
    state.tasks = ["A", "B"].map(name => ({ ...state.tasks[0]!, id: name, query: `query-${name}`, objective: `${name} evidence?` }));
    let reads = 0;
    const read = async () => {
      if (++reads === 1) throw new ResearchRuntimeError("RESEARCH_DOCUMENT_UNAVAILABLE");
      return { text: `${documentTask}-only evidence is verified.`, contentKind: "text" as const, truncated: false };
    };
    const f = fixture(state, read);
    f.search.mockImplementation(async query => [{ ...hit, content: `${query === "query-A" ? "A" : "B"}-only evidence is verified.` }]);
    f.model.complete.mockImplementation(async input => {
      const context = JSON.parse(input.user);
      if (context.researchStage === "search_recovery") return { text: JSON.stringify({ queries: ["retry"] }) };
      return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; taskId: string; questionIds: string[]; quoteOptions: { quoteRef: string; text: string }[] }) => {
        const quote = chunk.quoteOptions.find(option => option.text.includes(`${chunk.taskId}-only`));
        const question = context.questions.find((question: { id: string; question: string }) => chunk.questionIds.includes(question.id) && question.question === `${chunk.taskId} evidence?`);
        return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: !quote,
          matches: quote ? [{ questionId: question.id, quoteRef: quote.quoteRef, insight: "Task-specific controlled evidence.", relevance: "direct" }] : [] };
      }) }) };
    });
    const result = await f.run();
    expect(result.tasks.map(task => task.status)).toEqual(["succeeded", "failed"]);
    expect(result.sources[0]?.content).toBe("A-only evidence is verified.");
    expect(result.sources[0]?.taskIds).toEqual(["A"]);
    expect(result.sources[0]?.document?.text ?? result.sources[0]?.content).toBe("A-only evidence is verified.");
    const basis = result.sources[0]!.relevanceBasis;
    const retried = await f.run("retry");
    expect(retried.tasks.map(task => task.status)).toEqual(["succeeded", "failed"]);
    expect(retried.sources[0]?.taskIds).toEqual(["A"]);
    expect(retried.sources[0]?.document?.text ?? retried.sources[0]?.content).toBe("A-only evidence is verified.");
    expect(retried.sources[0]?.relevanceBasis).toBe(basis);
  });
  it("locks duplicate and overlapping URL sets in a stable order without self-locking", async () => {
    const state = seed(); state.tasks = ["A", "B"].map(name => ({ ...state.tasks[0]!, id: name, query: name }));
    const f = fixture(state);
    f.search.mockImplementation(async query => {
      const urls = query === "A" ? ["https://example.org/one", "https://example.org/two", "https://example.org/one#duplicate"] : ["https://example.org/two", "https://example.org/one"];
      return urls.map(url => ({ ...hit, url }));
    });
    const result = await f.run();
    expect(result.errorCode).toBeNull(); expect(result.sources).toHaveLength(2);
    expect(result.sources.every(source => new Set(source.taskIds).size === 2)).toBe(true);
    expect(f.model.complete).toHaveBeenCalledTimes(2);
  });
  it("cancels a same-URL waiter before model admission and drains its aborted holder", async () => {
    const state = seed(); state.tasks = ["C", "A", "B"].map(name => ({ ...state.tasks[0]!, id: name, query: name }));
    const f = fixture(state); f.search.mockImplementation(async query => query === "C" ? [] : [{ ...hit, url: query === short ? `${hit.url}/different` : hit.url }]);
    let release!: () => void, started!: () => void, holderSignal: AbortSignal | undefined, lateReads = 0, settled = false;
    const began = new Promise<void>(resolve => { started = resolve; });
    f.model.complete.mockImplementation(async input => {
      const context = JSON.parse(input.user);
      if (context.researchStage === "search_recovery") return { text: JSON.stringify({ queries: [short] }) };
      if (context.chunks.some((chunk: { taskId: string }) => chunk.taskId === "A")) {
        holderSignal = (input as { signal?: AbortSignal }).signal;
        started(); await new Promise<void>(resolve => { release = resolve; });
        return { get text() { lateReads++; return guidedResearchReply(input.system, input.user)!; } };
      }
      await began; return { text: guidedResearchReply(input.system, input.user)! };
    });
    const originalWrite = f.write.getMockImplementation()!;
    const failure = new ResearchRuntimeError("RESEARCH_PERSISTENCE_FAILED");
    f.write.mockImplementation(async (actor, request, next) => {
      if (next.busy && next.sources.some(source => source.taskId === "C")) throw failure;
      await originalWrite(actor, request, next);
    });
    const operation = f.run().then(result => { settled = true; return result; });
    try {
      await began; await new Promise(resolve => setTimeout(resolve, 10));
      expect(settled).toBe(true); expect(holderSignal?.aborted).toBe(true);
      release(); const result = await operation;
      expect(result.errorCode).toBe(failure.reasonCode); expect(lateReads).toBe(0);
      expect(f.model.complete).toHaveBeenCalledTimes(3);
      expect(f.model.complete.mock.calls.some(([input]) => JSON.parse(input.user).chunks?.some((chunk: { taskId: string }) => chunk.taskId === "B"))).toBe(false);
      expect(result.sources.some(source => source.taskIds?.includes("B"))).toBe(false);
      const count = f.write.mock.calls.length; await Promise.resolve(); expect(f.write).toHaveBeenCalledTimes(count);
    } finally { release?.(); await operation; }
  });
  it("retains the original fatal error even if optional performance diagnostics fail", async () => {
    const failure = new Error("durable write failed");
    const budget = new SearchBudget();
    const complete = vi.fn(async () => null);
    const persist = Object.assign(async () => { throw failure; }, { requestId: "test", observe: () => {} });
    try {
      await expect(executeTaskPipeline(seed(), persist, { search: async () => [] }, budget, complete,
        () => { throw new Error("diagnostics unavailable"); })).rejects.toBe(failure);
      expect(complete).not.toHaveBeenCalled();
    } finally { budget.dispose(); }
  });

  it("completes 22 task-local searches with global task/model/read caps and serial durable writes", async () => {
    vi.useFakeTimers();
    const state = seed(); state.tasks = Array.from({ length: 22 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    let models = 0, peakModels = 0, reads = 0, peakReads = 0, writing = 0, peakWrites = 0;
    const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    const f = fixture(state, async () => { peakReads = Math.max(peakReads, ++reads); await delay(5); reads--; return { text: hit.content, contentKind: "text", truncated: false }; });
    f.search.mockImplementation(async query => { await delay(5); return Array.from({ length: 3 }, (_, index) => ({ ...hit, url: `${hit.url}/${query}/${index}` })); });
    f.model.complete.mockImplementation(async input => {
      peakModels = Math.max(peakModels, ++models); await delay(20); models--;
      return { text: guidedResearchReply(input.system, input.user)! };
    });
    const originalWrite = f.write.getMockImplementation()!;
    f.write.mockImplementation(async (actor, request, next) => { peakWrites = Math.max(peakWrites, ++writing); await delay(1); await originalWrite(actor, request, next); writing--; });
    const start = Date.now(); let terminalAt = start; let result: ResearchRuntime | undefined;
    const operation = f.run().then(value => { result = value; terminalAt = Date.now(); });
    try {
      await vi.advanceTimersByTimeAsync(1000); await operation;
      expect(result?.errorCode).toBeNull();
      expect(result?.tasks.filter(task => task.status === "succeeded")).toHaveLength(22);
      expect(result?.sources).toHaveLength(66);
      expect(result?.sources.every(source => source.document && source.taskIds?.length === 1)).toBe(true);
      expect(f.search).toHaveBeenCalledTimes(22); expect(f.model.complete).toHaveBeenCalledTimes(22);
      expect(peakModels).toBe(2); expect(peakReads).toBe(3); expect(peakWrites).toBe(1);
      expect(Math.max(...f.writes.map(snapshot => snapshot.tasks.filter(task => task.status === "running").length))).toBeLessThanOrEqual(3);
      expect(f.writes.some(snapshot => snapshot.sources.length && snapshot.tasks.some(task => task.status === "running"))).toBe(true);
      expect(terminalAt - start).toBeLessThan(22 * 30); // Equal mocked work; no online performance claim.
    } finally { await vi.runAllTimersAsync(); await operation; vi.useRealTimers(); }
  });
  it("reuses a successful URL read while retaining independent task relevance", async () => {
    const state = seed(); state.tasks = Array.from({ length: 3 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const read = vi.fn(async () => ({ text: hit.content, contentKind: "text" as const, truncated: false }));
    const f = fixture(state, read); f.search.mockResolvedValue([hit]);
    const result = await f.run();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.sources).toHaveLength(1);
    expect(new Set(result.sources[0]!.taskIds)).toEqual(new Set(state.tasks.map(task => task.id)));
    const scopedCalls = f.model.complete.mock.calls.map(([input]) => JSON.parse(input.user)).filter(context => context.researchStage === "source_relevance");
    expect(scopedCalls).toHaveLength(3);
    expect(scopedCalls.every(context => new Set(context.chunks.map((chunk: { taskId: string }) => chunk.taskId)).size === 1)).toBe(true);
  });
  it("drains a late valid partner after a fatal merge write without parsing or publishing it", async () => {
    const state = seed(); state.tasks = Array.from({ length: 6 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const f = fixture(state); f.search.mockImplementation(async query => [{ ...hit, url: `${hit.url}/${query}` }]);
    let release!: () => void, partner!: () => void, lateBodyReads = 0, settled = false;
    let partnerSignal: AbortSignal | undefined;
    const began = new Promise<void>(resolve => { partner = resolve; });
    f.model.complete.mockImplementation(async input => {
      const context = JSON.parse(input.user);
      if (context.chunks.some((chunk: { taskId: string }) => chunk.taskId === "task-1")) {
        partnerSignal = (input as { signal?: AbortSignal }).signal;
        partner(); await new Promise<void>(resolve => { release = resolve; });
        return { get text() { lateBodyReads++; return guidedResearchReply(input.system, input.user)!; } };
      }
      await began; return { text: guidedResearchReply(input.system, input.user)! };
    });
    const originalWrite = f.write.getMockImplementation()!;
    const failure = new ResearchRuntimeError("RESEARCH_PERSISTENCE_FAILED");
    f.write.mockImplementation(async (actor, request, next) => {
      if (next.busy && next.tasks[0]?.status === "succeeded") throw failure;
      await originalWrite(actor, request, next);
    });
    const operation = f.run().then(value => { settled = true; return value; });
    try {
      await began; await new Promise(resolve => setTimeout(resolve, 10));
      expect(settled).toBe(true); expect(partnerSignal?.aborted).toBe(true);
      expect(f.search.mock.calls.length).toBeLessThanOrEqual(3);
      release(); const result = await operation;
      expect(result.errorCode).toBe(failure.reasonCode); expect(lateBodyReads).toBe(0);
      expect(result.tasks.some(task => task.status === "running")).toBe(false);
      expect(result.tasks.some(task => task.searchAttempts?.some(record => record.status === "running"))).toBe(false);
      expect(result.modelCalls.find(call => call.id === result.modelCalls[1]?.id)?.status).toBe("failed");
      const writes = f.write.mock.calls.length; await Promise.resolve(); expect(f.write).toHaveBeenCalledTimes(writes);
      expect(result.sources.some(source => source.taskId === "task-1")).toBe(false);
    } finally { release?.(); await operation; }
  });
  it("caps overlapping multi-batch task screening globally rather than multiplying local batch limits", async () => {
    vi.useFakeTimers();
    const state = seed(); state.tasks = Array.from({ length: 3 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const f = fixture(state); let active = 0, peak = 0;
    f.search.mockImplementation(async query => Array.from({ length: 9 }, (_, index) => ({ ...hit, url: `${hit.url}/${query}/${index}` })));
    f.model.complete.mockImplementation(async input => {
      peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return { text: guidedResearchReply(input.system, input.user)! };
    });
    const operation = f.run();
    try {
      await vi.advanceTimersByTimeAsync(100);
      const result = await operation;
      expect(result.errorCode).toBeNull(); expect(result.sources).toHaveLength(27);
      expect(f.model.complete).toHaveBeenCalledTimes(6); expect(peak).toBe(2);
    } finally { await vi.runAllTimersAsync(); await operation; vi.useRealTimers(); }
  });
  it("isolates an ordinary task provider failure without discarding successful siblings", async () => {
    const state = seed(); state.tasks = Array.from({ length: 3 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const f = fixture(state); f.search.mockImplementation(async query => [{ ...hit, url: `${hit.url}/${query}` }]);
    f.model.complete.mockImplementation(async input => {
      const context = JSON.parse(input.user);
      if (context.chunks.some((chunk: { taskId: string }) => chunk.taskId === "task-0")) throw new Error("provider failed");
      return { text: guidedResearchReply(input.system, input.user)! };
    });
    const result = await f.run();
    expect(result.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
    expect(result.tasks.map(task => task.status)).toEqual(["failed", "succeeded", "succeeded"]);
    expect(result.sources).toHaveLength(2); expect(f.model.complete).toHaveBeenCalledTimes(3);
  });
  it("does not invoke a provider when serial attempt persistence fails", async () => {
    const state = seed(); state.tasks = Array.from({ length: 3 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const f = fixture(state); f.search.mockResolvedValue([hit]);
    const originalWrite = f.write.getMockImplementation()!;
    f.write.mockImplementation(async (actor, request, next) => {
      if (next.busy && next.modelCalls.length) throw new ResearchRuntimeError("RESEARCH_PERSISTENCE_FAILED");
      await originalWrite(actor, request, next);
    });
    const result = await f.run();
    expect(result.errorCode).toBe("RESEARCH_PERSISTENCE_FAILED");
    expect(f.model.complete).not.toHaveBeenCalled();
    expect(result.modelCalls).toHaveLength(1); expect(result.modelCalls[0]?.status).toBe("failed");
  });
  it("does not cache failed URL reads across a later independent task attempt", async () => {
    const state = seed(); state.tasks = Array.from({ length: 4 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    let calls = 0;
    const read = vi.fn(async () => { if (++calls === 1) throw new ResearchRuntimeError("RESEARCH_DOCUMENT_UNAVAILABLE"); return { text: hit.content, contentKind: "text" as const, truncated: false }; });
    const f = fixture(state, read); f.search.mockResolvedValue([hit]);
    const result = await f.run();
    expect(result.errorCode).toBeNull(); expect(read).toHaveBeenCalledTimes(2);
    expect(result.sources[0]?.document).toBeDefined(); expect(result.sources[0]?.documentError).toBeUndefined();
    expect(new Set(result.sources[0]?.taskIds)).toEqual(new Set(state.tasks.map(task => task.id)));
  });
  it("persists fast task evidence without waiting for a sibling screening model", async () => {
    const state = seed();
    state.tasks = Array.from({ length: 3 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const f = fixture(state);
    f.search.mockImplementation(async query => [{ ...hit, url: `${hit.url}/${query}` }]);
    let release!: () => void, started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    f.model.complete.mockImplementation(async input => {
      const context = JSON.parse(input.user);
      if (context.researchStage === "source_relevance" && context.chunks.some((chunk: { taskId: string }) => chunk.taskId === "task-0")) {
        started(); await new Promise<void>(resolve => { release = resolve; });
      }
      return { text: guidedResearchReply(input.system, input.user)! };
    });
    const operation = f.run();
    try {
      await began;
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(f.writes.some(snapshot => snapshot.tasks[1]?.status === "succeeded" && snapshot.tasks[0]?.status === "running")).toBe(true);
      expect(f.writes.some(snapshot => snapshot.sources.some(source => source.taskId === "task-1"))).toBe(true);
    } finally { release?.(); await operation; }
  });
  it("maps a confirmed chapter into one shared executable task without an extra planning model", async () => {
    const state = seed(); state.tasks = []; state.generatedNodes = ["brief", "directions", "outline"];
    state.outline[0]!.questions = ["国际版如何本地化？", "国际版上线时间？"];
    const f = fixture(state); f.search.mockResolvedValue([hit]);
    const result = await f.run();
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).not.toHaveProperty("questionId");
    expect(result.outline[0]!.questions).toEqual(state.outline[0]!.questions);
    expect(result.tasks.every(task => task.sectionId === "market" && task.status === "succeeded")).toBe(true);
    expect(f.model.complete.mock.calls.every(([input]) => JSON.parse(input.user).researchStage === "source_relevance")).toBe(true);
  });

  it.each(["search", "read"].flatMap(boundary => ["fatal", "pause"].map(stop => ({ boundary, stop }))))("aborts a blocked sibling $boundary on $stop and never consumes its late body", async ({ boundary, stop }) => {
    const state = seed(); state.tasks = [0, 1].map(index => ({ ...state.tasks[0]!, id: `fatal-${index}`, query: `fatal-query-${index}` }));
    let started!: () => void, release!: () => void, signal!: AbortSignal, lateReads = 0;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(state, boundary === "read" ? async (url, options) => {
      if (url.endsWith("1")) { signal = options!.signal!; started(); await blocked; }
      return { get text() { if (url.endsWith("1")) lateReads++; return hit.content; }, contentKind: "text", truncated: false };
    } : undefined);
    f.search.mockImplementation(async (query, ...args: unknown[]) => {
      if (query.endsWith("0")) await entered;
      if (boundary === "search" && query.endsWith("1")) { signal = (args[0] as { signal: AbortSignal }).signal; started(); await blocked; }
      return [{ ...hit, url: `${hit.url}/${query}`, get content() { if (boundary === "search" && query.endsWith("1")) lateReads++; return hit.content; } }];
    });
    const write = f.write.getMockImplementation()!, failure = new ResearchRuntimeError("RESEARCH_GRAPH_VERSION_CONFLICT"); let failed = false;
    f.write.mockImplementation(async (...args) => {
      if (!failed && args[2].sources.length) {
        await entered; failed = true;
        if (stop === "fatal") throw failure;
        const paused = structuredClone(args[2]); paused.controlStatus = "paused"; paused.planRevision = 1;
        await write(args[0], args[1], paused); return paused;
      }
      return write(...args);
    });
    const operation = f.run();
    try {
      await entered; const result = await operation;
      if (stop === "fatal") expect(result.errorCode).toBe(failure.reasonCode);
      else expect(result).toMatchObject({ controlStatus: "paused", errorCode: null, busy: false });
      expect(signal.aborted).toBe(true);
      const writes = f.writes.length; release(); await new Promise(resolve => setTimeout(resolve, 0));
      expect(lateReads).toBe(0); expect(f.writes).toHaveLength(writes);
    } finally { release(); await operation; }
  });
  it("persists successful tasks throughout a research execution beyond both 180s and 600s", async () => {
    vi.useFakeTimers();
    const state = seed(); state.tasks = Array.from({ length: 24 }, (_, index) => ({ ...state.tasks[0]!, id: `long-${index}`, query: `long-query-${index}` }));
    const f = fixture(state), complete = f.model.complete.getMockImplementation()!;
    f.search.mockImplementation(async query => [{ ...hit, url: `${hit.url}/${query}` }]);
    f.model.complete.mockImplementation(async input => { await new Promise(resolve => setTimeout(resolve, 60000)); return complete(input); });
    const started = Date.now(), operation = f.run();
    try {
      await vi.runAllTimersAsync(); const result = await operation;
      expect(Date.now() - started).toBeGreaterThan(600000); expect(result.errorCode).toBeNull();
      expect(result.tasks.every(task => task.status === "succeeded")).toBe(true); expect(result.sources).toHaveLength(24);
      expect(f.writes.some(write => write.tasks.some(task => task.status === "succeeded") && write.tasks.some(task => task.status !== "succeeded"))).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("bounds an unresponsive search per call and ignores late results", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release!: () => void;
    f.search.mockImplementation(async () => { await new Promise<void>((resolve) => { release = resolve; }); return [hit]; });
    let result: ResearchRuntime | undefined;
    const operation = f.run().then((value) => { result = value; return value; });
    try {
      await vi.runAllTimersAsync();
      expect(result).toBeDefined();
      expect(result?.busy).toBe(false);
      expect(result?.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
      expect(result?.tasks[0]?.status).toBe("failed");
      const count = f.writes.length;
      release(); await vi.advanceTimersByTimeAsync(1);
      expect(f.writes).toHaveLength(count);
      expect(result?.sources).toEqual([]);
    } finally { release?.(); await operation; vi.useRealTimers(); }
  });
  it.each(["model", "read"])("ignores late %s responses after per-call finalization", async (boundary) => {
    vi.useFakeTimers();
    const releases: Array<() => void> = [];
    const wait = () => new Promise<void>((resolve) => { releases.push(resolve); });
    const f = fixture(seed(), boundary === "read" ? async () => { await wait(); return { text: hit.content, contentKind: "text", truncated: false }; } : undefined);
    f.search.mockResolvedValue([hit]);
    if (boundary === "model") f.model.complete.mockImplementation(async () => { await wait(); return { text: "{}" }; });
    let result: ResearchRuntime | undefined;
    const operation = f.run().then((value) => { result = value; return value; });
    try {
      await vi.runAllTimersAsync();
      if (boundary === "model") expect(result?.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
      else expect(result?.sources.some(source => source.documentError)).toBe(true);
      expect(result?.busy).toBe(false);
      expect(result?.tasks.some((task) => task.status === "running")).toBe(false);
      expect(result?.tasks.some((task) => task.searchAttempts?.some((attempt) => attempt.status === "running"))).toBe(false);
      const finalized = JSON.stringify(result), count = f.writes.length;
      releases.forEach((release) => release()); await vi.advanceTimersByTimeAsync(1);
      expect(JSON.stringify(result)).toBe(finalized);
      expect(f.writes).toHaveLength(count);
      expect(result?.sources.some((source) => source.document)).toBe(false);
    } finally { releases.forEach((release) => release()); await operation; vi.useRealTimers(); }
  });
  it("continues a bounded queue after individual request timeouts while retaining fast successful evidence", async () => {
    vi.useFakeTimers();
    const state = seed(); state.tasks = Array.from({ length: 12 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const f = fixture(state); const releases: Array<() => void> = [];
    f.search.mockImplementation(async (query) => { if (query !== "query-0") await new Promise<void>((resolve) => releases.push(resolve)); return [{ ...hit, url: `${hit.url}/${query}` }]; });
    let result: ResearchRuntime | undefined;
    const operation = f.run().then((value) => { result = value; return value; });
    try {
      await vi.runAllTimersAsync();
      expect(result?.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
      expect(f.search.mock.calls.length).toBeGreaterThanOrEqual(12);
      expect(result?.tasks.filter((task) => task.searchAttempts?.length).map(task => task.query)).toEqual(state.tasks.map(task => task.query));
      expect(result?.tasks[0]?.status).toBe("succeeded");
      expect(result?.sources.some((source) => source.url.endsWith("/query-0"))).toBe(true);
      const count = f.writes.length; releases.forEach((release) => release()); await vi.advanceTimersByTimeAsync(1);
      expect(f.writes).toHaveLength(count);
    } finally { releases.forEach((release) => release()); await operation; vi.useRealTimers(); }
  });
  it("preserves a concurrent durable pause when an in-flight search reaches the deadline", async () => {
    vi.useFakeTimers();
    let paused = false;
    let durable = seed();
    const writes: ResearchRuntime[] = [];
    const store: GuidedRuntimeStore = {
      read: async () => structuredClone(durable),
      claim: async () => { durable.busy = true; return { state: structuredClone(durable), replay: false }; },
      write: async (_actor, _request, next) => {
        durable = structuredClone(next);
        if (paused) durable.controlStatus = "paused";
        writes.push(structuredClone(durable));
        return structuredClone(durable);
      },
    };
    let release!: () => void;
    const search = vi.fn(async () => { await new Promise<void>((resolve) => { release = resolve; }); return [hit]; });
    const service = new GuidedRuntimeService(store, { complete: async () => ({ text: "{}" }) }, { search }, { provider: "test", id: "test" });
    const actor = { orgId: toOrgId("recovery-org"), userId: "owner", sessionId: session.sessionId };
    const operation = service.execute(actor, session, { node: "research", action: "start", sessionId: session.sessionId, requestId: "pause-at-deadline", expectedVersion: 0 });
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(search).toHaveBeenCalledOnce();
      paused = true;
      await vi.advanceTimersByTimeAsync(180000);
      const result = await operation;
      expect(result).toMatchObject({ controlStatus: "paused", busy: false, errorCode: null });
      expect(durable).toMatchObject({ controlStatus: "paused", busy: false, errorCode: null });
      const count = writes.length;
      release(); await vi.advanceTimersByTimeAsync(1);
      expect(writes).toHaveLength(count);
      expect(durable.sources).toEqual([]);
    } finally { release?.(); await operation; vi.useRealTimers(); }
  });
  it("preserves a persistence error arriving at the deadline", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.write.mockImplementationOnce(async () => { await new Promise((resolve) => setTimeout(resolve, 180001)); throw new Error("durable write failure"); });
    const operation = f.run();
    try { await vi.advanceTimersByTimeAsync(180002); expect((await operation).errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE"); }
    finally { vi.useRealTimers(); }
  });
  it("retries incomplete supplements without replaying a successful initial query", async () => {
    const state = seed(); state.tasks[0]!.status = "succeeded";
    state.errorCode = "RESEARCH_SEARCH_TIME_BUDGET_EXCEEDED";
    state.tasks[0]!.searchAttempts = [{ query: original, status: "succeeded", errorCode: null }, { query: "partial supplement", status: "failed", errorCode: state.errorCode }];
    state.sources = [{ ...hit, id: "prior", taskId: "task", decision: "accepted", retrievedAt: "now", document: { text: hit.content, url: hit.url, retrievedAt: "now", contentHash: "a".repeat(64), contentKind: "text", truncated: false } }];
    const f = fixture(state, async () => ({ text: hit.content, contentKind: "text", truncated: false }));
    await f.run("retry");
    expect(f.search.mock.calls.length).toBeGreaterThan(0);
    expect(f.search.mock.calls.some(([query]) => query === original)).toBe(false);
  });
  it("settles each confirmed scope before dispatching the next direction", async () => {
    const state = seed();
    state.outline.push({ id: "second", title: "第二方向", questions: ["第二方向证据？"], enabled: true, order: 1 });
    state.tasks = [{ ...state.tasks[0]!, id: "later", sectionId: "second", query: "second-query" }, { ...state.tasks[0]!, id: "first", query: "first-query" }];
    const f = fixture(state);
    let release!: () => void, started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    f.search.mockImplementation(async (query) => { if (query === "first-query") { started(); await new Promise<void>((resolve) => { release = resolve; }); } return [hit]; });
    const operation = f.run();
    try {
      await began;
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(f.search.mock.calls.map(([query]) => query)).toEqual(["first-query"]);
      expect(f.writes.some(snapshot => snapshot.tasks[0]?.status === "pending" && snapshot.tasks[1]?.status === "running")).toBe(true);
    }
    finally { release?.(); await operation; }
    expect(f.search.mock.calls.map(([query]) => query)).toEqual(["first-query", "second-query"]);
    expect(f.writes.some(snapshot => snapshot.tasks[0]?.status === "running" && snapshot.tasks[1]?.status === "succeeded")).toBe(true);
  });
  it("persists edited topic information without sending the user back to import", async () => {
    const state = seed();
    const f = fixture(state);
    const saved = await f.saveBrief({ ...state.brief, topic: "更新主题" });
    expect(saved.currentNode).toBe("directions");
    expect(saved.availableNodes).toEqual(["brief", "directions"]);
    expect(saved.brief.topic).toBe("更新主题");
    expect(saved.tasks).toEqual([]);
    expect(saved.sources).toEqual([]);
    expect(saved.outline).toEqual([]);
  });
  it.each(["RESEARCH_SEARCH_UNAVAILABLE", "RESEARCH_EXECUTION_INTERRUPTED", "RESEARCH_SEARCH_REQUEST_TIMEOUT"])("allows an explicit retry after %s exhausted a previous attempt budget", async (errorCode) => {
    const state = seed();
    state.tasks[0]!.status = "failed";
    state.tasks[0]!.errorCode = errorCode;
    state.tasks[0]!.searchAttempts = Array.from({ length: C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT }, () => ({ query: original, status: "failed" as const, errorCode }));
    const f = fixture(state);
    f.search.mockResolvedValue([hit]);
    const result = await f.run("retry");
    expect(result.tasks[0]!.status).toBe("succeeded");
    expect(result.sources[0]?.url).toBe(hit.url);
    expect(f.search).toHaveBeenCalledTimes(1);
  });
  it("persists fast search results and fills a free slot while another query is still pending", async () => {
    const state = seed();
    state.tasks = Array.from({ length: 4 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const f = fixture(state);
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    let nextStarted!: () => void;
    const next = new Promise<void>((resolve) => { nextStarted = resolve; });
    f.search.mockImplementation(async (query) => {
      if (query === "query-0") await slow;
      if (query === "query-3") nextStarted();
      return [{ ...hit, url: `${hit.url}/${query}` }];
    });
    const operation = f.run();
    try {
      await Promise.race([next, new Promise((_, reject) => setTimeout(() => reject(new Error("search batch barrier")), 1000))]);
      expect(f.writes.some((snapshot) => snapshot.tasks[1]!.status === "succeeded" && snapshot.tasks[0]!.status === "running")).toBe(true);
    } finally { release(); await operation; }
  });


  it("keeps remaining primaries moving while two long multi-attempt recoveries compete for task slots", async () => {
    const state = seed(); state.tasks = Array.from({ length: 6 }, (_, index) => ({ ...state.tasks[0]!, id: `fair-${index}`, query: `fair-primary-${index}` }));
    const f = fixture(state); let releasePrimary!: () => void, releaseRecovery!: () => void, primaryStarted!: () => void;
    const primary = new Promise<void>(resolve => { releasePrimary = resolve; });
    const recovery = new Promise<void>(resolve => { releaseRecovery = resolve; });
    const began = new Promise<void>(resolve => { primaryStarted = resolve; });
    f.search.mockImplementation(async query => {
      if (["fair-primary-0", "fair-primary-1"].includes(query) || query.endsWith("-one")) return [];
      if (query === "fair-primary-2") { primaryStarted(); await primary; }
      if (query.endsWith("-two")) await recovery;
      return [{ ...hit, url: `${hit.url}/${encodeURIComponent(query)}` }];
    });
    f.model.complete.mockImplementation(async input => {
      const context = JSON.parse(input.user);
      if (context.researchStage === "search_recovery") return { text: JSON.stringify({ queries: [`recover-${context.task.id}-one`, `recover-${context.task.id}-two`] }) };
      return { text: guidedResearchReply(input.system, input.user)! };
    });
    const operation = f.run();
    try {
      await began; await new Promise(resolve => setTimeout(resolve, 20));
      expect(f.search.mock.calls.some(([query]) => query === "fair-primary-5")).toBe(true);
      expect(f.search.mock.calls.some(([query]) => query === "recover-fair-0-two")).toBe(true);
    } finally { releasePrimary(); releaseRecovery(); await operation; }
    const result = await operation;
    expect(result.tasks.every(task => task.status === "succeeded" && task.attempts === 1)).toBe(true);
    expect(result.tasks.slice(0, 2).every(task => task.searchAttempts?.length === 3 && task.searchAttempts.length <= C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT)).toBe(true);
  });
  it("starts task recovery before a blocked sibling primary finishes, while free workers admit later primaries", async () => {
    const state = seed();
    state.tasks = Array.from({ length: 5 }, (_, index) => ({ ...state.tasks[0]!, id: `immediate-${index}`, query: `primary-${index}` }));
    const f = fixture(state);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let primaryStarted!: () => void;
    const began = new Promise<void>(resolve => { primaryStarted = resolve; });
    f.search.mockImplementation(async query => {
      if (query === "primary-0") return [];
      if (query === "primary-1") { primaryStarted(); await blocked; }
      return [{ ...hit, url: `${hit.url}/${encodeURIComponent(query)}` }];
    });
    const operation = f.run();
    try {
      await began; await new Promise(resolve => setTimeout(resolve, 20));
      expect(f.search.mock.calls.some(([query]) => query === short)).toBe(true);
      expect(f.search.mock.calls.some(([query]) => query === "primary-4")).toBe(true);
      const recovery = f.writes.find(snapshot => snapshot.tasks[0]!.status === "succeeded");
      expect(recovery?.tasks[1]!.status).toBe("running");
      expect(recovery?.tasks[0]!.searchAttempts?.map(attempt => attempt.status)).toEqual(["failed", "succeeded"]);
    } finally { release(); await operation; }
    const result = f.writes.at(-1)!;
    expect(result.tasks.every(task => task.status === "succeeded" && task.attempts === 1)).toBe(true);
    expect(result.tasks.every(task => (task.searchAttempts?.length ?? 0) <= C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT)).toBe(true);
    const count = f.search.mock.calls.length;
    await f.run("retry"); expect(f.search).toHaveBeenCalledTimes(count);
  });
  it("does not hold completed sibling results behind a slow recovery query", async () => {
    const state = seed();
    state.tasks = Array.from({ length: 4 }, (_, index) => ({ ...state.tasks[0]!, id: `task-${index}`, query: `query-${index}` }));
    const f = fixture(state);
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    let recoveryStarted!: () => void, laterStarted!: () => void;
    const recovery = new Promise<void>((resolve) => { recoveryStarted = resolve; });
    const later = new Promise<void>(resolve => { laterStarted = resolve; });
    f.search.mockImplementation(async (query) => {
      if (query === "query-0") return [];
      if (query === short) { recoveryStarted(); await slow; }
      if (query === "query-3") laterStarted();
      return [{ ...hit, url: `${hit.url}/${encodeURIComponent(query)}` }];
    });
    const operation = f.run();
    try {
      await recovery;
      await Promise.race([later, new Promise((_, reject) => setTimeout(() => reject(new Error("recovery held a free task worker")), 1000))]);
      expect(f.search.mock.calls.some(([query]) => query === "query-3")).toBe(true);
      expect(f.writes.some((snapshot) => snapshot.tasks[1]!.status === "succeeded")).toBe(true);
    } finally { release(); await operation; }
  });


  it("isolates an immediate recovery provider failure and retains an independently successful sibling", async () => {
    const state = seed(); state.tasks.push({ ...state.tasks[0]!, id: "sibling", query: "sibling-query" });
    const f = fixture(state); f.search.mockImplementation(async query => query === original ? [] : [hit]);
    f.model.complete.mockImplementation(async input => {
      if (JSON.parse(input.user).researchStage === "search_recovery") throw new Error("controlled recovery provider failure");
      return { text: guidedResearchReply(input.system, input.user)! };
    });
    const result = await f.run();
    expect(result.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
    expect(result.tasks.map(task => task.status)).toEqual(["failed", "succeeded"]);
    expect(result.tasks[0]!.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE"); // Existing completeJson provider-error mapping is preserved.
    expect(result.tasks[0]!.searchAttempts).toHaveLength(1);
    expect(result.sources).toHaveLength(1); expect(result.sources[0]!.taskId).toBe("sibling");
    expect(f.search.mock.calls.map(([query]) => query)).toEqual([original, "sibling-query"]);
  });
  it("lets immediate recovery wait for a shared URL holder without deadlocking or inventing task evidence", async () => {
    const state = seed(); state.tasks.push({ ...state.tasks[0]!, id: "holder", query: "holder-query" });
    const f = fixture(state); let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void; const began = new Promise<void>(resolve => { started = resolve; });
    f.search.mockImplementation(async query => query === original ? [] : [hit]);
    f.model.complete.mockImplementation(async input => {
      const context = JSON.parse(input.user);
      if (context.researchStage === "search_recovery") return { text: JSON.stringify({ queries: [short] }) };
      if (context.chunks[0].taskId === "holder") { started(); await held; }
      return { text: guidedResearchReply(input.system, input.user)! };
    });
    const operation = f.run();
    try {
      await began; await new Promise(resolve => setTimeout(resolve, 20));
      expect(f.search.mock.calls.some(([query]) => query === short)).toBe(true);
    } finally { release(); await operation; }
    const result = await operation;
    expect(result.tasks.map(task => task.status)).toEqual(["succeeded", "succeeded"]);
    expect(result.sources).toHaveLength(1); expect(new Set(result.sources[0]!.taskIds)).toEqual(new Set(["task", "holder"]));
    expect(result.sources[0]!.content).toBe(hit.content);
    expect(result.tasks[0]!.searchAttempts?.map(attempt => attempt.status)).toEqual(["failed", "succeeded"]);
  });
  it("stops and drains an issued immediate recovery after fatal persistence without parsing its late query or launching it", async () => {
    const state = seed(); state.tasks.push({ ...state.tasks[0]!, id: "successful", query: "successful-query" });
    const f = fixture(state); f.search.mockImplementation(async query => query === original ? [] : [hit]);
    let release!: () => void, started!: () => void, lateReads = 0, settled = false;
    let recoverySignal: AbortSignal | undefined;
    const began = new Promise<void>(resolve => { started = resolve; });
    f.model.complete.mockImplementation(async input => {
      if (JSON.parse(input.user).researchStage === "search_recovery") {
        recoverySignal = (input as { signal?: AbortSignal }).signal; started();
        await new Promise<void>(resolve => { release = resolve; });
        return { get text() { lateReads++; return JSON.stringify({ queries: [short, second] }); } };
      }
      await began; return { text: guidedResearchReply(input.system, input.user)! };
    });
    const write = f.write.getMockImplementation()!, failure = new ResearchRuntimeError("RESEARCH_PERSISTENCE_FAILED");
    f.write.mockImplementation(async (actor, request, next) => {
      if (next.busy && next.tasks[1]!.status === "succeeded") throw failure;
      await write(actor, request, next);
    });
    const operation = f.run().then(value => { settled = true; return value; });
    try {
      await began; await new Promise(resolve => setTimeout(resolve, 20));
      expect(settled).toBe(true); expect(recoverySignal?.aborted).toBe(true);
      expect(f.search.mock.calls.map(([query]) => query)).toEqual([original, "successful-query"]);
      release(); const result = await operation;
      expect(result.errorCode).toBe(failure.reasonCode); expect(lateReads).toBe(0);
      expect(result.tasks[0]!.searchAttempts).toHaveLength(1);
      expect(result.modelCalls).toHaveLength(2);
      expect(result.modelCalls.map(call => call.status)).toContain("failed");
      const writes = f.writes.length; await Promise.resolve(); expect(f.writes).toHaveLength(writes);
    } finally { release?.(); await operation; }
  });
  it("persists readable source bodies and summaries during research, before report generation", async () => {
    const read = vi.fn(async () => ({ text: hit.content, contentKind: "html" as const, truncated: false }));
    const f = fixture(seed(), read);
    f.search.mockResolvedValue(Array.from({ length: 3 }, (_, index) => ({ ...hit, url: `${hit.url}/${index}` })));
    const state = await f.run();
    expect(state.currentNode).toBe("research");
    expect(state.report).toBeNull();
    expect(state.sources).toHaveLength(3);
    expect(state.sources.every((source) => source.document?.summary === hit.content)).toBe(true);
    expect(f.writes.some((snapshot) => snapshot.currentNode === "research" && snapshot.sources.every((source) => source.document?.summary) && snapshot.sources.length === 3)).toBe(true);
    expect(C.GuidedResearchRuntime.parse(state).sources[0]!.document?.summary).toBe(hit.content);
    await f.run("retry");
    expect(read).toHaveBeenCalledTimes(3);
  });
  it.each([false, true])("recovers empty or irrelevant results with a distinct query (irrelevant=%s)", async (irrelevant) => {
    const f = fixture(); f.search.mockImplementation(async (query) => query === original ? irrelevant ? [car] : [] : [hit]);
    const state = await f.run();
    expect(state.errorCode).toBeNull();
    expect(f.search.mock.calls.map(([query]) => query)).toEqual([original, short]);
    expect(state.tasks[0]!.query).toBe(original);
    expect(state.tasks[0]!.searchAttempts?.map((attempt) => attempt.status)).toEqual(["failed", "succeeded"]);
    expect(state.sources.map((source) => source.url)).toEqual([hit.url]);
    expect(f.writes.some((state) => state.tasks[0]!.searchAttempts?.at(-1)?.status === "running")).toBe(true);
    const report = await f.run("complete");
    expect(report.currentNode).toBe("report");
    expect(report.errorCode).toBeNull();
    expect(report.report).not.toBeNull();
    expect(report.reportPartial).toBe(false);
  });
  it("bounds empty recovery to two alternatives and retains a real failure", async () => {
    const f = fixture(); f.search.mockResolvedValue([]);
    const state = await f.run();
    expect(f.search.mock.calls.map(([query]) => query)).toEqual([original, short, second]);
    expect(state.tasks[0]!.errorCode).toBe("RESEARCH_SEARCH_EMPTY");
    expect(state.sources).toEqual([]);
  });
  it("does not repeat previously exhausted queries after retry or refresh", async () => {
    const f = fixture(); f.search.mockResolvedValue([]); const failed = await f.run();
    const resumed = fixture(failed); resumed.setQueries([short, "Honor of Kings localized events"]);
    const state = await resumed.run("retry");
    expect(resumed.search.mock.calls.map(([query]) => query)).toEqual(["Honor of Kings localized events"]);
    expect(state.tasks[0]!.status).toBe("succeeded");
  });
  it.each(["", "'", "‘’", "「」", "『』", "«»", "＂", "`"])("ignores duplicate query rewrites using quote variant %s", async (quotes) => {
    const f = fixture(); f.setQueries([original.replaceAll('"', quotes), `  ${original}  `]);
    const state = await f.run();
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(state.tasks[0]!.status).toBe("failed");
  });
  it.each([new Error("provider"), new ResearchRuntimeError("RESEARCH_SEARCH_EMPTY")])("does not rewrite after a provider exception", async (error) => {
    const f = fixture(); f.search.mockRejectedValue(error);
    const state = await f.run();
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(f.model.complete).not.toHaveBeenCalled();
    const resumed = fixture(state); resumed.search.mockRejectedValue(error);
    const retried = await resumed.run("retry");
    expect(resumed.search).toHaveBeenCalledTimes(1);
    expect(resumed.model.complete).not.toHaveBeenCalled();
    expect(retried.tasks[0]!.errorCode).toBe("RESEARCH_SEARCH_UNAVAILABLE");
  });
  it("does not rewrite after relevance validation fails", async () => {
    const f = fixture(); f.search.mockResolvedValue([hit]); f.model.complete.mockResolvedValue({ text: "{}" });
    const state = await f.run();
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    expect(state.tasks[0]!.errorCode).toBe("RESEARCH_SOURCE_RELEVANCE_INVALID");
  });
  it("does not search when recording the attempt fails", async () => {
    const f = fixture(); f.write.mockImplementation(async (_actor, _request, state) => {
      if (state.tasks[0]!.searchAttempts?.length) throw new ResearchRuntimeError("RESEARCH_SEARCH_EMPTY");
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.search).not.toHaveBeenCalled();
  });
  it("does not replay successful tasks and keeps recovery within its durable budget", async () => {
    const state = seed(); state.tasks[0]!.status = "failed"; state.tasks[0]!.errorCode = "RESEARCH_SEARCH_EMPTY";
    state.tasks[0]!.searchAttempts = Array.from({ length: C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT }, (_, index) => ({ query: `query ${index}`, status: "failed", errorCode: "RESEARCH_SEARCH_EMPTY" }));
    const f = fixture(state); const result = await f.run("retry");
    expect(f.search).not.toHaveBeenCalled(); expect(f.model.complete).not.toHaveBeenCalled();
    expect(result.tasks[0]!.status).toBe("failed");
  });
  it("allows an explicitly partial report after exhausted recovery while preserving gaps", async () => {
    const f = fixture(); await f.run();
    const state = f.writes.at(-1)!;
    state.tasks.push({ ...state.tasks[0]!, id: "missing", status: "failed", errorCode: "RESEARCH_SEARCH_EMPTY", searchAttempts: undefined });
    const partial = fixture(state);
    const blocked = await partial.run("complete");
    expect(blocked.errorCode).toBe("RESEARCH_TASKS_INCOMPLETE");
    const report = await partial.run("complete", true);
    expect(report.currentNode).toBe("report"); expect(report.errorCode).toBeNull();
    expect(report.reportPartial).toBe(true); expect(report.report).not.toBeNull();
    expect(report.tasks.find((task) => task.id === "missing")!.status).toBe("failed");
    expect(partial.search).not.toHaveBeenCalled();
  });
  it("does not permit partial continuation without any real source", async () => {
    const state = seed(); state.tasks[0]!.status = "failed";
    const f = fixture(state); const result = await f.run("complete", true);
    expect(result.report).toBeNull(); expect(result.currentNode).toBe("research");
    expect(result.errorCode).toBe("RESEARCH_SOURCES_REQUIRED");
  });
});

it("keeps a per-question task failed when every source answers only its sibling", async () => {
  const state = seed(); state.generatedNodes = ["brief", "directions", "outline"];
  state.outline[0]!.questions = ["A evidence?", "B evidence?"];
  state.tasks = state.outline[0]!.questions.map((question, index) => ({ ...state.tasks[0]!, id: `precise-${index}`, questionId: `chapter:0/question:${index}`, objective: question, query: `${question} public evidence` }));
  const f = fixture(state); f.search.mockResolvedValue([hit]);
  f.model.complete.mockImplementation(async input => {
    const output = JSON.parse(guidedResearchReply(input.system, input.user)!);
    if (output.evaluations) for (const entry of output.evaluations) for (const match of entry.matches) match.questionId = "chapter:0/question:1";
    return { text: JSON.stringify(output) };
  });
  const result = await f.run();
  expect(result.tasks.find(task => task.questionId === "chapter:0/question:0")?.status).toBe("failed");
  expect(result.tasks.find(task => task.questionId === "chapter:0/question:1")?.status).toBe("succeeded");
  expect(result.sources.every(source => result.tasks.find(task => task.id === source.taskId)?.questionId === "chapter:0/question:1")).toBe(true);
});


describe("fair local primary/recovery task queues", () => {
  it("reserves recovery progress during primary work, then borrows three slots only after the producer drains", async () => {
    let releasePrimary!: () => void, releaseRecovery!: () => void, early!: () => void, borrowed!: () => void;
    const primaryGate = new Promise<void>(resolve => { releasePrimary = resolve; });
    const recoveryGate = new Promise<void>(resolve => { releaseRecovery = resolve; });
    const first = new Promise<void>(resolve => { early = resolve; });
    const three = new Promise<void>(resolve => { borrowed = resolve; });
    let primaryActive = 0, recoveryActive = 0, primaryPeak = 0, totalPeak = 0;
    const starts: number[] = [];
    const operation = fairTaskWork([0, 1, 2, 3], 3, async item => {
      primaryPeak = Math.max(primaryPeak, ++primaryActive); totalPeak = Math.max(totalPeak, primaryActive + recoveryActive);
      try { if (item >= 2) await primaryGate; return true; } finally { primaryActive--; }
    }, async item => {
      starts.push(item); recoveryActive++; totalPeak = Math.max(totalPeak, primaryActive + recoveryActive);
      if (recoveryActive === 1) early(); if (recoveryActive === 3) borrowed();
      try { await recoveryGate; } finally { recoveryActive--; }
    }, () => {}, () => {});
    try {
      await first; expect(primaryActive).toBe(2); expect(recoveryActive).toBe(1);
      releasePrimary(); await three;
      expect(primaryActive).toBe(0); expect(recoveryActive).toBe(3); expect(starts).toEqual([0, 1, 2]);
    } finally { releasePrimary(); releaseRecovery(); await operation; }
    expect(primaryPeak).toBe(2); expect(totalPeak).toBe(3); expect(starts).toEqual([0, 1, 2, 3]);
  });
  it("preserves the first fatal error, stops queue dispatch, and drains issued primaries before rejecting", async () => {
    let release!: () => void, failed!: () => void, stopped: unknown, settled = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { failed = resolve; });
    const failure = new Error("first queue failure"), starts: number[] = [];
    const operation = fairTaskWork([0, 1, 2, 3, 4], 3, async item => {
      starts.push(item); if (!item) return true; await gate; if (stopped) throw new Error("later partner failure"); return false;
    }, async () => { failed(); throw failure; }, () => { if (stopped) throw stopped; }, error => { stopped = error; })
      .then(() => { settled = true; }, error => { settled = true; return error; });
    try {
      await began; await new Promise(resolve => setTimeout(resolve, 2));
      expect(stopped).toBe(failure); expect(settled).toBe(false); expect(starts).toEqual([0, 1, 2]);
      release(); expect(await operation).toBe(failure);
      const dispatched = [...starts]; await Promise.resolve(); expect(starts).toEqual(dispatched);
    } finally { release(); await operation; }
  });
});


it("does not rebuild existing per-question tasks on retry after chapter-shared initial derivation", async () => {
  const state = seed(); state.tasks[0] = { ...state.tasks[0]!, questionId: "chapter:0/question:0", status: "succeeded", attempts: 3, searchAttempts: [{ query: original, status: "succeeded", errorCode: null }] };
  const prior = structuredClone(state.tasks); const f = fixture(state); const result = await f.run("retry");
  expect(result.tasks).toEqual(prior); expect(f.search).not.toHaveBeenCalled(); expect(f.model.complete).not.toHaveBeenCalled();
});
