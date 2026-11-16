import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { nativeRunLedger } from "../e2e/support/aidt-v2-supplemental-ledger";

const original = { ...process.env };
const directories: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "aidt-supplement-test-")); directories.push(dir);
  const old = join(dir, "old-seven.json"), extra = join(dir, "additional-s1.json");
  const bytes = JSON.stringify({ schemaVersion: 1, maximumNativeModelRuns: 7, entries: [{
    id: "original-paid-s1", projectId: "old-project", threadId: "old-thread", skill: "aidt-understand",
    promptSha256: "old", reservedAt: "2026-11-16T00:00:00Z", status: "succeeded", provider: "invoked-verified",
  }] });
  writeFileSync(old, bytes);
  Object.assign(process.env, { AIDT_V2_RUN_LEDGER: old, AIDT_V2_SUPPLEMENTAL_S1_LEDGER: extra, AIDT_V2_S1_SUPPLEMENT_AUTHORIZED: "1" });
  return { old, extra, bytes };
}
afterEach(() => { process.env = { ...original }; for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("separately approved additional S1, never an eighth slot in the original ledger", () => {
  it("requires explicit authorization and a distinct absolute JSON path", () => {
    const { old } = setup();
    process.env.AIDT_V2_S1_SUPPLEMENT_AUTHORIZED = "0";
    expect(() => nativeRunLedger("aidt-understand")).toThrow("SUPPLEMENT_AUTHORIZATION_REQUIRED");
    process.env.AIDT_V2_S1_SUPPLEMENT_AUTHORIZED = "1";
    process.env.AIDT_V2_SUPPLEMENTAL_S1_LEDGER = old;
    expect(() => nativeRunLedger("aidt-understand")).toThrow("SUPPLEMENT_MUST_BE_SEPARATE");
    process.env.AIDT_V2_SUPPLEMENTAL_S1_LEDGER = "relative.json";
    expect(() => nativeRunLedger("aidt-understand")).toThrow("SUPPLEMENT_PATH_REQUIRED");
  });
  it("counts uncertain or failed attempts permanently and preserves original bytes", () => {
    const { old, extra, bytes } = setup();
    const ledger = nativeRunLedger("aidt-understand");
    const id = ledger.reserve("project", "thread", "aidt-understand", "synthetic prompt");
    ledger.record(id, "/native-send"); ledger.finish(id, { succeeded: false, runId: "actual-run", failureCode: "TEST_FAILURE" });
    expect(() => ledger.reserve("project", "thread", "aidt-understand", "do not retry")).toThrow("SUPPLEMENT_EXHAUSTED");
    expect(JSON.parse(readFileSync(extra, "utf8"))).toMatchObject({ maximumNativeModelRuns: 1, authorization: "additional-s1-20261116", entries: [{ status: "failed-or-interrupted", runId: "actual-run" }] });
    expect(readFileSync(old, "utf8")).toBe(bytes);
  });
  it("keeps S2 on the original seven-budget and prevents supplemental reuse across processes", () => {
    const { extra, old } = setup();
    nativeRunLedger("aidt-understand").reserve("project", "thread", "aidt-understand", "one");
    const script = `import {nativeRunLedger} from './e2e/support/aidt-v2-supplemental-ledger.ts'; nativeRunLedger('aidt-understand').reserve('p','t','aidt-understand','second')`;
    const second = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8", cwd: process.cwd(), env: process.env });
    expect(second.status).not.toBe(0); expect(second.stderr).toContain("SUPPLEMENT_EXHAUSTED");
    nativeRunLedger("aidt-empathize").reserve("project", "thread2", "aidt-empathize", "S2");
    expect(JSON.parse(readFileSync(extra, "utf8")).entries).toHaveLength(1);
    expect(JSON.parse(readFileSync(old, "utf8"))).toMatchObject({ maximumNativeModelRuns: 7, entries: [{ skill: "aidt-understand" }, { skill: "aidt-empathize" }] });
  });
});
