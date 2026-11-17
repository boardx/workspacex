import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { additionalS2RunLedger } from "../e2e/support/aidt-v2-s2-supplement-ledger";

const original = { ...process.env }, directories: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "aidt-extra-s2-test-")); directories.push(dir);
  const old = join(dir, "old-seven.json"), s1 = join(dir, "old-extra-s1.json"), s2 = join(dir, "new-extra-s2.json");
  writeFileSync(old, JSON.stringify({ schemaVersion: 1, maximumNativeModelRuns: 7, entries: [{ skill: "aidt-empathize", runId: "original-cancelled", status: "failed-or-interrupted" }] }));
  writeFileSync(s1, JSON.stringify({ schemaVersion: 1, maximumNativeModelRuns: 1, authorization: "additional-s1-20261116", entries: [{ status: "succeeded" }] }));
  Object.assign(process.env, { AIDT_V2_RUN_LEDGER: old, AIDT_V2_SUPPLEMENTAL_S1_LEDGER: s1, AIDT_V2_SUPPLEMENTAL_S2_LEDGER: s2,
    AIDT_V2_S2_SUPPLEMENT_AUTHORIZED: "approved-additional-s2-once", AIDT_V2_S2_SUPPLEMENT_PROJECT_ID: "same-project", AIDT_V2_CANCELLED_S2_RUN_ID: "original-cancelled" });
  return { dir, old, s1, s2, hashes: [old, s1].map(file => createHash("sha256").update(readFileSync(file)).digest("hex")) };
}
afterEach(() => { process.env = { ...original }; directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
describe("separately reviewed S2 after cancelled echo fixture task", () => {
  it("defaults closed and rejects any skill or project outside the one authorized task", () => {
    const { s2 } = setup(); delete process.env.AIDT_V2_S2_SUPPLEMENT_AUTHORIZED;
    expect(() => additionalS2RunLedger()).toThrow("S2_SUPPLEMENT_AUTHORIZATION_REQUIRED"); expect(existsSync(s2)).toBe(false);
    process.env.AIDT_V2_S2_SUPPLEMENT_AUTHORIZED = "1";
    expect(() => additionalS2RunLedger()).toThrow("S2_SUPPLEMENT_AUTHORIZATION_REQUIRED");
    process.env.AIDT_V2_S2_SUPPLEMENT_AUTHORIZED = "approved-additional-s2-once";
    const ledger = additionalS2RunLedger();
    expect(() => ledger.reserve("same-project", "new-thread", "aidt-understand", "synthetic")).toThrow("ONLY_AIDT_EMPATHIZE");
    expect(() => ledger.reserve("another-project", "new-thread", "aidt-empathize", "synthetic")).toThrow("PROJECT_MISMATCH");
    expect(existsSync(s2)).toBe(false);
  });
  it("rejects relative/directory paths and aliases of either old journal", () => {
    const { old, s1, dir } = setup();
    for (const file of [old, s1]) { process.env.AIDT_V2_SUPPLEMENTAL_S2_LEDGER = file; expect(() => additionalS2RunLedger()).toThrow("SEPARATE_JOURNAL_REQUIRED"); }
    const alias = join(dir, "alias.json"); symlinkSync(old, alias); process.env.AIDT_V2_SUPPLEMENTAL_S2_LEDGER = alias;
    expect(() => additionalS2RunLedger()).toThrow("SEPARATE_JOURNAL_REQUIRED");
    process.env.AIDT_V2_SUPPLEMENTAL_S2_LEDGER = "relative.json"; expect(() => additionalS2RunLedger()).toThrow("ABSOLUTE_JOURNAL_REQUIRED");
    const folder = join(dir, "folder.json"); mkdirSync(folder); process.env.AIDT_V2_SUPPLEMENTAL_S2_LEDGER = folder;
    expect(() => additionalS2RunLedger()).toThrow("ABSOLUTE_JOURNAL_REQUIRED");
  });
  it("counts an unknown/failed attempt once across processes and preserves both old journals byte for byte", () => {
    const { old, s1, s2, hashes } = setup(); const ledger = additionalS2RunLedger();
    const id = ledger.reserve("same-project", "new-thread", "aidt-empathize", "synthetic prompt");
    ledger.record(id, "/actual-native-send"); ledger.finish(id, { succeeded: false, runId: "new-actual-run", failureCode: "INTERRUPTED" });
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "import {additionalS2RunLedger} from './e2e/support/aidt-v2-s2-supplement-ledger.ts'; additionalS2RunLedger().reserve('same-project','another-new-thread','aidt-empathize','second')"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    expect(child.status).not.toBe(0); expect(child.stderr).toContain("S2_SUPPLEMENT_EXHAUSTED");
    expect(JSON.parse(readFileSync(s2, "utf8"))).toMatchObject({ maximumNativeModelRuns: 1, originalCancelledRunId: "original-cancelled", entries: [{ status: "failed-or-interrupted", provider: "unknown" }] });
    expect([old, s1].map(file => createHash("sha256").update(readFileSync(file)).digest("hex"))).toEqual(hashes);
  });
  it("does not overwrite when a different process already owns the atomic lock", () => {
    const { s2 } = setup(); mkdirSync(`${s2}.lock`);
    expect(() => additionalS2RunLedger().reserve("same-project", "new-thread", "aidt-empathize", "synthetic")).toThrow();
    expect(existsSync(s2)).toBe(false);
  });
});
