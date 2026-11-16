import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compactSummaryRunLedger } from "../e2e/support/aidt-v2-summary-supplement-ledger";
const original = { ...process.env }, dirs: string[] = [];
afterEach(() => { process.env = { ...original }; dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function setup() { const dir = mkdtempSync(join(tmpdir(), "compact-summary-")); dirs.push(dir); const main = join(dir, "main.json"), extra = join(dir, "extra.json"); writeFileSync(main, "original-seven-and-failure"); Object.assign(process.env, { AIDT_V2_RUN_LEDGER: main, AIDT_V2_SUPPLEMENTAL_SUMMARY_LEDGER: extra, AIDT_V2_SUMMARY_SUPPLEMENT_AUTHORIZED: "one-compact-summary-20261117" }); return { main, extra }; }
it("requires exact one-time authorization and cannot alias the original seven ledger", () => { const { main } = setup(); process.env.AIDT_V2_SUMMARY_SUPPLEMENT_AUTHORIZED = "1"; expect(() => compactSummaryRunLedger()).toThrow("EXACT_AUTHORIZATION"); process.env.AIDT_V2_SUMMARY_SUPPLEMENT_AUTHORIZED = "one-compact-summary-20261117"; process.env.AIDT_V2_SUPPLEMENTAL_SUMMARY_LEDGER = main; expect(() => compactSummaryRunLedger()).toThrow("DISTINCT_ABSOLUTE"); });
it("retains failed or successful extra attempts without granting retries or rewriting main", () => { const { main, extra } = setup(), ledger = compactSummaryRunLedger(), id = ledger.reserve("p", "new-thread", "dt-summarize-project", "compact complete"); ledger.record(id, "/native"); ledger.finish(id, { succeeded: false, runId: "actual", failureCode: "incomplete" }); expect(() => ledger.reserve("p", "new-thread", "dt-summarize-project", "again")).toThrow("ONE_TASK_NO_RETRY"); expect(readFileSync(main, "utf8")).toBe("original-seven-and-failure"); expect(JSON.parse(readFileSync(extra, "utf8"))).toMatchObject({ maximumNativeModelRuns: 1, entries: [{ status: "failed-or-interrupted", runId: "actual" }] }); });

it("allocates the explicitly authorized student correction as a separate single slot, never reopens compact", () => {
  const { extra } = setup(), old = compactSummaryRunLedger(), id = old.reserve("p", "t", "dt-summarize-project", "first"); old.record(id, "/native"); old.finish(id, { succeeded: true, runId: "compact-run" });
  const bytes = readFileSync(extra), corrected = join(dirs.at(-1)!, "correction.json");
  process.env.AIDT_V2_SUMMARY_SUPPLEMENT_AUTHORIZED = "one-student-summary-correction-20261117";
  expect(() => compactSummaryRunLedger().reserve("p", "t", "dt-summarize-project", "reuse old path")).toThrow("INVALID");
  process.env.AIDT_V2_SUPPLEMENTAL_SUMMARY_LEDGER = corrected;
  const next = compactSummaryRunLedger(); next.reserve("p", "t", "dt-summarize-project", "actual saved-field correction");
  expect(() => next.reserve("p", "t", "dt-summarize-project", "another")).toThrow("ONE_TASK_NO_RETRY");
  expect(readFileSync(extra)).toEqual(bytes);
});
