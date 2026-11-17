import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, normalize } from "node:path";

type Outcome = { succeeded: boolean; runId?: string; failureCode?: string };
type Entry = { id: string; projectId: string; threadId: string; skill: "aidt-empathize"; promptSha256: string; reservedAt: string;
  status: "reserved" | "request-observed" | "succeeded" | "failed-or-interrupted"; provider: "unknown";
  requestPath?: string; sentAt?: string; runId?: string; outcomes: (Outcome & { recordedAt: string })[] };
type Ledger = { schemaVersion: 1; maximumNativeModelRuns: 1; authorization: "additional-s2-after-fixture-repair-20261116";
  originalCancelledRunId: string; projectId: string; entries: Entry[] };

/** Prepared for approval, default closed. No ordinary or S1 journal is mutated here. */
export function additionalS2RunLedger() {
  if (process.env.AIDT_V2_S2_SUPPLEMENT_AUTHORIZED !== "approved-additional-s2-once") throw new Error("AIDT_V2_S2_SUPPLEMENT_AUTHORIZATION_REQUIRED");
  const projectId = process.env.AIDT_V2_S2_SUPPLEMENT_PROJECT_ID, originalCancelledRunId = process.env.AIDT_V2_CANCELLED_S2_RUN_ID;
  if (!projectId || !originalCancelledRunId) throw new Error("AIDT_V2_S2_SUPPLEMENT_ORIGINAL_SCOPE_REQUIRED");
  const input = process.env.AIDT_V2_SUPPLEMENTAL_S2_LEDGER;
  if (!input || !isAbsolute(input) || extname(input) !== ".json") throw new Error("AIDT_V2_S2_SUPPLEMENT_ABSOLUTE_JOURNAL_REQUIRED");
  const file = normalize(input);
  if (existsSync(file) && statSync(file).isDirectory()) throw new Error("AIDT_V2_S2_SUPPLEMENT_ABSOLUTE_JOURNAL_REQUIRED");
  for (const old of [process.env.AIDT_V2_RUN_LEDGER, process.env.AIDT_V2_SUPPLEMENTAL_S1_LEDGER]) {
    if (!old || !isAbsolute(old)) throw new Error("AIDT_V2_S2_SUPPLEMENT_OLD_JOURNALS_REQUIRED");
    const sameExistingFile = existsSync(file) && existsSync(old) && (realpathSync(file) === realpathSync(old)
      || (statSync(file).dev === statSync(old).dev && statSync(file).ino === statSync(old).ino));
    if (file === normalize(old) || sameExistingFile) throw new Error("AIDT_V2_S2_SUPPLEMENT_SEPARATE_JOURNAL_REQUIRED");
  }
  const mutate = <T>(change: (value: Ledger) => T): T => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const lock = `${file}.lock`; mkdirSync(lock, { mode: 0o700 });
    try {
      const value: Ledger = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Ledger
        : { schemaVersion: 1, maximumNativeModelRuns: 1, authorization: "additional-s2-after-fixture-repair-20261116", originalCancelledRunId, projectId, entries: [] };
      if (value.schemaVersion !== 1 || value.maximumNativeModelRuns !== 1 || value.authorization !== "additional-s2-after-fixture-repair-20261116"
        || value.projectId !== projectId || value.originalCancelledRunId !== originalCancelledRunId || !Array.isArray(value.entries)
        || value.entries.length > 1 || value.entries.some(entry => entry.skill !== "aidt-empathize" || entry.projectId !== projectId)) throw new Error("AIDT_V2_S2_SUPPLEMENT_INVALID_JOURNAL");
      const result = change(value), temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); renameSync(temporary, file);
      return result;
    } finally { rmdirSync(lock); }
  };
  return {
    reserve(requestedProject: string, threadId: string, skill: string, prompt: string): string {
      if (skill !== "aidt-empathize") throw new Error("AIDT_V2_S2_SUPPLEMENT_ONLY_AIDT_EMPATHIZE");
      if (requestedProject !== projectId) throw new Error("AIDT_V2_S2_SUPPLEMENT_PROJECT_MISMATCH");
      return mutate(value => {
        // Every reserved/unknown/failed attempt consumes the one task. No implicit refund or retry.
        if (value.entries.length) throw new Error("AIDT_V2_S2_SUPPLEMENT_EXHAUSTED");
        const id = randomUUID(); value.entries.push({ id, projectId, threadId, skill: "aidt-empathize", promptSha256: createHash("sha256").update(prompt).digest("hex"),
          reservedAt: new Date().toISOString(), status: "reserved", provider: "unknown", outcomes: [] }); return id;
      });
    },
    record(id: string, requestPath: string): void {
      mutate(value => { const entry = value.entries.find(item => item.id === id); if (!entry || entry.status !== "reserved") throw new Error("AIDT_V2_S2_SUPPLEMENT_RESERVATION_MISMATCH");
        Object.assign(entry, { status: "request-observed", requestPath, sentAt: new Date().toISOString() }); });
    },
    finish(id: string, outcome: Outcome): void {
      mutate(value => { const entry = value.entries.find(item => item.id === id); if (!entry) throw new Error("AIDT_V2_S2_SUPPLEMENT_ENTRY_MISSING");
        if (entry.runId && outcome.runId && entry.runId !== outcome.runId) throw new Error("AIDT_V2_S2_SUPPLEMENT_DIFFERENT_RUN_REJECTED");
        entry.outcomes.push({ ...outcome, recordedAt: new Date().toISOString() });
        Object.assign(entry, { status: outcome.succeeded ? "succeeded" : "failed-or-interrupted", ...(outcome.runId ? { runId: outcome.runId } : {}) }); });
    },
  };
}
