import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, normalize } from "node:path";
import { reserveAidtNativeRun, recordAidtNativeRequest, finishAidtNativeRun } from "./aidt-v2-run-ledger";
import { additionalS2RunLedger } from "./aidt-v2-s2-supplement-ledger";

type Outcome = Parameters<typeof finishAidtNativeRun>[1];
type AdditionalEntry = { id: string; projectId: string; threadId: string; skill: "aidt-understand"; promptSha256: string;
  reservedAt: string; status: "reserved" | "request-observed" | "succeeded" | "failed-or-interrupted";
  provider: "unknown"; requestPath?: string; sentAt?: string; runId?: string; finishedAt?: string; failureCode?: string;
  outcomes: (Outcome & { recordedAt: string })[] };
type AdditionalLedger = { schemaVersion: 1; maximumNativeModelRuns: 1; authorization: "additional-s1-20261116"; entries: AdditionalEntry[] };

/** Only the separately approved S1 uses this journal. Original seven-slot journal stays unchanged. */
export function nativeRunLedger(skill: string) {
  if (skill === "aidt-empathize" && (process.env.AIDT_V2_SUPPLEMENTAL_S2_LEDGER || process.env.AIDT_V2_S2_SUPPLEMENT_AUTHORIZED)) return additionalS2RunLedger();
  if (skill !== "aidt-understand" || !process.env.AIDT_V2_SUPPLEMENTAL_S1_LEDGER) {
    return { reserve: reserveAidtNativeRun, record: recordAidtNativeRequest, finish: finishAidtNativeRun };
  }
  if (process.env.AIDT_V2_S1_SUPPLEMENT_AUTHORIZED !== "1") throw new Error("AIDT_V2_SUPPLEMENT_AUTHORIZATION_REQUIRED");
  const provided = process.env.AIDT_V2_SUPPLEMENTAL_S1_LEDGER;
  if (!isAbsolute(provided) || extname(provided) !== ".json") throw new Error("AIDT_V2_SUPPLEMENT_PATH_REQUIRED");
  const file = normalize(provided);
  if (file === normalize(process.env.AIDT_V2_RUN_LEDGER ?? "")) throw new Error("AIDT_V2_SUPPLEMENT_MUST_BE_SEPARATE");
  if (existsSync(file) && statSync(file).isDirectory()) throw new Error("AIDT_V2_SUPPLEMENT_PATH_REQUIRED");
  const mutate = <T>(change: (value: AdditionalLedger) => T): T => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const lock = `${file}.lock`; mkdirSync(lock, { mode: 0o700 });
    try {
      const value: AdditionalLedger = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdditionalLedger
        : { schemaVersion: 1, maximumNativeModelRuns: 1, authorization: "additional-s1-20261116", entries: [] };
      if (value.schemaVersion !== 1 || value.maximumNativeModelRuns !== 1 || value.authorization !== "additional-s1-20261116"
        || !Array.isArray(value.entries) || value.entries.length > 1 || value.entries.some(entry => entry.skill !== "aidt-understand")) throw new Error("AIDT_V2_SUPPLEMENT_INVALID");
      const result = change(value), temp = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temp, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); renameSync(temp, file);
      return result;
    } finally { rmdirSync(lock); }
  };
  return {
    reserve(projectId: string, threadId: string, requestedSkill: string, prompt: string): string {
      if (requestedSkill !== "aidt-understand") throw new Error("AIDT_V2_SUPPLEMENT_ONLY_S1");
      return mutate(value => {
        // Unknown/failed attempts remain consumed; this journal has no reconciliation or retry API.
        if (value.entries.length) throw new Error("AIDT_V2_SUPPLEMENT_EXHAUSTED");
        const id = randomUUID(); value.entries.push({ id, projectId, threadId, skill: "aidt-understand",
          promptSha256: createHash("sha256").update(prompt).digest("hex"), reservedAt: new Date().toISOString(), status: "reserved", provider: "unknown", outcomes: [] });
        return id;
      });
    },
    record(id: string, requestPath: string): void {
      mutate(value => { const entry = value.entries.find(row => row.id === id);
        if (!entry || entry.status !== "reserved") throw new Error("AIDT_V2_SUPPLEMENT_RESERVATION_MISMATCH");
        Object.assign(entry, { status: "request-observed", requestPath, sentAt: new Date().toISOString() }); });
    },
    finish(id: string, outcome: Outcome): void {
      mutate(value => { const entry = value.entries.find(row => row.id === id);
        if (!entry) throw new Error("AIDT_V2_SUPPLEMENT_ENTRY_MISSING");
        entry.outcomes.push({ ...outcome, recordedAt: new Date().toISOString() });
        Object.assign(entry, { status: outcome.succeeded ? "succeeded" : "failed-or-interrupted", finishedAt: new Date().toISOString(),
          ...(outcome.runId ? { runId: outcome.runId } : {}), ...(outcome.failureCode ? { failureCode: outcome.failureCode } : {}) }); });
    },
  };
}
