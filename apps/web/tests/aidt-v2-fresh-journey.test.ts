import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFreshAidtJourney } from "../e2e/support/aidt-v2-fresh-journey";
import { nativeRunLedger } from "../e2e/support/aidt-v2-supplemental-ledger";

const original = { ...process.env }, dirs: string[] = [];
afterEach(() => { process.env = { ...original }; dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function fresh() {
  for (const key of Object.keys(process.env)) if (key.startsWith("AIDT_V2_")) delete process.env[key];
  const dir = mkdtempSync(join(tmpdir(), "aidt-fresh-seven-")); dirs.push(dir);
  Object.assign(process.env, { AIDT_V2_FRESH_JOURNEY: "fresh-native-seven-20261117", AIDT_V2_RUN_LEDGER: join(dir, "seven.json"), AIDT_V2_COMPLETION_STATE: join(dir, "state.json") });
  return dir;
}
it("leaves historical entry unchanged by default; fresh start must be explicit and reject old supplement/resume flags", () => {
  delete process.env.AIDT_V2_FRESH_JOURNEY; expect(assertFreshAidtJourney()).toBe(false);
  fresh(); expect(assertFreshAidtJourney(true)).toBe(true);
  process.env.AIDT_V2_FRESH_JOURNEY = "implicit"; expect(() => assertFreshAidtJourney()).toThrow("EXPLICIT_MARKER_REQUIRED");
  process.env.AIDT_V2_FRESH_JOURNEY = "fresh-native-seven-20261117";
  for (const key of ["AIDT_V2_SUPPLEMENTAL_S1_LEDGER", "AIDT_V2_S1_SUPPLEMENT_AUTHORIZED", "AIDT_V2_SUPPLEMENTAL_S2_LEDGER", "AIDT_V2_RESUME_UNSENT_S2", "AIDT_V2_UNSENT_S2_PROOF"]) {
    process.env[key] = ""; expect(() => assertFreshAidtJourney()).toThrow("OLD_SUPPLEMENT_ENV_FORBIDDEN"); delete process.env[key];
  }
});
it("rejects relative/aliased paths and existing historical state or journal without rewriting bytes", () => {
  fresh(); const ledger = process.env.AIDT_V2_RUN_LEDGER!;
  process.env.AIDT_V2_RUN_LEDGER = "relative.json"; expect(() => assertFreshAidtJourney()).toThrow("ABSOLUTE_JSON_REQUIRED");
  process.env.AIDT_V2_RUN_LEDGER = process.env.AIDT_V2_COMPLETION_STATE; expect(() => assertFreshAidtJourney()).toThrow("DISTINCT_ABSOLUTE_JSON_REQUIRED");
  process.env.AIDT_V2_RUN_LEDGER = ledger; writeFileSync(ledger, "historical failed journal");
  expect(() => assertFreshAidtJourney(true)).toThrow("MUST_NOT_EXIST"); expect(readFileSync(ledger, "utf8")).toBe("historical failed journal");
});
it("uses one new seven-task journal for S1 and S2, preserves failure and rejects an automatic second S1", () => {
  const dir = fresh(), old = join(dir, "old-unchanged.json"); writeFileSync(old, "historical failed and pending attempts");
  expect(assertFreshAidtJourney(true)).toBe(true);
  const s1 = nativeRunLedger("aidt-understand"), first = s1.reserve("new-project", "new-s1-thread", "aidt-understand", "synthetic");
  s1.record(first, "/api/copilotkit/agent/default/run"); s1.finish(first, { succeeded: false, runId: "actual-failed", failureCode: "KEPT" });
  expect(() => s1.reserve("new-project", "new-s1-thread", "aidt-understand", "do not auto retry")).toThrow("SKILL_ALREADY_ATTEMPTED");
  nativeRunLedger("aidt-empathize").reserve("new-project", "new-s2-thread", "aidt-empathize", "synthetic");
  expect(JSON.parse(readFileSync(process.env.AIDT_V2_RUN_LEDGER!, "utf8"))).toMatchObject({ maximumNativeModelRuns: 7,
    entries: [{ skill: "aidt-understand", status: "failed-or-interrupted" }, { skill: "aidt-empathize", status: "reserved" }] });
  expect(readFileSync(old, "utf8")).toBe("historical failed and pending attempts");
});
