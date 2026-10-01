import { describe, expect, it } from "vitest";
import { suiteCoverageGaps, validateWorkEvalSuiteBundle, WorkEvalCase, WorkEvalSuite } from "../../src/work-eval";

const suite = {
  schemaVersion: 1,
  stableId: "S003",
  entityKind: "skill",
  targetVersionRange: ">=1.0.0 <2.0.0",
  toolsUnderTest: ["wx_knowledge_search", "wx_knowledge_read"],
  baseline: { kind: "generic-agent-same-tools", tools: ["wx_knowledge_search", "wx_knowledge_read"] },
  mustPassCaseIds: ["E1"],
  graderVersion: "1.0.0",
};
const caseLine = (id: string, tags: string[] = ["functional"], fixtureRefs: string[] = ["org.json"]) =>
  JSON.stringify({ id, title: `case ${id}`, tags, fixtureRefs, input: { question: "q", mode: "evidence" }, expect: { assertions: [{ kind: "status", spec: "answered" }] } });
const base = { dirName: "S003", suiteJson: suite, casesJsonl: `${caseLine("E1")}\n${caseLine("E2", ["permission-denial"])}\n`, fixtureFiles: ["org.json"], hasGrader: true };

describe("WorkEvalSuite / WorkEvalCase (EV01)", () => {
  it("accepts a well-formed bundle and applies defaults", () => {
    const r = validateWorkEvalSuiteBundle({ ...base, manifestEvalSuiteId: "S003" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.suite.caseTimeoutMs).toBe(60_000);
      expect(r.suite.llmJudge).toBeNull();
      expect(r.cases.map(c => c.id)).toEqual(["E1", "E2"]);
      expect(r.cases[0]?.deterministic).toBe(true);
    }
  });

  it("reports the field path when suite.json misses a field", () => {
    const { graderVersion: _g, ...missing } = suite;
    const r = validateWorkEvalSuiteBundle({ ...base, suiteJson: missing });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContainEqual(expect.objectContaining({ file: "suite.json", path: "graderVersion" }));
    const nested = validateWorkEvalSuiteBundle({ ...base, suiteJson: { ...suite, baseline: { kind: "generic-agent-same-tools" } } });
    expect(!nested.ok && nested.issues.some(i => i.path === "baseline.tools")).toBe(true);
  });

  it("rejects unknown suite fields (strict)", () => {
    expect(WorkEvalSuite.safeParse({ ...suite, extra: 1 }).success).toBe(false);
  });

  it("requires stableId = directory name = manifest.evalSuiteId", () => {
    const dir = validateWorkEvalSuiteBundle({ ...base, dirName: "S004" });
    expect(!dir.ok && dir.issues.some(i => i.path === "stableId" && /directory/.test(i.message))).toBe(true);
    const man = validateWorkEvalSuiteBundle({ ...base, manifestEvalSuiteId: "S009" });
    expect(!man.ok && man.issues.some(i => i.path === "stableId" && /manifest/.test(i.message))).toBe(true);
  });

  it("reports case line paths, duplicate ids, missing fixtures and unknown must-pass ids", () => {
    const r = validateWorkEvalSuiteBundle({
      ...base,
      suiteJson: { ...suite, mustPassCaseIds: ["E9"] },
      casesJsonl: [caseLine("E1"), caseLine("E1"), caseLine("E3", ["functional"], ["missing.json"]), "{not json", JSON.stringify({ id: "E5" })].join("\n"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.issues.map(i => i.path);
    expect(paths).toContain("cases.jsonl:2.id");
    expect(paths).toContain("cases.jsonl:3.fixtureRefs.0");
    expect(paths).toContain("cases.jsonl:4");
    expect(paths).toContain("cases.jsonl:5.title");
    expect(paths).toContain("mustPassCaseIds.0");
  });

  it("requires grader.ts and calibration for llmJudge", () => {
    const g = validateWorkEvalSuiteBundle({ ...base, hasGrader: false });
    expect(!g.ok && g.issues.some(i => i.file === "grader.ts")).toBe(true);
    const j = validateWorkEvalSuiteBundle({ ...base, suiteJson: { ...suite, llmJudge: { calibrationDir: "calibration", minAgreement: 0.8 } } });
    expect(!j.ok && j.issues.some(i => i.path === "llmJudge.calibrationDir")).toBe(true);
    expect(validateWorkEvalSuiteBundle({ ...base, hasCalibrationDir: true, suiteJson: { ...suite, llmJudge: { calibrationDir: "calibration", minAgreement: 0.8 } } }).ok).toBe(true);
  });

  it("rejects absolute or parent fixture paths and flags coverage gaps", () => {
    expect(WorkEvalCase.safeParse({ ...JSON.parse(caseLine("E1")), fixtureRefs: ["../x.json"] }).success).toBe(false);
    const cases = [WorkEvalCase.parse(JSON.parse(caseLine("E1")))];
    expect(suiteCoverageGaps(cases)).toEqual(["permission-denial", "prompt-injection"]);
  });
});
