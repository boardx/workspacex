/** Frozen run assembly over in-memory ports; no database, HTTP or model request. */
import { expect, it, vi } from "vitest";
import { AidtStoredContextSnapshot, aidtContextSnapshotJson } from "@repo/contracts/aidt-run-context";
import { computeContentHash } from "../../src/domain/artifact/content-hash";
import { assembleAidtRunReference, frozenAidtRunContext } from "../../src/application/agent-run/aidt-context-reference";
import type { ThreadHistoryMessage } from "../../src/application/agent-run/ports";
import { frozenFixture, frozenStoredFixture, AIDT_REFERENCE_ORG as org } from "../support/aidt-context-fixture";
import { prepareAidtContext } from '../../src/application/aidt-run-context/prepare';
import { guard } from '../../src/application/security/permission-filter';
const hash = (value: string) => computeContentHash(Buffer.from(value));

function ports() { return { resolve: vi.fn(async () => frozenStoredFixture()), revalidate: vi.fn(async () => {}), append: vi.fn(async () => {}) }; }
it("inserts only the exact immutable block as untrusted user history while preserving human text and existing source coordinates", async () => {
  const run = frozenFixture(), contexts = ports(), history: readonly ThreadHistoryMessage[] = [{ id: "old-message", role: "assistant", content: "old history" }], before = JSON.stringify(run);
  const result = await assembleAidtRunReference({ orgId: org, run, history, attemptId: "run:1", contexts });
  expect(result.history[0]).toBe(history[0]); expect(result.history[1]).toEqual({ role: "user", content: frozenStoredFixture().snapshot.modelReferenceBlock });
  expect(result.history[1]).not.toHaveProperty("id"); expect(result.observer?.historyIndex).toBe(1); expect(JSON.stringify(run)).toBe(before);
  expect(contexts.append).toHaveBeenCalledWith(org, "run", expect.objectContaining({ kind: "assembled", assembledContextHash: frozenStoredFixture().snapshot.modelReferenceBlockHash }));
});
it("keeps ordinary Chat as the exact original history and performs no context I/O", async () => {
  const { aidtContext: _context, aidtSelectorHash: _marker, ...run } = frozenFixture(), contexts = ports(), history: readonly ThreadHistoryMessage[] = [];
  const result = await assembleAidtRunReference({ orgId: org, run, history, attemptId: "run:1", contexts });
  expect(result.history).toBe(history); expect(result.observer).toBeUndefined(); expect(contexts.revalidate).not.toHaveBeenCalled(); expect(contexts.append).not.toHaveBeenCalled();
});
it("fails closed on a required snapshot or execution port missing", async () => {
  const run = frozenFixture(); const { aidtContext: _context, ...missing } = run;
  expect(() => frozenAidtRunContext(org, missing)).toThrow("MODEL_CALL_FAILED");
  await expect(assembleAidtRunReference({ orgId: org, run, history: [], attemptId: "run:1" })).rejects.toThrow("MODEL_CALL_FAILED");
});
it.each(["orgId", "runId", "projectId", "threadId", "inputMessageId", "requestedBy"] as const)("rejects foreign %s binding", key => {
  const run = frozenFixture(), stored = { ...frozenStoredFixture(), [key]: "foreign" };
  expect(() => frozenAidtRunContext(org, run, stored)).toThrow("MODEL_CALL_FAILED");
});
it("rejects altered snapshot/body/selector hashes and an unpinned focus", () => {
  const run = frozenFixture();
  expect(() => frozenAidtRunContext(org, { ...run, aidtSelectorHash: "f".repeat(64) }, frozenStoredFixture())).toThrow();
  expect(() => frozenAidtRunContext(org, run, { ...frozenStoredFixture(), snapshotHash: "f".repeat(64) })).toThrow();
  const snapshot = { ...frozenStoredFixture().snapshot, modelReferenceBlock: "tampered" };
  expect(() => frozenAidtRunContext(org, run, { ...frozenStoredFixture(), snapshot, snapshotHash: hash(aidtContextSnapshotJson(snapshot)) })).toThrow();
  expect(() => frozenAidtRunContext(org, { ...run, skillVersionIds: ["other-version"] }, frozenStoredFixture())).toThrow();
  expect(() => frozenAidtRunContext(org, { ...run, skillVersionIds: ["skill-v1", "unrelated-catalog-version"] }, frozenStoredFixture())).toThrow();
});
it("uses the same snapshot through resume and records no new assembled/message-dispatch event", async () => {
  const run = { ...frozenFixture(), pendingDecision: { kind: "approve" as const } }, contexts = ports();
  const result = await assembleAidtRunReference({ orgId: org, run, history: [], attemptId: "run:8", contexts });
  expect(contexts.append).not.toHaveBeenCalled();
  await result.observer!.onDispatched({ kind: "checkpoint-resume-observed", contentSha256: frozenStoredFixture().snapshot.modelReferenceBlockHash, remoteRunId: "remote-resume", remoteThreadId: "remote-thread" });
  expect(contexts.append).toHaveBeenCalledOnce(); expect(contexts.append).toHaveBeenCalledWith(org, "run", expect.objectContaining({ kind: "checkpoint-resume-observed", inheritedMessageDispatchAttemptId: null, assembledContextHash: null }));
});
it("revalidates adjacent to dispatch and blocks a revoked source without replacing its stored content", async () => {
  const run = frozenFixture(), contexts = ports(), before = JSON.stringify(run.aidtContext);
  const result = await assembleAidtRunReference({ orgId: org, run, history: [], attemptId: "run:1", contexts });
  contexts.revalidate.mockRejectedValueOnce(new Error("revoked"));
  await expect(result.observer!.beforeDispatch()).rejects.toThrow("MODEL_CALL_FAILED");
  expect(JSON.stringify(run.aidtContext)).toBe(before); expect(contexts.append).toHaveBeenLastCalledWith(org, "run", expect.objectContaining({ kind: "failed" }));
});
it("keeps journal outages observational and never retries model work", async () => {
  const contexts = ports(); contexts.append.mockRejectedValue(new Error("journal down")); const run = frozenFixture();
  const result = await assembleAidtRunReference({ orgId: org, run, history: [], attemptId: "run:1", contexts });
  await expect(result.observer!.onDispatched({ kind: "message-dispatch-observed", contentSha256: frozenStoredFixture().snapshot.modelReferenceBlockHash, remoteRunId: "remote", remoteThreadId: "thread" })).resolves.toBeUndefined();
  expect(contexts.append).toHaveBeenCalledTimes(2);
});
it("handles JSONB-style object key reorder without hash drift but rejects an oversized final reference", () => {
  const run = frozenFixture(), stored = frozenStoredFixture();
  const reordered = Object.fromEntries(Object.entries(stored).reverse());
  expect(frozenAidtRunContext(org, run, AidtStoredContextSnapshot.parse(reordered))?.snapshotHash).toBe(stored.snapshotHash);
  const block = "汉".repeat(128 * 1024), snapshot = { ...stored.snapshot, modelReferenceBlock: block, modelReferenceBlockHash: hash(block) };
  expect(() => frozenAidtRunContext(org, run, { ...stored, snapshot })).toThrow("MODEL_CALL_FAILED");
});
it("records one bounded failure after transport uncertainty without losing actual prior dispatch evidence", async () => {
  const run = frozenFixture(), contexts = ports();
  const result = await assembleAidtRunReference({ orgId: org, run, history: [], attemptId: "run:1", contexts });
  await result.observer!.onDispatched({ kind: "message-dispatch-observed", contentSha256: frozenStoredFixture().snapshot.modelReferenceBlockHash, remoteRunId: "actual-remote", remoteThreadId: "actual-thread" });
  await result.failed!(); await result.failed!();
  expect(contexts.append).toHaveBeenCalledTimes(3);
  expect(contexts.append).toHaveBeenNthCalledWith(2, org, "run", expect.objectContaining({ kind: "message-dispatch-observed" }));
  expect(contexts.append).toHaveBeenLastCalledWith(org, "run", expect.objectContaining({ kind: "failed", errorCode: "AIDT_CONTEXT_UNAVAILABLE" }));
});

it.each(['legacy-prefix','field-projection'])('resumes an already frozen SUM %s block byte for byte after the excerpt repair',async format=>{
 const prepared=prepareAidtContext({schemaVersion:1,projectId:'project',purpose:'summary',stageRevisions:[{stageId:6,revision:1}],historyRevisions:[]},{skillId:'skill',skillVersionId:'skill-v1',skillStableName:'dt-summarize-project',title:'总结'},[{kind:'stage',stage:{projectId:'project',stageId:6,revision:1,updatedBy:'student',updatedAt:'2026-11-16T00:00:00.000Z',sourceStageRevisions:[],content:{schemaVersion:1,draft:{fields:{returnStep:'2',returnReason:'保留旧选择'},ideas:[],selectedIdeaId:''}}}}],new Map());
 const legacyBlock='AIDT SAVED STUDENT REFERENCE / formatter v1\nLegacy frozen prefix; never regenerate this stored block.\n{"materials":[{"excerpt":"old immutable saved student bytes"}]}';
 const snapshot=format==='legacy-prefix'?{...prepared.snapshot,modelReferenceBlock:legacyBlock,modelReferenceBlockHash:hash(legacyBlock)}:prepared.snapshot;
 const stored=AidtStoredContextSnapshot.parse({...frozenStoredFixture(),...prepared,snapshot,snapshotHash:hash(aidtContextSnapshotJson(snapshot))});
 const run={...frozenFixture(),aidtSelectorHash:stored.selectorHash,aidtContext:guard({kind:'project',id:'project'},stored),checkpointResume:true};
 const contexts={resolve:vi.fn(async()=>stored),revalidate:vi.fn(async()=>{}),append:vi.fn(async()=>{})};
 const result=await assembleAidtRunReference({orgId:org,run,history:[],attemptId:'run:resume',contexts});
 expect(result.history).toEqual([{role:'user',content:snapshot.modelReferenceBlock}]);
 expect(contexts.append).not.toHaveBeenCalled();
 await result.observer!.onDispatched({kind:'checkpoint-resume-observed',contentSha256:snapshot.modelReferenceBlockHash,remoteRunId:'remote-resumed-run',remoteThreadId:'remote-resumed-thread'});
 expect(contexts.append).toHaveBeenCalledWith(org,'run',expect.objectContaining({kind:'checkpoint-resume-observed',snapshotHash:stored.snapshotHash}));
 expect(result.history[0]!.content).toBe(snapshot.modelReferenceBlock);
});
