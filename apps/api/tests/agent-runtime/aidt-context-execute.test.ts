/** Actual executor over in-memory ports. This is not supplier/model acceptance. */
import { expect, it, vi } from "vitest";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { AgentRunStore, ModelCallInput, ModelCallPort, RunFailureCode, ThreadHistoryMessage } from "../../src/application/agent-run/ports";
import { frozenFixture, frozenStoredFixture, AIDT_REFERENCE_ORG as org } from "../support/aidt-context-fixture";
function store(run = frozenFixture()) {
  let failed: RunFailureCode | null = null;
  const unexpected = async (): Promise<never> => { throw new Error("Unexpected execution port"); };
  const history: readonly ThreadHistoryMessage[] = [{ id: "history-real", role: "user", content: "earlier student words" }];
  const result: AgentRunStore = {
    claimQueued: async () => [{ kind: "executable", run }], reclaimStaleRunning: unexpected,
    readPinnedSkills: async () => [{ versionId: "skill-v1", stableName: "aidt-understand", name: "理解问题", content: "Ask the student; do not invent evidence." }],
    appendStep: vi.fn(async () => {}), appendModelDelta: vi.fn(async () => {}), readModelDeltas: async () => [],
    storeOutputAwaitingWriteback: vi.fn(async () => {}), failRun: async (_org, _run, code) => { failed = code; },
    markAwaitingToolPermission: unexpected, approveAndRequeue: unexpected, denyAndRequeue: unexpected, editAndRequeue: unexpected,
    claimWritebackPending: unexpected, commitWriteback: unexpected, recordWritebackAttempt: unexpected, reopenForWritebackRetry: unexpected, appendWritebackFailure: unexpected,
    findLocator: async () => null, findAwaitingToolPermissionRunId: async () => null, readRun: async () => null,
    readThreadHistory: vi.fn(async () => history), readThreadContextState: async () => null, upsertThreadContextState: async () => true, readRunTranscriptSteps: async () => null,
  };
  return { port: result, failed: () => failed, history };
}
function deps(runs: AgentRunStore, model: ModelCallPort): ExecuteAgentRunDeps {
  return { runs, model, clock: { now: () => "2026-11-16T00:00:00.000Z", newStepId: () => "step" }, log: vi.fn() };
}
it("the real executor delivers one frozen reference alongside exact human input and real history coordinates", async () => {
  const run = frozenFixture(), runs = store(run), seen: ModelCallInput[] = [];
  const contexts = { resolve: vi.fn(async () => frozenStoredFixture()), revalidate: vi.fn(async () => {}), append: vi.fn(async () => {}) };
  await executeQueuedRuns({ ...deps(runs.port, { complete: async input => { seen.push(input); return { text: "offline answer" }; } }), aidtContexts: contexts }, { orgId: org });
  expect(runs.failed()).toBeNull(); expect(seen).toHaveLength(1); expect(seen[0]?.user).toBe(run.inputText);
  expect(seen[0]?.system).not.toContain(frozenStoredFixture().snapshot.modelReferenceBlock);
  expect(seen[0]?.history?.filter(row => row.content === frozenStoredFixture().snapshot.modelReferenceBlock)).toEqual([{ role: "user", content: frozenStoredFixture().snapshot.modelReferenceBlock }]);
  expect(seen[0]?.referenceDispatchObserver?.historyIndex).toBe(seen[0]!.history!.length - 1);
  expect(contexts.append).toHaveBeenCalledWith(org, "run", expect.objectContaining({ kind: "assembled" }));
});
it("routes a greeting through the pinned stage skill and describes the stage input and output", async () => {
  const run = { ...frozenFixture(), inputText: "你好" };
  const runs = store(run);
  const complete = vi.fn(async (_input: ModelCallInput) => ({ text: "stage answer" }));
  const contexts = { resolve: vi.fn(async () => frozenStoredFixture()), revalidate: vi.fn(async () => {}), append: vi.fn(async () => {}) };
  await executeQueuedRuns({ ...deps(runs.port, { complete }), aidtContexts: contexts }, { orgId: org });
  expect(runs.failed()).toBeNull();
  expect(complete).toHaveBeenCalledOnce();
  const input = complete.mock.calls[0]![0];
  expect(input.user).toBe("你好");
  expect(input.system).toContain("「理解问题」Skill");
  expect(input.system).toContain("用户只打招呼时");
  expect(input.system).toContain("Ask the student; do not invent evidence.");
  expect(input.skills?.map(skill => skill.versionId)).toEqual(["skill-v1"]);
});
it.each(["snapshot", "port", "revoked"])("fails before any model call when the expected %s is unavailable", async kind => {
  const original = frozenFixture(), run = kind === "snapshot" ? { ...original, aidtContext: undefined } : original;
  const runs = store(run), complete = vi.fn(async () => ({ text: "must not be called" }));
  const contexts = { resolve: vi.fn(async () => frozenStoredFixture()), revalidate: vi.fn(async () => { if (kind === "revoked") throw new Error("access revoked"); }), append: vi.fn(async () => {}) };
  await executeQueuedRuns({ ...deps(runs.port, { complete }), ...(kind === "port" ? {} : { aidtContexts: contexts }) }, { orgId: org });
  expect(complete).not.toHaveBeenCalled(); expect(runs.failed()).toBe("MODEL_CALL_FAILED");
});
it("ordinary execution adds neither a reference observer nor AIDT reads/journal events", async () => {
  const { aidtContext: _context, aidtSelectorHash: _marker, ...run } = frozenFixture(), runs = store(run), seen: ModelCallInput[] = [];
  const contexts = { resolve: vi.fn(async () => frozenStoredFixture()), revalidate: vi.fn(async () => {}), append: vi.fn(async () => {}) };
  await executeQueuedRuns({ ...deps(runs.port, { complete: async input => { seen.push(input); return { text: "ordinary answer" }; } }), aidtContexts: contexts }, { orgId: org });
  expect(runs.failed()).toBeNull(); expect(seen).toHaveLength(1); expect(seen[0]?.user).toBe(run.inputText); expect(seen[0]).not.toHaveProperty("referenceDispatchObserver");
  expect(contexts.revalidate).not.toHaveBeenCalled(); expect(contexts.append).not.toHaveBeenCalled();
});
it("records a transport failure honestly without a fabricated native dispatch or another model attempt", async () => {
  const runs = store(), complete = vi.fn(async () => { throw new Error("offline transport rejected"); });
  const contexts = { resolve: vi.fn(async () => frozenStoredFixture()), revalidate: vi.fn(async () => {}), append: vi.fn(async () => {}) };
  await executeQueuedRuns({ ...deps(runs.port, { complete }), aidtContexts: contexts }, { orgId: org });
  expect(complete).toHaveBeenCalledOnce(); expect(runs.failed()).toBe("MODEL_CALL_FAILED");
  expect(contexts.append).toHaveBeenCalledTimes(2);
  expect(contexts.append).toHaveBeenLastCalledWith(org, "run", expect.objectContaining({ kind: "failed", errorCode: "AIDT_CONTEXT_UNAVAILABLE" }));
});
