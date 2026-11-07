import { createHash } from "node:crypto";
import { generateReportChapters } from "../../src/application/research/guided-report-chapters";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { guidedResearchReply } from "../../scripts/loopback-guided-research";
import { expect, it, vi } from "vitest";
import * as queues from "../../src/application/research/guided-report-work-queue";
import { reportWorkQueue, queuedReportRequest } from "../../src/application/research/guided-report-work-queue";

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

function reportFixture(sourceCount = 43): ResearchRuntime {
  const text = "Official policy requires a local application and verification before connection.";
  return {
    sessionId: "many-sources", version: 1, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Policy", goal: "Compare", region: "EU", timeRange: "2026", focus: "Requirements" }, directions: [],
    outline: ["first", "second", "third"].map((id, order) => ({ id, title: `${id} policy`, order, enabled: true, questions: [`What are the ${id} requirements?`] })),
    tasks: [{ id: "task", sectionId: "first", query: "policy", status: "succeeded", attempts: 1, errorCode: null }],
    sources: Array.from({ length: sourceCount }, (_, i) => {
      const content = `${text} Unique source ${i}.`; const url = `https://example.org/${i}`;
      return { id: `source-${i}`, taskId: "task", title: `Source ${i}`, content, url, retrievedAt: "2026-10-20", decision: "accepted",
        document: { text: content, url, contentHash: createHash("sha256").update(content).digest("hex"), retrievedAt: "2026-10-20", contentKind: "text", truncated: false, summary: content } };
    }),
    report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [],
  } as ResearchRuntime;
}

it("keeps source-heavy reports on one four-worker evidence scope", async () => {
  const state = reportFixture();
  let active = 0, peak = 0; const scopes: string[][] = [];
  const model: ModelCallPort = { configurationIdentity: "many-source-test", complete: async input => {
    const context = JSON.parse(input.user);
    if (context.reportStage === "evidence") {
      scopes.push([...new Set<string>(context.questions.map((q: { sectionId: string }) => q.sectionId))]);
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
    }
    return { text: guidedResearchReply(input.system, input.user)! };
  } };
  const persist: RuntimePersistence = Object.assign(async () => {}, { requestId: "many-source", observe: () => {} });
  const report = await generateReportChapters(state, model, { provider: "controlled", id: "controlled" }, persist);
  expect(report.sections.map(section => section.sectionId)).toEqual(["first", "second", "third"]);
  expect(scopes).toHaveLength(6);
  expect(scopes.every(scope => scope.join(",") === "first,second,third")).toBe(true);
  expect(peak).toBe(4);
  scopes.length = 0;
  await generateReportChapters(state, model, { provider: "controlled", id: "controlled" }, persist);
  expect(scopes).toHaveLength(0);
});


it("starts the full provider budget only after a queued report request is admitted", async () => {
  vi.useFakeTimers();
  const queue = reportWorkQueue(4); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const holders = Array.from({ length: 4 }, () => queue.run(() => held));
  const factory = vi.spyOn(queues, "reportWorkQueue").mockReturnValue(queue);
  const admission = vi.spyOn(queue, "run");
  const state = reportFixture(1); const firstScopeAttempts: string[] = [];
  const model: ModelCallPort = { complete: async input => {
    const context = JSON.parse(input.user);
    if (context.reportStage === "evidence" && context.questions[0]?.sectionId === "first") {
      firstScopeAttempts.push(context.reportStage);
      // Both queue wait80s and provider work89s are individually below90s.
      await new Promise(resolve => setTimeout(resolve, 89_000));
    }
    return { text: guidedResearchReply(input.system, input.user)! };
  } };
  const persist: RuntimePersistence = Object.assign(async () => {}, { requestId: "queue-budget", observe: () => {} });
  const running = generateReportChapters(state, model, { provider: "controlled", id: "controlled" }, persist)
    .then(report => ({ report, error: undefined }), error => ({ report: undefined, error }));
  try {
    await vi.waitFor(() => expect(admission).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(80_000);
    expect(firstScopeAttempts).toHaveLength(0);
    release(); await Promise.all(holders);
    await vi.runAllTimersAsync();
    const result = await running;
    expect(result.error).toBeUndefined();
    expect(result.report?.sections).toHaveLength(3);
    expect(firstScopeAttempts).toHaveLength(1);
  } finally {
    release(); await Promise.all(holders); await vi.runAllTimersAsync(); await running;
    admission.mockRestore(); factory.mockRestore(); vi.useRealTimers();
  }
});


it("holds all four permits until ignored-abort provider promises actually settle", async () => {
  vi.useFakeTimers();
  const queue = reportWorkQueue(4); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let active = 0, peak = 0, fifthStarted = false;
  const occupied = Array.from({ length: 4 }, () => queuedReportRequest(queue, async () => {
    active++; peak = Math.max(peak, active);
    await held; active--;
  }));
  const expired = Promise.allSettled(occupied);
  const fifth = queuedReportRequest(queue, async () => {
    fifthStarted = true; active++; peak = Math.max(peak, active); active--; return "admitted";
  });
  try {
    await vi.advanceTimersByTimeAsync(90_001);
    expect((await expired).every(result => result.status === "rejected")).toBe(true);
    expect(active).toBe(4);
    expect(fifthStarted).toBe(false);
    release();
    expect(await fifth).toBe("admitted");
    expect(peak).toBe(4);
  } finally {
    release(); await vi.runAllTimersAsync(); await Promise.allSettled([...occupied, fifth]); vi.useRealTimers();
  }
});

it("cancels admission before a provider budget or external request starts", async () => {
  const queue = reportWorkQueue(1); let release!: () => void;
  const occupied = queue.run(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  const parent = new AbortController(); let started = false;
  const waiting = queuedReportRequest(queue, async () => { started = true; }, parent.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  try { parent.abort(); await rejected; expect(started).toBe(false); }
  finally { release(); await occupied; }
  expect(await queuedReportRequest(queue, async () => "available")).toBe("available");
});

it("does not dispatch when cancellation arrives after permit grant but before provider start", async () => {
  const queue = reportWorkQueue(4); const parent = new AbortController(); let started = false;
  const waiting = queuedReportRequest(queue, async () => { started = true; }, parent.signal);
  parent.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  expect(started).toBe(false);
});
