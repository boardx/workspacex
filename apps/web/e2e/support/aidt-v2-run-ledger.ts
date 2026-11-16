import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, normalize } from "node:path";

type Entry = {
  id: string; projectId: string; threadId: string; skill: string; promptSha256: string; reservedAt: string;
  status: "reserved" | "request-observed" | "succeeded" | "failed-or-interrupted";
  provider: "unknown" | "not-invoked-verified" | "invoked-verified";
  requestPath?: string; sentAt?: string; runId?: string; finishedAt?: string; failureCode?: string;
  reconciliationEvidence?: string;
  outcomes?: { recordedAt: string; succeeded: boolean; failureCode?: string; note?: string }[];
};
type Resolution = { entryId: string; provider: "not-invoked-verified" | "invoked-verified"; evidence: string; recordedAt: string };
type Ledger = { schemaVersion: 1; maximumNativeModelRuns: 7; entries: Entry[]; resolutions?: Resolution[] };
function effectiveProvider(ledger: Ledger, entry: Entry): Entry["provider"] {
  return ledger.resolutions?.filter(resolution => resolution.entryId === entry.id).at(-1)?.provider ?? entry.provider;
}

function location(): string {
  const file = process.env.AIDT_V2_RUN_LEDGER;
  if (!file || !isAbsolute(file) || extname(file) !== ".json") throw new Error("AIDT_V2_SHARED_RUN_LEDGER_REQUIRED");
  const normalized = normalize(file);
  if (existsSync(normalized) && statSync(normalized).isDirectory()) throw new Error("AIDT_V2_SHARED_RUN_LEDGER_REQUIRED");
  return normalized;
}
function mutate<T>(change: (ledger: Ledger) => T): T {
  const file = location(), lock = `${file}.lock`;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // No retry loop: a second owner must not consume a parallel model budget slot.
  mkdirSync(lock, { mode: 0o700 });
  try {
    const ledger: Ledger = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Ledger
      : { schemaVersion: 1, maximumNativeModelRuns: 7, entries: [] };
    if (ledger.schemaVersion !== 1 || ledger.maximumNativeModelRuns !== 7 || !Array.isArray(ledger.entries)) throw new Error("AIDT_V2_RUN_LEDGER_INVALID");
    const result = change(ledger);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(ledger, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
    return result;
  } finally { rmdirSync(lock); }
}

export function reserveAidtNativeRun(projectId: string, threadId: string, skill: string, prompt: string): string {
  return mutate(ledger => {
    // Every uncertain attempt counts. A failed request never silently restores a slot.
    const counted = ledger.entries.filter(entry => effectiveProvider(ledger, entry) !== "not-invoked-verified").length;
    if (counted >= ledger.maximumNativeModelRuns) throw new Error("AIDT_V2_REAL_RUN_BUDGET_EXHAUSTED");
    if (ledger.entries.some(entry => entry.skill === skill && effectiveProvider(ledger, entry) !== "not-invoked-verified")) throw new Error("AIDT_V2_SKILL_ALREADY_ATTEMPTED_REVIEW_EXISTING_RUN_BEFORE_RETRY");
    const entry: Entry = { id: randomUUID(), projectId, threadId, skill, promptSha256: createHash("sha256").update(prompt).digest("hex"),
      reservedAt: new Date().toISOString(), status: "reserved", provider: "unknown" };
    ledger.entries.push(entry);
    return entry.id;
  });
}

export function recordAidtNativeRequest(id: string, requestPath: string): void {
  mutate(ledger => {
    const entry = ledger.entries.find(item => item.id === id);
    if (!entry || entry.status !== "reserved") throw new Error("AIDT_V2_RUN_LEDGER_RESERVATION_MISMATCH");
    Object.assign(entry, { status: "request-observed", requestPath, sentAt: new Date().toISOString() });
  });
}

export function finishAidtNativeRun(id: string, outcome: { runId?: string; succeeded: boolean; failureCode?: string }): void {
  mutate(ledger => {
    const entry = ledger.entries.find(item => item.id === id);
    if (!entry) throw new Error("AIDT_V2_RUN_LEDGER_ENTRY_MISSING");
    if (!entry.outcomes && entry.status === "failed-or-interrupted") entry.outcomes = [{ recordedAt: entry.finishedAt ?? entry.reservedAt, succeeded: false,
      failureCode: entry.failureCode, note: "Original test failure retained before same-run UI continuation" }];
    entry.outcomes ??= [];
    entry.outcomes.push({ recordedAt: new Date().toISOString(), succeeded: outcome.succeeded, ...(outcome.failureCode ? { failureCode: outcome.failureCode } : {}) });
    Object.assign(entry, { status: outcome.succeeded ? "succeeded" : "failed-or-interrupted", finishedAt: new Date().toISOString(),
      ...(outcome.runId ? { runId: outcome.runId } : {}), ...(outcome.failureCode ? { failureCode: outcome.failureCode } : {}) });
  });
}

export function existingAidtNativeRun(runId: string): Readonly<Entry> {
  const ledger = JSON.parse(readFileSync(location(), "utf8")) as Ledger;
  const entry = ledger.entries.find(item => item.runId === runId);
  if (!entry || entry.status === "reserved" || !entry.sentAt) throw new Error("AIDT_V2_EXISTING_OBSERVED_RUN_REQUIRED");
  return entry;
}

// Provider reconciliation is deliberately not exported to the test: only the stack owner/root
// may mark a failed attempt not-invoked with actual provider/dispatch evidence. Design's two
// separately authorized calls are recorded separately, never hidden in this native run budget.
