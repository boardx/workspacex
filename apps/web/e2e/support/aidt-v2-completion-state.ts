import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type CompletionPhase = "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "sum";
type State = { schemaVersion: 1; projectId?: string; phases: Partial<Record<CompletionPhase, {
  status: "attempting" | "completed"; startedAt: string; completedAt?: string; evidence?: unknown;
  continuations?: { continuedAt: string; authorization: "approved-s2-upload-status-201"; proof: string; proofSha256?: string; oldBudgetSha256: string; priorFailure: string }[];
  originalFailedRun?: { runId: string; ledgerEntryId: string; ledgerStatus: "failed-or-interrupted"; actualTerminalStatus: "cancelled" };
  supplementalS2?: { status: "attempting" | "completed"; originalRunId: string; newThreadId: string; startedAt: string; evidence?: unknown };
  completionKind?: "supplemental-actual-success-original-failed-retained";
}>> };
const predecessor: Record<CompletionPhase, CompletionPhase | null> = { s1: null, s2: "s1", s3: "s2", s4: "s3", s5: "s4", s6: "s5", sum: "s6" };
function location() {
  const file = process.env.AIDT_V2_COMPLETION_STATE;
  if (!file || !isAbsolute(file) || extname(file) !== ".json") throw new Error("AIDT_COMPLETION_ABSOLUTE_STATE_REQUIRED");
  return file;
}
export function readCompletionState(): State {
  const file = location();
  const value = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as State : { schemaVersion: 1 as const, phases: {} };
  if (value.schemaVersion !== 1 || !value.phases) throw new Error("AIDT_COMPLETION_INVALID_STATE");
  return value;
}
function mutate(change: (state: State) => void): State {
  const file = location(); mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`; mkdirSync(lock, { mode: 0o700 });
  try {
    const value = readCompletionState(); change(value);
    const temp = `${file}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); renameSync(temp, file);
    return value;
  } finally { rmdirSync(lock); }
}
export function beginCompletionPhase(phase: CompletionPhase): State {
  if (process.env.AIDT_V2_AUTHORIZED_PHASE !== phase) throw new Error("AIDT_COMPLETION_EXACT_PHASE_AUTHORIZATION_REQUIRED");
  return mutate(state => {
    const existing = state.phases[phase];
    if (existing) {
      if (phase !== "s2" || existing.status !== "attempting"
        || process.env.AIDT_V2_RESUME_UNSENT_S2 !== "approved-s2-upload-status-201") throw new Error("AIDT_COMPLETION_ALREADY_ATTEMPTED_REVIEW_EXISTING_RUN");
      const proofPath = process.env.AIDT_V2_UNSENT_S2_PROOF, budgetPath = process.env.AIDT_V2_RUN_LEDGER;
      if (!proofPath || !isAbsolute(proofPath) || !budgetPath || !isAbsolute(budgetPath)) throw new Error("AIDT_COMPLETION_UNSENT_S2_PROOF_REQUIRED");
      const proof = JSON.parse(readFileSync(proofPath, "utf8")) as { projectId: string; s2RunCount: number; oldBudgetSha256: string;
        global: { physical_requests: number; active_runs: number; unsettled_requests: number } };
      const bytes = readFileSync(budgetPath), budget = JSON.parse(bytes.toString()) as { maximumNativeModelRuns: number; entries: { skill: string }[] };
      const hash = createHash("sha256").update(bytes).digest("hex");
      const proofSha256 = createHash("sha256").update(readFileSync(proofPath)).digest("hex");
      if (existing.continuations?.some(item => (item.proofSha256 ?? createHash("sha256").update(readFileSync(item.proof)).digest("hex")) === proofSha256)) throw new Error("AIDT_COMPLETION_ALREADY_ATTEMPTED_FRESH_UNSENT_PROOF_REQUIRED");
      if (proof.projectId !== state.projectId || proof.s2RunCount !== 0 || proof.global.physical_requests !== 1 || proof.global.active_runs !== 0 || proof.global.unsettled_requests !== 0
        || proof.oldBudgetSha256 !== hash || budget.maximumNativeModelRuns !== 7 || budget.entries.some(entry => entry.skill === "aidt-empathize")) throw new Error("AIDT_COMPLETION_UNSENT_S2_NOT_PROVEN");
      existing.continuations ??= [];
      existing.continuations.push({ continuedAt: new Date().toISOString(), authorization: "approved-s2-upload-status-201", proof: proofPath, proofSha256,
        oldBudgetSha256: hash, priorFailure: process.env.AIDT_V2_UNSENT_S2_PRIOR_FAILURE ?? "s2-attempt-01: upload returned canonical 201; QA expected 202; zero native reservation/send" });
      return;
    }
    const prior = predecessor[phase];
    if (prior && (!state.projectId || state.phases[prior]?.status !== "completed")) throw new Error("AIDT_COMPLETION_PREDECESSOR_REQUIRED");
    state.phases[phase] = { status: "attempting", startedAt: new Date().toISOString() };
  });
}
export function completeCompletionPhase(phase: CompletionPhase, projectId: string, evidence: unknown): void {
  mutate(state => {
    if (state.projectId && state.projectId !== projectId) throw new Error("AIDT_COMPLETION_PROJECT_MISMATCH");
    const entry = state.phases[phase];
    if (entry?.status !== "attempting") throw new Error("AIDT_COMPLETION_ATTEMPT_REQUIRED");
    state.projectId = projectId; state.phases[phase] = { ...entry, status: "completed", completedAt: new Date().toISOString(), evidence };
  });
}

export function beginSupplementalS2Attempt(projectId: string, originalRunId: string, newThreadId: string): void {
  if (process.env.AIDT_V2_S2_SUPPLEMENT_AUTHORIZED !== "approved-additional-s2-once") throw new Error("AIDT_COMPLETION_S2_SUPPLEMENT_AUTHORIZATION_REQUIRED");
  const file = process.env.AIDT_V2_RUN_LEDGER;
  if (!file || !isAbsolute(file)) throw new Error("AIDT_COMPLETION_ORIGINAL_LEDGER_REQUIRED");
  const ledger = JSON.parse(readFileSync(file, "utf8")) as { maximumNativeModelRuns: number; entries: { id: string; runId: string; projectId: string; threadId: string; skill: string; status: string }[] };
  const failed = ledger.entries.find(item => item.runId === originalRunId && item.projectId === projectId && item.skill === "aidt-empathize" && item.status === "failed-or-interrupted");
  if (ledger.maximumNativeModelRuns !== 7 || !failed || failed.threadId === newThreadId) throw new Error("AIDT_COMPLETION_ORIGINAL_FAILED_S2_AND_FRESH_THREAD_REQUIRED");
  mutate(state => {
    const current = state.phases.s2;
    if (state.projectId !== projectId || state.phases.s1?.status !== "completed" || current?.status !== "attempting" || current.supplementalS2) throw new Error("AIDT_COMPLETION_S2_SUPPLEMENT_PREDECESSOR_OR_ALREADY_ATTEMPTED");
    current.originalFailedRun = { runId: originalRunId, ledgerEntryId: failed.id, ledgerStatus: "failed-or-interrupted", actualTerminalStatus: "cancelled" };
    current.supplementalS2 = { status: "attempting", originalRunId, newThreadId, startedAt: new Date().toISOString() };
  });
}
export function completeSupplementalS2Attempt(projectId: string, runId: string, evidence: { actualRunSucceeded: true; sourceReceiptVerified: true; studentSaved: true; freshLoginExactReadback: true; [key: string]: unknown }): void {
  if (process.env.AIDT_V2_S2_SUPPLEMENT_AUTHORIZED !== "approved-additional-s2-once") throw new Error("AIDT_COMPLETION_S2_SUPPLEMENT_AUTHORIZATION_REQUIRED");
  if (evidence.actualRunSucceeded !== true || evidence.sourceReceiptVerified !== true || evidence.studentSaved !== true || evidence.freshLoginExactReadback !== true) throw new Error("AIDT_COMPLETION_S2_ACTUAL_SUCCESS_REQUIRED");
  mutate(state => {
    const phase = state.phases.s2, attempt = phase?.supplementalS2;
    if (state.projectId !== projectId || phase?.status !== "attempting" || attempt?.status !== "attempting" || runId === attempt.originalRunId) throw new Error("AIDT_COMPLETION_S2_SUPPLEMENT_SCOPE_OR_ATTEMPT_MISMATCH");
    phase.supplementalS2 = { ...attempt, status: "completed", evidence: { ...evidence, runId } };
    phase.status = "completed"; phase.completedAt = new Date().toISOString(); phase.completionKind = "supplemental-actual-success-original-failed-retained";
  });
}
