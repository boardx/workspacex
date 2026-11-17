import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const runner = fileURLToPath(new URL("../e2e/support/aidt-v2-remediation-runner.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
it("requires exact phase GO before reading private config or creating output", () => {
  const directory = mkdtempSync(join(tmpdir(), "aidt-driver-")); dirs.push(directory);
  const output = join(directory, "output");
  expect(() => execFileSync(process.execPath, [runner, "--phase", "s1", "--allow-phase", "s2", "--runtime", "/tmp/not-read-private.json", "--out", output], { stdio: "pipe" })).toThrow("EXACT_ROOT_PHASE_GO_REQUIRED");
  expect(existsSync(output)).toBe(false);
});
it("refuses an unset/wrong browser API prefix before any browser or model action", () => {
  const directory = mkdtempSync(join(tmpdir(), "aidt-driver-")); dirs.push(directory);
  const runtime = join(directory, "runtime.json"), output = join(directory, "output"); writeFileSync(runtime, JSON.stringify({ apiPathPrefix: "/api" }));
  expect(() => execFileSync(process.execPath, [runner, "--phase", "setup", "--allow-phase", "setup", "--runtime", runtime, "--out", output], { stdio: "pipe" })).toThrow("ACTUAL_OWNER_RUNTIME_PATHS_AND_PREFIX_REQUIRED");
  expect(existsSync(output)).toBe(false);
});
it("refuses a different or closed owner paid window", () => {
  const directory = mkdtempSync(join(tmpdir(), "aidt-driver-")); dirs.push(directory);
  const runtime = join(directory, "runtime.json"), output = join(directory, "output");
  writeFileSync(runtime, JSON.stringify({ apiPathPrefix: "/__fullstack_api", nativeJournal: join(directory, "journal.json"), journeyState: join(directory, "state.json"), isolation: { WORKSPACEX_ISOLATION_ID: "test" }, paidWindowPhase: "closed" }));
  expect(() => execFileSync(process.execPath, [runner, "--phase", "s1", "--allow-phase", "s1", "--runtime", runtime, "--out", output], { stdio: "pipe" })).toThrow("ACTUAL_OWNER_EXACT_PAID_WINDOW_REQUIRED");
  expect(existsSync(output)).toBe(false);
});

it("maps only QA sum to the owner's summary window in a no-spawn configuration check", () => {
  const directory = mkdtempSync(join(tmpdir(), "aidt-driver-")); dirs.push(directory);
  const runtime = join(directory, "runtime.json"), output = join(directory, "output");
  const value = { apiPathPrefix: "/__fullstack_api", nativeJournal: join(directory, "journal.json"), journeyState: join(directory, "state.json"), isolation: { WORKSPACEX_ISOLATION_ID: "test" }, paidWindowPhase: "summary" };
  writeFileSync(runtime, JSON.stringify(value));
  const args = [runner, "--phase", "sum", "--allow-phase", "sum", "--runtime", runtime, "--out", output, "--check"];
  const checked = JSON.parse(execFileSync(process.execPath, args, { encoding: "utf8", stdio: "pipe" }));
  expect(checked).toMatchObject({ phase: "sum", ownerPhase: "summary", spawned: false, modelRequests: 0, configurationOnly: true });
  expect(existsSync(output)).toBe(false);
  writeFileSync(runtime, JSON.stringify({ ...value, paidWindowPhase: "sum" }));
  expect(() => execFileSync(process.execPath, args, { stdio: "pipe" })).toThrow("ACTUAL_OWNER_EXACT_PAID_WINDOW_REQUIRED");
});
