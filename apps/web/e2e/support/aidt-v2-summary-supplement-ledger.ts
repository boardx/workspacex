import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
type Outcome = { runId?: string; succeeded: boolean; failureCode?: string };
type Entry = { id: string; projectId: string; threadId: string; skill: string; promptSha256: string; status: string; runId?: string; outcomes: Outcome[] };
type Ledger = { schemaVersion: 1; maximumNativeModelRuns: 1; authorization: "one-compact-summary-20261117" | "one-student-summary-correction-20261117"; entries: Entry[] };
export function compactSummaryRunLedger() {
  const authorization = process.env.AIDT_V2_SUMMARY_SUPPLEMENT_AUTHORIZED;
  if (authorization !== "one-compact-summary-20261117" && authorization !== "one-student-summary-correction-20261117") throw new Error("AIDT_SUMMARY_SUPPLEMENT_EXACT_AUTHORIZATION_REQUIRED");
  const file = process.env.AIDT_V2_SUPPLEMENTAL_SUMMARY_LEDGER;
  if (!file || !isAbsolute(file) || extname(file) !== ".json" || resolve(file) === resolve(process.env.AIDT_V2_RUN_LEDGER ?? "")) throw new Error("AIDT_SUMMARY_SUPPLEMENT_DISTINCT_ABSOLUTE_FILE_REQUIRED");
  const mutate = <T>(change: (ledger: Ledger) => T): T => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); const lock = `${file}.lock`; mkdirSync(lock, { mode: 0o700 });
    try {
      const value: Ledger = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { schemaVersion: 1, maximumNativeModelRuns: 1, authorization, entries: [] };
      if (value.schemaVersion !== 1 || value.maximumNativeModelRuns !== 1 || value.authorization !== authorization || !Array.isArray(value.entries) || value.entries.length > 1) throw new Error("AIDT_SUMMARY_SUPPLEMENT_INVALID");
      const result = change(value), temp = `${file}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); renameSync(temp, file); return result;
    } finally { rmdirSync(lock); }
  };
  return {
    reserve(projectId: string, threadId: string, skill: string, prompt: string) { return mutate(value => {
      if (skill !== "dt-summarize-project" || value.entries.length) throw new Error("AIDT_SUMMARY_SUPPLEMENT_ONE_TASK_NO_RETRY");
      const id = randomUUID(); value.entries.push({ id, projectId, threadId, skill, promptSha256: createHash("sha256").update(prompt).digest("hex"), status: "reserved", outcomes: [] }); return id;
    }); },
    record(id: string, requestPath: string) { mutate(value => { const row = value.entries.find(entry => entry.id === id); if (!row || row.status !== "reserved") throw new Error("AIDT_SUMMARY_SUPPLEMENT_RESERVATION_REQUIRED"); Object.assign(row, { status: "request-observed", requestPath, sentAt: new Date().toISOString() }); }); },
    finish(id: string, outcome: Outcome) { mutate(value => { const row = value.entries.find(entry => entry.id === id); if (!row) throw new Error("AIDT_SUMMARY_SUPPLEMENT_ENTRY_REQUIRED"); row.outcomes.push(outcome); Object.assign(row, { status: outcome.succeeded ? "succeeded" : "failed-or-interrupted", ...outcome, finishedAt: new Date().toISOString() }); }); },
  };
}
