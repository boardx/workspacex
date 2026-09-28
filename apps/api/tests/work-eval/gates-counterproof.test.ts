/**
 * EV03 反证测试（04-eval-gates E10 / R12；契约束 work-eval V4）：每个坏 fixture 只坏一处，
 * 必须在对应门被判 fail 且整体退出非 0——判 pass 则本测试红。每条先证明合规基线是绿的。
 */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runWorkStackGates } from "../../src/infrastructure/work-eval/fs-work-stack-gates";
import { cleanupFixtures, editCases, evaluate, goodRepo, quiet, s003Manifest, SKILL_DIR, writeSkill } from "./gates-fixture";

afterAll(cleanupFixtures);

function gate(root: string, id: string) {
  const r = runWorkStackGates({ repoRoot: root, ...quiet });
  const g = r.judgements[0]!.gates.find(x => x.gate === id)!;
  return { exitCode: r.exitCode, ...g };
}

describe("lint-work-stack-gates counterproof (EV03, E10)", () => {
  it("baseline: the unbroken fixture is green (so every red below is caused by its single defect)", async () => {
    const root = goodRepo();
    await evaluate(root);
    expect(runWorkStackGates({ repoRoot: root, ...quiet }).exitCode).toBe(0);
  });

  it("missing license → G1 fail PROVENANCE_LICENSE_MISSING", async () => {
    const m = s003Manifest();
    delete (m.provenance as Record<string, unknown>[])[0]!.license;
    const root = goodRepo({ manifest: m });
    await evaluate(root);
    expect(gate(root, "G1")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "PROVENANCE_LICENSE_MISSING" });
    expect(gate(root, "G0").outcome).toBe("pass"); // 缺 license 是 G1 的事，不被 G0 吞掉
  });

  it("fair-code upstream used beyond reference-only → G1 fail LICENSE_DISALLOWED", async () => {
    const m = s003Manifest();
    Object.assign((m.provenance as Record<string, unknown>[])[0]!, { license: "Sustainable-Use-1.0", strategy: "adapt" });
    const root = goodRepo({ manifest: m });
    await evaluate(root);
    expect(gate(root, "G1")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "LICENSE_DISALLOWED" });
  });

  it("unregistered capability category → G3 fail CAPABILITY_UNREGISTERED", async () => {
    const m = s003Manifest();
    (m.dependencies as { optional: string[] }).optional.push("crm.teleport");
    const root = goodRepo({ manifest: m });
    await evaluate(root);
    expect(gate(root, "G3")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "CAPABILITY_UNREGISTERED" });
  });

  it("suite without a prompt-injection case → G3 fail INJECTION_OR_DENIAL_CASE_MISSING even if all other cases pass (E7)", async () => {
    const root = goodRepo();
    editCases(root, cases => cases.map(c => (c.id === "E6" ? { ...c, tags: ["functional"] } : c)));
    await evaluate(root);
    const g = gate(root, "G3");
    expect(g).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "INJECTION_OR_DENIAL_CASE_MISSING" });
    expect(g.reason).toContain("prompt-injection");
    expect(gate(root, "G4").outcome).toBe("pass");
  });

  it("stale report (Skill edited after eval) → G4 fail REPORT_STALE (E4)", async () => {
    const root = goodRepo();
    await evaluate(root);
    writeSkill(root, s003Manifest(), SKILL_DIR, "# Enterprise Search\n\nedited after the eval run\n");
    const g = gate(root, "G4");
    expect(g).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "REPORT_STALE" });
    expect(g.reason).toContain("stale");
  });

  it("no suite → G4 fail NO_SUITE, never not_applicable (E1)", () => {
    const root = goodRepo({ suite: false });
    const g = gate(root, "G4");
    expect(g).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "NO_SUITE" });
  });

  it("suite.json failing Zod → G4 fail NO_SUITE (E1)", async () => {
    const root = goodRepo();
    writeFileSync(join(root, "evals/work-stack/S003/suite.json"), JSON.stringify({ schemaVersion: 1, stableId: "S003" }));
    expect(gate(root, "G4")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "NO_SUITE" });
  });

  it("case input violating inputSchema or a missing fixture → G2 fail SCHEMA_INVALID (E2)", async () => {
    const root = goodRepo();
    editCases(root, cases => cases.map(c => (c.id === "E1" ? { ...c, input: { question: "x", mode: "guess" } } : c)));
    expect(gate(root, "G2")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "SCHEMA_INVALID" });
    const root2 = goodRepo();
    rmSync(join(root2, "evals/work-stack/S003/fixtures/travel-policy.json"));
    expect(gate(root2, "G2")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "SCHEMA_INVALID" });
    const m = s003Manifest();
    m.inputSchema = { type: "no-such-type" };
    const root3 = goodRepo({ manifest: m });
    expect(gate(root3, "G2")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "SCHEMA_INVALID" });
  });

  it("identity: duplicate stableId, unlisted id or unparseable manifest → G0 fail", async () => {
    const dup = goodRepo();
    writeSkill(dup, s003Manifest(), "skills/standard-context/enterprise-search-copy");
    expect(gate(dup, "G0")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "STABLE_ID_MISMATCH" });

    const unlisted = goodRepo();
    writeFileSync(join(unlisted, "requirements/work-stack-v2/WORK-STACK-320-LIST.md"), "| ✅ | S004 | Skill |\n");
    expect(gate(unlisted, "G0")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "STABLE_ID_MISMATCH" });

    const m = s003Manifest();
    delete m.riskClass;
    const broken = goodRepo({ manifest: m });
    expect(gate(broken, "G0")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "MANIFEST_UNPARSEABLE" });
  });

  it("subject = baseline (a tie) → G5 fail NOT_BETTER_THAN_BASELINE (E6/E10), even with G0–G4 green", async () => {
    const root = goodRepo();
    const p = await evaluate(root);
    expect(gate(root, "G5")).toMatchObject({ outcome: "pass" });
    const { readFileSync } = await import("node:fs");
    const report = JSON.parse(readFileSync(p, "utf8")) as { subject: { results: unknown[] }; baseline: { results: unknown[] } };
    report.baseline.results = structuredClone(report.subject.results);
    writeFileSync(p, JSON.stringify(report));
    const g = gate(root, "G5");
    expect(g).toMatchObject({ outcome: "fail", reasonCode: "NOT_BETTER_THAN_BASELINE" });
    expect(g.reason).toContain("tie");
    expect(g.exitCode).toBe(0); // G5 does not gate the exit code in this phase (EV05 changes channels)
  });

  it("injection/denial case failing in the latest report → G3 fail INJECTION_OR_DENIAL_CASE_FAILED", async () => {
    const root = goodRepo();
    const p = await evaluate(root);
    const { readFileSync } = await import("node:fs");
    const report = JSON.parse(readFileSync(p, "utf8")) as { subject: { results: { caseId: string; outcome: string }[] } };
    report.subject.results.find(c => c.caseId === "E3")!.outcome = "error";
    writeFileSync(p, JSON.stringify(report));
    expect(gate(root, "G3")).toMatchObject({ exitCode: 1, outcome: "fail", reasonCode: "INJECTION_OR_DENIAL_CASE_FAILED" });
  });
});
