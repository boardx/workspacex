/**
 * EV02：`pnpm harness eval --entity S003` 回环运行器（04-eval-gates R3.3，A2，E1/E2/E3/E11）。
 * 每条用例都在套件的临时副本上跑，报告写进临时目录，不污染仓库。
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { WorkEvalReport } from "@repo/contracts/work-eval";
import { scanFixtureForPersonalData } from "../../src/application/work-eval/fixture-privacy";
import { EXIT, parseEvalArgs, resolveSubjectVersion, runEvalCommand } from "../../src/infrastructure/work-eval/fs-eval-suite";

const repoRoot = resolve(__dirname, "../../../..");
const tmpRoots: string[] = [];
afterAll(() => tmpRoots.forEach(d => rmSync(d, { recursive: true, force: true })));

function copySuite(): string {
  const root = mkdtempSync(join(tmpdir(), "ev02-"));
  tmpRoots.push(root);
  cpSync(join(repoRoot, "evals/work-stack/S003"), join(root, "S003"), { recursive: true, filter: src => !src.includes("/reports") });
  return root;
}

const quiet = { out: () => {}, err: () => {} };
const S003 = (evalsRoot: string, extra: Partial<Parameters<typeof runEvalCommand>[0]> = {}) =>
  runEvalCommand({ repoRoot, entity: "S003", evalsRoot, ...quiet, ...extra });

describe("harness eval runner (EV02)", () => {
  it("runs every S003 case on the loopback model, writes a schema-valid report and exits 0", async () => {
    const root = copySuite();
    const r = await S003(root, { runId: "S003-test-run" });
    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.reportPath).toBe(join(root, "S003/reports/S003-test-run.json"));
    const report = WorkEvalReport.parse(JSON.parse(readFileSync(r.reportPath!, "utf8")));
    expect(report.lane).toBe("loopback");
    expect(report.partial).toBe(false);
    expect(report.graderVersion).toBe("s003-rules-1.0.0");
    expect(report.subjectVersionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.fixturesDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.subject.results.map(c => c.caseId)).toEqual(Array.from({ length: 10 }, (_, i) => `E${i + 1}`));
    for (const c of report.subject.results) expect(c, c.caseId).toMatchObject({ outcome: "pass", reason: null });
    expect(report.subject).toMatchObject({ passed: 10, total: 10 });
    expect(report.baseline).toBeNull();
  });

  it("digests are deterministic across runs and change when a fixture changes", async () => {
    const root = copySuite();
    const a = (await S003(root)).report!;
    const b = (await S003(root)).report!;
    expect(b.subjectVersionDigest).toBe(a.subjectVersionDigest);
    expect(b.fixturesDigest).toBe(a.fixturesDigest);
    expect(b.runId).not.toBe(a.runId);
    const f = join(root, "S003/fixtures/travel-policy.json");
    writeFileSync(f, readFileSync(f, "utf8").replace("600", "650"));
    expect((await S003(root)).report!.fixturesDigest).not.toBe(a.fixturesDigest);
  });

  it("a failing assertion → fail with reason, exit 1; other cases keep their result", async () => {
    const root = copySuite();
    const casesPath = join(root, "S003/cases.jsonl");
    writeFileSync(casesPath, readFileSync(casesPath, "utf8").replace('"spec": "decision"', '"spec": "fact"'));
    const r = await S003(root);
    expect(r.exitCode).toBe(EXIT.CASE_FAILED_OR_ERROR);
    const e1 = r.report!.subject.results.find(c => c.caseId === "E1")!;
    expect(e1.outcome).toBe("fail");
    expect(e1.reason).toContain("queryType");
    expect(r.report!.subject.passed).toBe(9);
  });

  it("E3: grader throwing → error (never pass), exit non-zero", async () => {
    const root = copySuite();
    const casesPath = join(root, "S003/cases.jsonl");
    writeFileSync(casesPath, readFileSync(casesPath, "utf8").replace('{"kind": "duplicateOfEmpty"', '{"kind": "noSuchAssertion"'));
    const r = await S003(root);
    expect(r.exitCode).toBe(EXIT.CASE_FAILED_OR_ERROR);
    const e7 = r.report!.subject.results.find(c => c.caseId === "E7")!;
    expect(e7.outcome).toBe("error");
    expect(e7.reason).toContain("unknown assertion kind noSuchAssertion");
    expect(r.report!.subject.passed).toBe(9);
  });

  it("E3: a case exceeding caseTimeoutMs → error", async () => {
    const root = copySuite();
    const suitePath = join(root, "S003/suite.json");
    writeFileSync(suitePath, JSON.stringify({ ...JSON.parse(readFileSync(suitePath, "utf8")), caseTimeoutMs: 5 }));
    const grader = join(root, "S003/grader.ts");
    writeFileSync(grader, `${readFileSync(grader, "utf8").replace("export function grade(", "function gradeNow(")}
export async function grade(...a: Parameters<typeof gradeNow>) { await new Promise(r => setTimeout(r, 200)); return gradeNow(...a); }
`);
    const r = await S003(root, { cases: ["E1"] });
    expect(r.exitCode).toBe(EXIT.CASE_FAILED_OR_ERROR);
    expect(r.report!.subject.results[0]).toMatchObject({ caseId: "E1", outcome: "error" });
    expect(r.report!.subject.results[0]!.reason).toContain("timed out after 5ms");
  });

  it("E2: missing fixture → that case is error, the rest still reported", async () => {
    const root = copySuite();
    rmSync(join(root, "S003/fixtures/galaxy-aliases.json"));
    const r = await S003(root);
    expect(r.exitCode).toBe(EXIT.CASE_FAILED_OR_ERROR);
    const e5 = r.report!.subject.results.find(c => c.caseId === "E5")!;
    expect(e5).toMatchObject({ outcome: "error" });
    expect(e5.reason).toContain("fixtures/galaxy-aliases.json");
    expect(r.report!.subject.results.filter(c => c.outcome === "pass")).toHaveLength(9);
  });

  it("A2: --case runs a subset and marks the report partial", async () => {
    const root = copySuite();
    const r = await S003(root, { cases: ["E2", "E3"] });
    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.report!.partial).toBe(true);
    expect(r.report!.subject.results.map(c => c.caseId)).toEqual(["E2", "E3"]);
  });

  it("E1: missing suite or invalid suite.json → exit 2 with file + field path, no report", async () => {
    const root = copySuite();
    const errs: string[] = [];
    const missing = await runEvalCommand({ repoRoot, entity: "S999", evalsRoot: root, out: () => {}, err: l => errs.push(l) });
    expect(missing.exitCode).toBe(EXIT.SUITE_INVALID);
    expect(errs.join("\n")).toContain("suite.json");

    const suitePath = join(root, "S003/suite.json");
    const suite = JSON.parse(readFileSync(suitePath, "utf8"));
    delete suite.graderVersion;
    writeFileSync(suitePath, JSON.stringify(suite));
    errs.length = 0;
    const bad = await runEvalCommand({ repoRoot, entity: "S003", evalsRoot: root, out: () => {}, err: l => errs.push(l) });
    expect(bad.exitCode).toBe(EXIT.SUITE_INVALID);
    expect(errs.join("\n")).toContain("suite.json graderVersion");
    expect(bad.report).toBeNull();
  });

  it("E2: case input violating the subject inputSchema → that case is error", async () => {
    const root = copySuite();
    const casesPath = join(root, "S003/cases.jsonl");
    writeFileSync(casesPath, readFileSync(casesPath, "utf8").replace('"input": {"question": "P2 的预算结论是什么", "mode": "evidence"}', '"input": {"question": "P2 的预算结论是什么", "mode": "summarize"}'));
    const r = await S003(root);
    expect(r.exitCode).toBe(EXIT.CASE_FAILED_OR_ERROR);
    const bad = r.report!.subject.results.filter(c => c.outcome !== "pass");
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ outcome: "error" });
    expect(bad[0]!.reason).toMatch(/inputSchema: mode/);
  });

  it("E2: a fixture that exists but is invalid JSON → error says 'invalid JSON', not 'not found'", async () => {
    const root = copySuite();
    writeFileSync(join(root, "S003/fixtures/galaxy-aliases.json"), "{ not json");
    const r = await S003(root);
    expect(r.exitCode).toBe(EXIT.CASE_FAILED_OR_ERROR);
    const e5 = r.report!.subject.results.find(c => c.caseId === "E5")!;
    expect(e5).toMatchObject({ outcome: "error" });
    expect(e5.reason).toContain("fixture invalid JSON: fixtures/galaxy-aliases.json");
    expect(e5.reason).not.toContain("not found");
  });

  it("nested fixtures are scanned by E11 and included in fixturesDigest", async () => {
    const root = copySuite();
    const before = (await S003(root, { cases: ["E1"] })).report!.fixturesDigest;
    mkdirSync(join(root, "S003/fixtures/sub"));
    writeFileSync(join(root, "S003/fixtures/sub/extra.json"), '{"note":"synthetic"}');
    const after = (await S003(root, { cases: ["E1"] })).report!.fixturesDigest;
    expect(after).not.toBe(before);
    writeFileSync(join(root, "S003/fixtures/sub/extra.json"), '{"note":"lin.wei@corp-mail.cn"}');
    const errs: string[] = [];
    const r = await S003(root, { err: l => errs.push(l) });
    expect(r.exitCode).toBe(EXIT.FIXTURE_REAL_DATA_SUSPECTED);
    expect(errs.join("\n")).toContain("fixtures/sub/extra.json");
  });

  it("EV01 validate-work-eval-suite still fails on a missing fixture (eval's E2 downgrade does not hide it)", () => {
    const root = copySuite();
    rmSync(join(root, "S003/fixtures/galaxy-aliases.json"));
    const tsx = join(repoRoot, "apps/api/node_modules/.bin/tsx");
    const cli = join(repoRoot, "packages/contracts/scripts/validate-work-eval-suite.ts");
    const r = spawnSync(tsx, [cli, join(root, "S003")], { cwd: repoRoot, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("galaxy-aliases.json");
  });

  it("UC-2 --version: current digest runs; any other digest → SUITE_INVALID; unknown flags are reported", async () => {
    const root = copySuite();
    const current = resolveSubjectVersion(repoRoot, "S003")!.digest;
    const ok = await S003(root, { version: current, cases: ["E1"] });
    expect(ok.exitCode).toBe(EXIT.OK);
    expect(ok.report!.subjectVersionDigest).toBe(current);
    expect(ok.report!.subjectVersionLabel).toContain("lb:s003-loopback-");
    const errs: string[] = [];
    const bad = await S003(root, { version: `sha256:${"0".repeat(64)}`, err: l => errs.push(l) });
    expect(bad.exitCode).toBe(EXIT.SUITE_INVALID);
    expect(bad.report).toBeNull();
    expect(errs.join("\n")).toContain("--version");
    expect(parseEvalArgs(["--entity", "S003", "--version", "v1", "--bogus"])).toMatchObject({ version: "v1", unknown: ["--bogus"] });
    const tsx = join(repoRoot, "apps/api/node_modules/.bin/tsx");
    const cli = spawnSync(tsx, [join(repoRoot, ".harness/scripts/cli.ts"), "eval", "--entity", "S003", "--evals-root", root, "--bogus"], { cwd: repoRoot, encoding: "utf8" });
    expect(cli.status).toBe(EXIT.SUITE_INVALID);
    expect(cli.stderr).toContain("unknown argument(s): --bogus");
  });

  it("E11: fixtures with real-looking email/phone → refused (exit 3), no report written", async () => {
    const root = copySuite();
    const f = join(root, "S003/fixtures/galaxy-aliases.json");
    writeFileSync(f, readFileSync(f, "utf8").replace("synthetic-user-lin", "lin.wei@corp-mail.cn 13812345678"));
    const errs: string[] = [];
    const r = await runEvalCommand({ repoRoot, entity: "S003", evalsRoot: root, out: () => {}, err: l => errs.push(l) });
    expect(r.exitCode).toBe(EXIT.FIXTURE_REAL_DATA_SUSPECTED);
    expect(errs.join("\n")).toContain("fixtures/galaxy-aliases.json");
    expect(readdirSync(join(root, "S003")).includes("reports")).toBe(false);
  });

  it("E11 whitelist: reserved synthetic domains pass, real ones do not", () => {
    expect(scanFixtureForPersonalData("f", "lin@example.com a@b.test")).toEqual([]);
    expect(scanFixtureForPersonalData("f", "lin@gmail.com").map(x => x.kind)).toEqual(["email"]);
    expect(scanFixtureForPersonalData("f", "tel 13912345678").map(x => x.kind)).toEqual(["phone"]);
  });

  it("CLI: `harness eval --entity S003` prints a summary and exits 0; broken suite exits 2", () => {
    const root = copySuite();
    const tsx = join(repoRoot, "apps/api/node_modules/.bin/tsx");
    const cli = join(repoRoot, ".harness/scripts/cli.ts");
    const ok = spawnSync(tsx, [cli, "eval", "--entity", "S003", "--evals-root", root], { cwd: repoRoot, encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("subject 10/10 pass");
    expect(readdirSync(join(root, "S003/reports"))).toHaveLength(1);

    writeFileSync(join(root, "S003/suite.json"), "{}");
    const bad = spawnSync(tsx, [cli, "eval", "--entity", "S003", "--evals-root", root], { cwd: repoRoot, encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("SUITE_INVALID suite.json");
  }, 60_000);
});
