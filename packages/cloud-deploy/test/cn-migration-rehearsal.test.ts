import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { closeSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { acquireRehearsalRun, assertLocalDockerEndpoint, assertRehearsalResourcesAbsent, openPrivateReport } from "../src/cn-migration-rehearsal-safety";
import { binding, fixture } from "./cn-migration-snapshot.fixture";
const script = fileURLToPath(new URL("../src/cn-migration-rehearsal-cli.ts", import.meta.url));
function failure(args: string[], profile?: string) {
  try {
    execFileSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8", stdio: "pipe", env: { ...process.env, WORKSPACEX_DEPLOY_PROFILE: profile ?? "" } });
    return "unexpected_success";
  } catch (error) { return String((error as { stderr?: unknown }).stderr); }
}
it("refuses any cloud profile before reading input or contacting Docker", () => {
  expect(failure(["nonexistent-checkout", "a".repeat(40), "b".repeat(40), "nonexistent-ledger", "nonexistent-binding", "nonexistent-report"], "production")).toContain("synthetic rehearsal refuses cloud profile");
});
it.each([0o022, 0o077])("reserves an exclusive 0600 report and preserves existing files under umask %i", (mask) => {
  const dir = mkdtempSync(join(tmpdir(), "rehearsal-report-"));
  const previousMask = process.umask(mask);
  try {
    const path = join(dir, "report.json");
    const fd = openPrivateReport(path);
    try { writeFileSync(fd, "private"); } finally { closeSync(fd); }
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => openPrivateReport(path)).toThrow();
    const target = join(dir, "existing.json");
    writeFileSync(target, "unchanged", { mode: 0o644 });
    // Requested creation mode is filtered by umask. Preserve the actual inode's
    // mode, whether 0644 or 0600, rather than assuming the host uses umask 022.
    const originalMode = statSync(target).mode & 0o777;
    expect(originalMode).toBe(0o644 & ~mask);
    const link = join(dir, "link.json"); symlinkSync(target, link);
    expect(() => openPrivateReport(target)).toThrow();
    expect(() => openPrivateReport(link)).toThrow();
    expect(readFileSync(target, "utf8")).toBe("unchanged");
    expect(statSync(target).mode & 0o777).toBe(originalMode);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); }
    finally { process.umask(previousMask); }
  }
});
it("isolates concurrent runs and rejects duplicate ownership until its holder releases", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rehearsal-locks-"));
  const runs: ReturnType<typeof acquireRehearsalRun>[] = [];
  try {
    await Promise.all(Array.from({ length: 20 }, async () => { runs.push(acquireRehearsalRun(undefined, dir)); }));
    expect(new Set(runs.map(run => run.project)).size).toBe(20);
    expect(() => acquireRehearsalRun(runs[0]!.runId, dir)).toThrow();
    runs[0]!.release();
    const replacement = acquireRehearsalRun(runs[0]!.runId, dir);
    // Calling a previously released owner's cleanup must not delete a new owner's lock.
    runs[0]!.release();
    expect(() => acquireRehearsalRun(replacement.runId, dir)).toThrow();
    replacement.release();
  } finally { for (const run of runs) run.release(); rmSync(dir, { recursive: true, force: true }); }
});
it("two concurrent processes cannot acquire or clean the same project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rehearsal-process-lock-"));
  const helper = new URL("../src/cn-migration-rehearsal-safety.ts", import.meta.url).href;
  const runId = randomUUID();
  const code = `import { acquireRehearsalRun } from ${JSON.stringify(helper)};
    let run; try { run = acquireRehearsalRun(${JSON.stringify(runId)}, ${JSON.stringify(dir)}); }
    catch { console.log("refused"); process.exit(0); }
    console.log("owned"); await new Promise(resolve => setTimeout(resolve, 1000)); run.release();`;
  try {
    const launch = () => promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code]);
    const results = await Promise.all([launch(), launch()]);
    expect(results.map(result => result.stdout.trim()).sort()).toEqual(["owned", "refused"]);
    const after = acquireRehearsalRun(runId, dir); after.release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("refuses existing resources and remote Docker endpoints", () => {
  for (const occupied of [0, 1, 2]) {
    let call = 0;
    expect(() => assertRehearsalResourcesAbsent("isolated", () => call++ === occupied ? "existing" : "")).toThrow("already exists");
  }
  expect(() => assertRehearsalResourcesAbsent("isolated", () => "")).not.toThrow();
  expect(() => assertLocalDockerEndpoint("unix:///var/run/docker.sock")).not.toThrow();
  for (const endpoint of ["tcp://127.0.0.1:2375", "ssh://host", "unix://relative", ""]) {
    expect(() => assertLocalDockerEndpoint(endpoint)).toThrow("local Unix");
  }
});
it("CLI rejects existing reports before attempting invalid checkout or Docker", () => {
  const dir = mkdtempSync(join(tmpdir(), "rehearsal-existing-"));
  try {
    const ledger = join(dir, "ledger.json"); writeFileSync(ledger, JSON.stringify(fixture([]).snapshot), { mode: 0o600 });
    const sourceBinding = join(dir, "binding.json"); writeFileSync(sourceBinding, JSON.stringify(binding), { mode: 0o600 });
    const report = join(dir, "report.json"); writeFileSync(report, "unchanged", { mode: 0o644 });
    const link = join(dir, "report-link.json"); symlinkSync(report, link);
    for (const path of [report, link]) expect(failure(["missing", "a".repeat(40), "b".repeat(40), ledger, sourceBinding, path])).toContain("EEXIST");
    expect(readFileSync(report, "utf8")).toBe("unchanged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("refuses ledger input without read-only format before contacting Docker", () => {
  const dir = mkdtempSync(join(tmpdir(), "rehearsal-refusal-"));
  try {
    const ledger = join(dir, "ledger.json");
    writeFileSync(ledger, JSON.stringify({ readOnly: false, ledger: [] }), { mode: 0o600 });
    const sourceBinding = join(dir, "binding.json"); writeFileSync(sourceBinding, JSON.stringify(binding), { mode: 0o600 });
    expect(failure([dir, "a".repeat(40), "b".repeat(40), ledger, sourceBinding, join(dir, "report.json")])).toContain("MIGRATION_SNAPSHOT_SCHEMA_INVALID");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
