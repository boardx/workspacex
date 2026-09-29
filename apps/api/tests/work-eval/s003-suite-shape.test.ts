/**
 * EV01：S003 首个评测套件的形状（evals/work-stack/S003/）。
 * 校验逻辑单源在 @repo/contracts/work-eval（validateWorkEvalSuiteBundle），CLI 在
 * packages/contracts/scripts/validate-work-eval-suite.ts；本文件只断言仓内真实套件与 CLI 退出语义。
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { suiteCoverageGaps, validateWorkEvalSuiteBundle } from "@repo/contracts/work-eval";

const repoRoot = resolve(__dirname, "../../../..");
const suiteDir = join(repoRoot, "evals/work-stack/S003");
const cli = join(repoRoot, "packages/contracts/scripts/validate-work-eval-suite.ts");
const tmpRoots: string[] = [];
afterAll(() => tmpRoots.forEach(d => rmSync(d, { recursive: true, force: true })));

function load(manifestEvalSuiteId: string | null = "S003") {
  return validateWorkEvalSuiteBundle({
    dirName: "S003",
    suiteJson: JSON.parse(readFileSync(join(suiteDir, "suite.json"), "utf8")),
    casesJsonl: readFileSync(join(suiteDir, "cases.jsonl"), "utf8"),
    fixtureFiles: readdirSync(join(suiteDir, "fixtures")),
    hasGrader: existsSync(join(suiteDir, "grader.ts")),
    hasCalibrationDir: existsSync(join(suiteDir, "calibration")),
    manifestEvalSuiteId,
  });
}

function runCli(dir: string, extra: string[] = []) {
  // 直接调 tsx（pnpm exec 会把非 0 退出码归一成 1，吞掉 SUITE_INVALID=2 的语义）。
  return spawnSync(join(repoRoot, "packages/contracts/node_modules/.bin/tsx"), [cli, dir, ...extra], { cwd: repoRoot, encoding: "utf8" });
}

describe("evals/work-stack/S003 suite (EV01)", () => {
  it("validates against WorkEvalSuite/WorkEvalCase with stableId = dir = manifest.evalSuiteId", () => {
    const r = load();
    if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
    expect(r.suite.stableId).toBe("S003");
    expect(r.suite.entityKind).toBe("skill");
    expect(r.suite.baseline?.tools).toEqual(["wx_knowledge_search", "wx_knowledge_read"]);
    expect(r.suite.mustPassCaseIds).toEqual(["E2", "E3", "E6"]);
    expect(load("S004").ok).toBe(false);
  });

  it("contains E1–E10 with at least one permission-denial and one prompt-injection case", () => {
    const r = load();
    if (!r.ok) throw new Error("suite invalid");
    expect(r.cases.map(c => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => `E${i + 1}`));
    expect(suiteCoverageGaps(r.cases)).toEqual([]);
    expect(r.cases.find(c => c.id === "E3")?.tags).toContain("permission-denial");
    expect(r.cases.find(c => c.id === "E6")?.tags).toContain("prompt-injection");
  });

  it("fixtures are synthetic (no email/phone-like personal data)", () => {
    for (const f of readdirSync(join(suiteDir, "fixtures"))) {
      const text = readFileSync(join(suiteDir, "fixtures", f), "utf8");
      expect(text, f).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text, f).not.toMatch(/1[3-9]\d{9}/);
    }
  });

  it("grader.ts understands every assertion kind used by the cases", async () => {
    const r = load();
    if (!r.ok) throw new Error("suite invalid");
    const grader = (await import(pathToFileURL(join(suiteDir, "grader.ts")).href)) as { ASSERTION_KINDS: string[]; GRADER_VERSION: string };
    expect(grader.GRADER_VERSION).toBe(r.suite.graderVersion);
    const used = new Set(r.cases.flatMap(c => c.expect.assertions.map(a => a.kind)));
    for (const k of used) expect(grader.ASSERTION_KINDS, k).toContain(k);
  });

  it("CLI exits 0 on the real suite and non-zero with the field path when suite.json misses a field", () => {
    const ok = runCli(suiteDir, ["--manifest-eval-suite-id", "S003"]);
    expect(ok.status, ok.stderr).toBe(0);

    const tmp = mkdtempSync(join(tmpdir(), "ev01-"));
    tmpRoots.push(tmp);
    const broken = join(tmp, "S003");
    cpSync(suiteDir, broken, { recursive: true });
    const suite = JSON.parse(readFileSync(join(broken, "suite.json"), "utf8"));
    delete suite.graderVersion;
    delete suite.baseline.tools;
    writeFileSync(join(broken, "suite.json"), JSON.stringify(suite));
    const bad = runCli(broken);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("suite.json graderVersion");
    expect(bad.stderr).toContain("suite.json baseline.tools");

    const mismatch = runCli(suiteDir, ["--manifest-eval-suite-id", "S009"]);
    expect(mismatch.status).toBe(2);
    expect(mismatch.stderr).toContain("suite.json stableId");
  }, 60_000);
});
