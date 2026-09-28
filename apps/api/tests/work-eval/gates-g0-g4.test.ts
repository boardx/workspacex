/**
 * EV03：`lint-work-stack-gates` G0–G4 判定（04-eval-gates R3.5–3.6；契约束 work-eval UC-3 / V3）。
 * 合规实体逐门 pass 并产出合法 WorkGateStatus；反证见 gates-counterproof.test.ts。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { WorkEvalReport, WorkGateStatus } from "@repo/contracts/work-eval";
import { judgeWorkStackGates } from "../../src/application/work-eval/work-stack-gates";
import { collectGateSubjects, parseGateArgs, runWorkStackGates } from "../../src/infrastructure/work-eval/fs-work-stack-gates";
import { cleanupFixtures, evaluate, goodRepo, quiet, repoRoot, s003Manifest, writeSkill } from "./gates-fixture";

afterAll(cleanupFixtures);
const byGate = (gates: { gate: string; outcome: string; reasonCode: string; reason: string }[]) => Object.fromEntries(gates.map(g => [g.gate, g])) as Record<string, { outcome: string; reasonCode: string; reason: string }>;

describe("lint-work-stack-gates G0–G4 (EV03)", () => {
  it("a compliant S003 package passes G0–G4 (and G5), exits 0 and yields a valid WorkGateStatus", async () => {
    const root = goodRepo();
    const reportPath = await evaluate(root);
    const lines: string[] = [];
    const r = runWorkStackGates({ repoRoot: root, entity: "S003", out: l => lines.push(l), err: () => {} });
    expect(r.exitCode).toBe(0);
    const g = byGate(r.judgements[0]!.gates);
    for (const id of ["G0", "G1", "G2", "G3", "G4"]) expect(g[id], id).toMatchObject({ outcome: "pass", reasonCode: "OK" });
    expect(g.G5).toMatchObject({ outcome: "pass", reasonCode: "OK" });
    expect(lines.join("\n")).toMatch(/G0 pass/);
    expect(lines.join("\n")).toMatch(/G4 pass .*10\/10 deterministic/);

    const status = WorkGateStatus.parse(r.statuses[0]);
    const report = WorkEvalReport.parse(JSON.parse(readFileSync(reportPath, "utf8")));
    expect(status.stableId).toBe("S003");
    expect(status.subjectVersionDigest).toBe(report.subjectVersionDigest);
    expect(status.evidenceReportPath).toBe(relative(root, reportPath));
    expect(status.gates.map(x => x.gate)).toEqual(["G0", "G1", "G2", "G3", "G4", "G5"]);
    expect(status.subjectPassed).toBe(10);
    expect(status.baselinePassed).toBe(report.baseline!.passed);
    expect(status.scriptVersion).toMatch(/^lint-work-stack-gates-/);
  });

  it("--json prints the WorkGateStatus list", async () => {
    const root = goodRepo();
    await evaluate(root);
    const lines: string[] = [];
    runWorkStackGates({ repoRoot: root, json: true, out: l => lines.push(l), err: () => {} });
    const parsed = JSON.parse(lines.join("\n")) as { statuses: unknown[] };
    expect(parsed.statuses).toHaveLength(1);
    expect(WorkGateStatus.safeParse(parsed.statuses[0]).success).toBe(true);
  });

  it("only entities whose SKILL.md declares metadata.work are judged; --entity of an unknown id exits non-0", async () => {
    const root = goodRepo();
    writeSkill(root, undefined, "skills/other/plain"); // 普通 skill：无 metadata.work
    writeFileSync(join(root, "skills/other/plain/SKILL.md"), "---\nname: plain\n---\n");
    expect(collectGateSubjects(root).map(s => s.stableId)).toEqual(["S003"]);
    expect(runWorkStackGates({ repoRoot: root, entity: "S999", ...quiet }).exitCode).not.toBe(0);
  });

  it("a partial (--case) report is not G4 evidence (A2)", async () => {
    const root = goodRepo();
    await evaluate(root, { cases: ["E1"] });
    const g = byGate(runWorkStackGates({ repoRoot: root, ...quiet }).judgements[0]!.gates);
    expect(g.G4).toMatchObject({ outcome: "fail", reasonCode: "REPORT_STALE" });
  });

  it("a failing deterministic case fails G4 with CASE_FAILED", async () => {
    const root = goodRepo();
    const p = await evaluate(root);
    const report = JSON.parse(readFileSync(p, "utf8")) as { subject: { results: { caseId: string; outcome: string }[] } };
    report.subject.results.find(c => c.caseId === "E4")!.outcome = "fail";
    writeFileSync(p, JSON.stringify(report));
    const r = runWorkStackGates({ repoRoot: root, ...quiet });
    expect(r.exitCode).toBe(1);
    expect(byGate(r.judgements[0]!.gates).G4).toMatchObject({ outcome: "fail", reasonCode: "CASE_FAILED" });
  });

  it("workflow/agent entities get G1/G3/G5 = not_applicable (A1) while G0/G2/G4 are still judged", async () => {
    const root = goodRepo();
    const [subject] = collectGateSubjects(root);
    const j = judgeWorkStackGates({ ...subject!, kind: "workflow" });
    const g = byGate(j.gates);
    expect([g.G1!.outcome, g.G3!.outcome, g.G5!.outcome]).toEqual(["not_applicable", "not_applicable", "not_applicable"]);
    expect(g.G1!.reasonCode).toBe("NOT_REQUIRED_FOR_KIND");
    expect(g.G0!.outcome).toBe("pass");
    expect(g.G4).toMatchObject({ outcome: "fail", reasonCode: "REPORT_STALE" }); // 无报告 ≠ 通过
  });

  it("the .mjs entry runs against the repo and passes through the exit code; bad args are rejected", () => {
    const ok = spawnSync("node", [join(repoRoot, ".harness/scripts/lint-work-stack-gates.mjs")], { encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("work-stack gates");
    const bad = spawnSync("node", [join(repoRoot, ".harness/scripts/lint-work-stack-gates.mjs"), "--write-back"], { encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(parseGateArgs(["--entity", "S003", "--json"])).toEqual({ entity: "S003", json: true, unknown: [] });
  });

  it("manifest shape is the WorkSkillManifest contract (sanity for the fixture)", () => {
    expect(s003Manifest().evalSuiteId).toBe("S003");
  });
});
