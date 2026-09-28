/**
 * EV02：`--baseline` 并列「无该 Skill 的通用 Agent + 相同工具集」结果（04-eval-gates R3.4，E5）。
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decideG5, WorkEvalReport } from "@repo/contracts/work-eval";
import { runLoopbackEval } from "../../src/application/work-eval/eval-runner";
import { FixtureToolbox, mergeFixtures, ToolNotAllowedError } from "../../src/application/work-eval/fixture-tools";
import { genericAgentBaselineLoopback, type LoopbackAgent } from "../../src/application/work-eval/loopback-agents";
import { EXIT, runEvalCommand } from "../../src/infrastructure/work-eval/fs-eval-suite";

const repoRoot = resolve(__dirname, "../../../..");
const tmpRoots: string[] = [];
afterAll(() => tmpRoots.forEach(d => rmSync(d, { recursive: true, force: true })));
const quiet = { out: () => {}, err: () => {} };

function copySuite(): string {
  const root = mkdtempSync(join(tmpdir(), "ev02b-"));
  tmpRoots.push(root);
  cpSync(join(repoRoot, "evals/work-stack/S003"), join(root, "S003"), { recursive: true, filter: src => !src.includes("/reports") });
  return root;
}

describe("harness eval --baseline (EV02)", () => {
  it("report lists subject and baseline side by side over the same cases", async () => {
    const root = copySuite();
    const lines: string[] = [];
    const r = await runEvalCommand({ repoRoot, entity: "S003", evalsRoot: root, baseline: true, out: l => lines.push(l), err: () => {} });
    expect(r.exitCode).toBe(EXIT.OK); // 退出码只看 subject；baseline 输给 subject 是预期
    const report = WorkEvalReport.parse(JSON.parse(readFileSync(r.reportPath!, "utf8")));
    expect(report.baseline).not.toBeNull();
    expect(report.baseline!.results.map(c => c.caseId)).toEqual(report.subject.results.map(c => c.caseId));
    expect(report.baseline!.total).toBe(10);
    expect(report.subject.passed).toBeGreaterThan(report.baseline!.passed);
    // 通用 Agent 缺 Skill 规则：版本取代、通道不可用、注入标记都做不到
    const base = new Map(report.baseline!.results.map(c => [c.caseId, c.outcome]));
    expect(base.get("E1")).toBe("fail");
    expect(base.get("E2")).toBe("fail");
    expect(base.get("E6")).toBe("fail");
    expect(lines.join("\n")).toMatch(/baseline \d+\/10 pass/);
    expect(lines.join("\n")).toContain("baseline=fail");

    const must = new Set(["E2", "E3", "E6"]);
    const g5 = decideG5({
      priorGatesPassed: true,
      subjectPassed: report.subject.passed,
      baselinePassed: report.baseline!.passed,
      mustPassAllPassed: report.subject.results.filter(c => must.has(c.caseId)).every(c => c.outcome === "pass"),
    });
    expect(g5.outcome).toBe("pass");
  });

  it("baseline runs with suite.baseline.tools only (project tools are denied)", () => {
    const tools = new FixtureToolbox(mergeFixtures([{ documents: [] }]), ["wx_knowledge_search", "wx_knowledge_read"]);
    expect(() => tools.call("wx_project_list")).toThrow(ToolNotAllowedError);
    expect(tools.trace.toolCalls).toEqual([{ name: "wx_project_list", kind: "read" }]);
    tools.search("q", "organization-index");
    expect(tools.trace.toolCalls.at(-1)).toEqual({ name: "wx_knowledge_search", kind: "read" });
  });

  it("baseline-side errors are isolated per case and recorded as error", async () => {
    const suite = JSON.parse(readFileSync(join(repoRoot, "evals/work-stack/S003/suite.json"), "utf8"));
    const cases = readFileSync(join(repoRoot, "evals/work-stack/S003/cases.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
    const usesProjectTool: LoopbackAgent = {
      policyVersion: "t",
      async run(_i, t) {
        t.call("wx_project_list");
        return {};
      },
    };
    const report = await runLoopbackEval({
      suite: { ...suite, caseTimeoutMs: 60000, llmJudge: null },
      cases: cases.slice(0, 2),
      fixtures: new Map(readFixtures()),
      grader: { version: "g", grade: () => ({ outcome: "pass", reason: null }) },
      subject: genericAgentBaselineLoopback,
      baseline: usesProjectTool,
      subjectVersionDigest: `sha256:${"a".repeat(64)}`,
      subjectVersionLabel: "t",
      fixturesDigest: `sha256:${"b".repeat(64)}`,
      runId: "r1",
    });
    expect(report.subject.passed).toBe(2);
    expect(report.baseline!.results.map(r => r.outcome)).toEqual(["error", "error"]);
    expect(report.baseline!.passed).toBe(0);
  });

  it("E5: --baseline on a suite without baseline → exit 2, no report", async () => {
    const root = copySuite();
    const p = join(root, "S003/suite.json");
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), baseline: null }));
    const r = await runEvalCommand({ repoRoot, entity: "S003", evalsRoot: root, baseline: true, ...quiet });
    expect(r.exitCode).toBe(EXIT.SUITE_INVALID);
    expect(r.report).toBeNull();
  });
});

function readFixtures(): [string, unknown][] {
  const dir = join(repoRoot, "evals/work-stack/S003/fixtures");
  return ["api-migration-minutes.json", "index-unavailable.json"].map(f => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]);
}
