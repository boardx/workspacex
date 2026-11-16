import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginCompletionPhase, completeCompletionPhase, readCompletionState, recordS5ManualContinuation } from "../e2e/support/aidt-v2-completion-state";
const original = { ...process.env }; const dirs: string[] = [];
afterEach(() => { process.env = { ...original }; dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
it("refuses a later phase without the same group's completed predecessor and never retries an uncertain phase", () => {
  const dir = mkdtempSync(join(tmpdir(), "aidt-journey-test-")); dirs.push(dir);
  process.env.AIDT_V2_COMPLETION_STATE = join(dir, "journey.json");
  process.env.AIDT_V2_AUTHORIZED_PHASE = "s2";
  expect(() => beginCompletionPhase("s2")).toThrow("PREDECESSOR_REQUIRED");
  process.env.AIDT_V2_AUTHORIZED_PHASE = "s1";
  beginCompletionPhase("s1");
  expect(() => beginCompletionPhase("s1")).toThrow("ALREADY_ATTEMPTED");
  completeCompletionPhase("s1", "group-one", { revision: 2 });
  process.env.AIDT_V2_AUTHORIZED_PHASE = "s2";
  expect(beginCompletionPhase("s2").projectId).toBe("group-one");
  expect(() => completeCompletionPhase("s2", "other-group", {})).toThrow("PROJECT_MISMATCH");
  completeCompletionPhase("s2", "group-one", { revision: 2 });
  expect(readCompletionState().phases.s1?.status).toBe("completed");
  expect(readCompletionState().phases.s2?.status).toBe("completed");
});
it("requires exact per-task authorization, never a broad truthy model flag", () => {
  process.env.AIDT_V2_AUTHORIZED_PHASE = "s2";
  expect(() => beginCompletionPhase("s1")).toThrow("EXACT_PHASE_AUTHORIZATION_REQUIRED");
});
it("continues only explicitly reviewed zero-send S2 with a fresh unique proof, preserving phase and original seven ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "aidt-unsent-s2-test-")); dirs.push(dir);
  process.env.AIDT_V2_COMPLETION_STATE = join(dir, "journey.json");
  process.env.AIDT_V2_AUTHORIZED_PHASE = "s1"; beginCompletionPhase("s1"); completeCompletionPhase("s1", "group", {});
  process.env.AIDT_V2_AUTHORIZED_PHASE = "s2"; beginCompletionPhase("s2");
  const old = join(dir, "seven.json"), proof = join(dir, "proof.json"), bytes = JSON.stringify({ schemaVersion: 1, maximumNativeModelRuns: 7, entries: [] });
  writeFileSync(old, bytes); process.env.AIDT_V2_RUN_LEDGER = old;
  writeFileSync(proof, JSON.stringify({ projectId: "group", s2RunCount: 0, global: { physical_requests: 1, active_runs: 0, unsettled_requests: 0 }, oldBudgetSha256: createHash("sha256").update(bytes).digest("hex") }));
  Object.assign(process.env, { AIDT_V2_RESUME_UNSENT_S2: "approved-s2-upload-status-201", AIDT_V2_UNSENT_S2_PROOF: proof });
  const proofBody = JSON.parse(readFileSync(proof, "utf8"));
  writeFileSync(proof, JSON.stringify({ ...proofBody, s2RunCount: 1 }));
  expect(() => beginCompletionPhase("s2")).toThrow("UNSENT_S2_NOT_PROVEN");
  writeFileSync(proof, JSON.stringify({ ...proofBody, projectId: "other-group" }));
  expect(() => beginCompletionPhase("s2")).toThrow("UNSENT_S2_NOT_PROVEN");
  writeFileSync(proof, JSON.stringify(proofBody));
  const changed = JSON.stringify({ schemaVersion: 1, maximumNativeModelRuns: 7, entries: [{ skill: "aidt-empathize" }] });
  writeFileSync(old, changed);
  expect(() => beginCompletionPhase("s2")).toThrow("UNSENT_S2_NOT_PROVEN");
  writeFileSync(old, bytes);
  expect(beginCompletionPhase("s2").phases.s2?.status).toBe("attempting");
  expect(readCompletionState().phases.s1?.status).toBe("completed");
  expect(() => beginCompletionPhase("s2")).toThrow("ALREADY_ATTEMPTED");
  const nextProof = join(dir, "next-proof.json");
  writeFileSync(nextProof, JSON.stringify({ ...proofBody, at: new Date().toISOString() })); process.env.AIDT_V2_UNSENT_S2_PROOF = nextProof;
  expect(beginCompletionPhase("s2").phases.s2?.continuations).toHaveLength(2);
  const copiedProof = join(dir, "copied-proof.json"); writeFileSync(copiedProof, readFileSync(nextProof)); process.env.AIDT_V2_UNSENT_S2_PROOF = copiedProof;
  expect(() => beginCompletionPhase("s2")).toThrow("FRESH_UNSENT_PROOF_REQUIRED");
});

it("permits only fresh independent S6 from actual cancelled S5 manual save; never marks the native S5 completed", () => {
  const dir = mkdtempSync(join(tmpdir(), "aidt-manual-s5-test-")); dirs.push(dir);
  Object.assign(process.env, { AIDT_V2_COMPLETION_STATE: join(dir, "state.json"), AIDT_V2_RUN_LEDGER: join(dir, "seven.json"), AIDT_V2_FRESH_JOURNEY: "fresh-native-seven-20261117", AIDT_V2_MANUAL_CONTINUATION_PHASE: "s5", AIDT_V2_AUTHORIZED_PHASE: "s6" });
  const failedPhase = { status: "attempting", startedAt: "kept", evidence: { originalFailure: "kept" } };
  writeFileSync(process.env.AIDT_V2_COMPLETION_STATE!, JSON.stringify({ schemaVersion: 1, projectId: "group", phases: { s5: failedPhase } }));
  const ledger = JSON.stringify({ maximumNativeModelRuns: 7, entries: [{ runId: "cancelled-S5", projectId: "group", skill: "aidt-prototype", status: "failed-or-interrupted" }] });
  writeFileSync(process.env.AIDT_V2_RUN_LEDGER!, ledger);
  expect(() => beginCompletionPhase("s6")).toThrow("PREDECESSOR_REQUIRED");
  const file = join(dir, "actual-ui-evidence.json"), evidence = { projectId: "group", failedRunId: "cancelled-S5", actualRunStatus: "cancelled", manualStudentFallback: true, modelTaskPassed: false, studentSaved: true, freshLoginExactReadback: true,
    after: { projectId: "group", stageId: 5, revision: 2, content: { draft: { fields: { verificationQuestionConfirmed: "true" } } } } };
  for (const patch of [{ modelTaskPassed: true }, { actualRunStatus: "running" }, { freshLoginExactReadback: false }, { failedRunId: "other-run" }]) {
    writeFileSync(file, JSON.stringify({ ...evidence, ...patch })); expect(() => recordS5ManualContinuation(file)).toThrow();
  }
  writeFileSync(file, JSON.stringify(evidence)); recordS5ManualContinuation(file);
  expect(readCompletionState().phases.s5).toEqual(failedPhase);
  expect(beginCompletionPhase("s6").phases.s6?.status).toBe("attempting");
  expect(readFileSync(process.env.AIDT_V2_RUN_LEDGER!, "utf8")).toBe(ledger);
  expect(() => recordS5ManualContinuation(file)).toThrow("ALREADY_RECORDED");
});

it("strict remediation rejects an old manual S5 bridge without rewriting its state bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "aidt-strict-no-bridge-")); dirs.push(dir);
  process.env.AIDT_V2_COMPLETION_STATE = join(dir, "state.json");
  process.env.AIDT_V2_AUTHORIZED_PHASE = "s6";
  process.env.AIDT_V2_REMEDIATION = "native-seven-no-bridge-20261117";
  const originalBytes = JSON.stringify({ schemaVersion: 1, projectId: "g", manualContinuation: { phase: "s5" }, phases: { s5: { status: "attempting" } } });
  writeFileSync(process.env.AIDT_V2_COMPLETION_STATE, originalBytes);
  expect(() => beginCompletionPhase("s6")).toThrow("MANUAL_BRIDGE_FORBIDDEN");
  expect(readFileSync(process.env.AIDT_V2_COMPLETION_STATE, "utf8")).toBe(originalBytes);
  expect(() => recordS5ManualContinuation("/tmp/never-read.json")).toThrow("MANUAL_BRIDGE_FORBIDDEN");
});
