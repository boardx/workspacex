import { createHash } from "node:crypto";
import { generateReportChapters } from "../../src/application/research/guided-report-chapters";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { guidedResearchReply } from "../../scripts/loopback-guided-research";
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

it("keeps source-heavy reports on one four-worker evidence scope", async () => {
  const text = "Official policy requires a local application and verification before connection.";
  const state = {
    sessionId: "many-sources", version: 1, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Policy", goal: "Compare", region: "EU", timeRange: "2026", focus: "Requirements" }, directions: [],
    outline: ["first", "second", "third"].map((id, order) => ({ id, title: `${id} policy`, order, enabled: true, questions: [`What are the ${id} requirements?`] })),
    tasks: [{ id: "task", sectionId: "first", query: "policy", status: "succeeded", attempts: 1, errorCode: null }],
    sources: Array.from({ length: 43 }, (_, i) => {
      const content = `${text} Unique source ${i}.`; const url = `https://example.org/${i}`;
      return { id: `source-${i}`, taskId: "task", title: `Source ${i}`, content, url, retrievedAt: "2026-10-20", decision: "accepted",
        document: { text: content, url, contentHash: createHash("sha256").update(content).digest("hex"), retrievedAt: "2026-10-20", contentKind: "text", truncated: false, summary: content } };
    }),
    report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [],
  } as ResearchRuntime;
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
