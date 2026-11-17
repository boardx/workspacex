import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateS2EmptyThreadReuse, validateS2SupplementPreflight } from "../e2e/support/aidt-v2-s2-supplement-preflight";
import { beginSupplementalS2Attempt, completeSupplementalS2Attempt, readCompletionState } from "../e2e/support/aidt-v2-completion-state";

const scope = { orgId: "org", userId: "actor", projectId: "project", oldRunId: "old-cancelled", agentId: "default", oldAgentVersionId: "echo-v1" };
const now = Date.now(), fixture = { schemaVersion: 1, kind: "private-isolated-QA-fixture-append-only", applied: true,
  orgId: "org", agentId: "default", oldVersionId: "echo-v1", newVersionId: "canonical-v2", newInstructionDigest: "a".repeat(64) };
const proof = { schemaVersion: 1, kind: "aidt-s2-supplement-readonly-preflight", observedAt: new Date(now).toISOString(), ...scope,
  oldRunStatus: "cancelled", publishedAgentVersionId: "canonical-v2", instructionsSha256: "a".repeat(64), apiOwner: { pid: 123, startTicks: "456" },
  nativeExecutorEnabled: true, allowedTask: "additional-s2-once", activeRuns: 0, holdsHundredths: 0, unsettledRequests: 0 };
const original = { ...process.env }, dirs: string[] = [];
afterEach(() => { process.env = { ...original }; dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });

it("accepts the exact separately reviewed new version only with fresh authorized execution-owner facts", () => {
  expect(validateS2SupplementPreflight(proof, fixture, scope, now).publishedAgentVersionId).toBe("canonical-v2");
  for (const patch of [{ oldRunStatus: "awaiting_tool_permission" }, { nativeExecutorEnabled: false }, { activeRuns: 1 }, { holdsHundredths: 1 }, { unsettledRequests: 1 }, { allowedTask: "s3" }]) {
    expect(() => validateS2SupplementPreflight({ ...proof, ...patch }, fixture, scope, now)).toThrow();
  }
});
it("rejects wrong actor/project, stale receipt, old echo version, and unexpected instructions digest", () => {
  for (const patch of [{ userId: "other" }, { projectId: "other" }, { publishedAgentVersionId: "echo-v1" }, { instructionsSha256: "b".repeat(64) }]) {
    expect(() => validateS2SupplementPreflight({ ...proof, ...patch }, fixture, scope, now)).toThrow();
  }
  expect(() => validateS2SupplementPreflight(proof, fixture, scope, now + 300_001)).toThrow("STALE");
});
it("preserves the original failed phase and journal; only actual supplemental success unlocks S3", () => {
  const dir = mkdtempSync(join(tmpdir(), "aidt-s2-phase-test-")); dirs.push(dir);
  const stateFile = join(dir, "state.json"), ledgerFile = join(dir, "seven.json");
  const failure = { status: "attempting", startedAt: "2026-11-16T12:00:00Z", evidence: { originalExitCode: 1 }, continuations: [{ priorFailure: "kept" }] };
  writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, projectId: "project", phases: { s1: { status: "completed" }, s2: failure } }));
  const ledgerBytes = JSON.stringify({ maximumNativeModelRuns: 7, entries: [{ id: "failed-entry", runId: "old-cancelled", projectId: "project", threadId: "old-thread", skill: "aidt-empathize", status: "failed-or-interrupted" }] });
  writeFileSync(ledgerFile, ledgerBytes);
  Object.assign(process.env, { AIDT_V2_COMPLETION_STATE: stateFile, AIDT_V2_RUN_LEDGER: ledgerFile, AIDT_V2_S2_SUPPLEMENT_AUTHORIZED: "approved-additional-s2-once" });
  expect(() => beginSupplementalS2Attempt("project", "old-cancelled", "old-thread")).toThrow("FRESH_THREAD_REQUIRED");
  beginSupplementalS2Attempt("project", "old-cancelled", "new-thread");
  expect(readCompletionState().phases.s2?.status).toBe("attempting");
  expect(() => beginSupplementalS2Attempt("project", "old-cancelled", "another-thread")).toThrow("ALREADY_ATTEMPTED");
  expect(() => completeSupplementalS2Attempt("project", "new-run", { actualRunSucceeded: false } as never)).toThrow("ACTUAL_SUCCESS_REQUIRED");
  completeSupplementalS2Attempt("project", "new-run", { actualRunSucceeded: true, sourceReceiptVerified: true, studentSaved: true, freshLoginExactReadback: true });
  const phase = readCompletionState().phases.s2!;
  expect(phase.status).toBe("completed"); expect(phase.completionKind).toBe("supplemental-actual-success-original-failed-retained");
  expect(phase.evidence).toEqual(failure.evidence); expect(phase.continuations).toEqual(failure.continuations); expect(phase.startedAt).toBe(failure.startedAt);
  expect(phase.originalFailedRun?.runId).toBe("old-cancelled"); expect(readFileSync(ledgerFile, "utf8")).toBe(ledgerBytes);
});

it("reuses only the independently audited empty same-project thread with unchanged budgets and the approved pin", () => {
  const expected = { orgId: "org", projectId: "project", oldThreadId: "old", skillId: "skill", skillVersionId: "pin", legacyHash: "a".repeat(64), s1Hash: "b".repeat(64) };
  const raw = { at: new Date(now).toISOString(), readOnly: true, originalThreadsRetained: true,
    newThread: { id: "empty", org_id: "org", project_id: "project" }, messages: 0, runs: 0,
    mounts: [{ skill_id: "skill", version_id: "pin", stable_name: "aidt-empathize" }],
    finance: { total_runs: 2, active: 0, physical: 2, usage: 2, credit: 2, unsettled: 0, holds: "0", unbounded: "0" },
    oldBudgetHashes: { legacy: expected.legacyHash, supplementS1: expected.s1Hash }, oldBudgetsUnchanged: true,
    supplementalS2LedgerAbsent: true, modelRequestsSentByAudit: 0 };
  expect(validateS2EmptyThreadReuse(raw, expected).newThread.id).toBe("empty");
  for (const patch of [{ messages: 1 }, { runs: 1 }, { supplementalS2LedgerAbsent: false }, { readOnly: false },
    { newThread: { ...raw.newThread, project_id: "other" } }, { newThread: { ...raw.newThread, id: "old" } },
    { mounts: [{ ...raw.mounts[0], version_id: "new-unapproved" }] },
    { oldBudgetHashes: { ...raw.oldBudgetHashes, legacy: "c".repeat(64) } }, { finance: { ...raw.finance, holds: "1" } }]) {
    expect(() => validateS2EmptyThreadReuse({ ...raw, ...patch }, expected)).toThrow();
  }
});
