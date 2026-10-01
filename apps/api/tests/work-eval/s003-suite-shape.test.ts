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

import { parse as parseYaml } from "yaml";
import Ajv from "ajv";
import { S003InputSchema, S003OutputSchema, s003MachineSchemas } from "../../src/application/work-eval/s003-contract";
import { S003InputSchema as ContractInputSchema, S003OutputSchema as ContractOutputSchema } from "@repo/contracts/work-skill-evidence-ledger";
import { s003EnterpriseSearchLoopback } from "../../src/application/work-eval/loopback-agents";
import { FixtureToolbox, mergeFixtures } from "../../src/application/work-eval/fixture-tools";

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
  it("API and loopback consume the authoritative contract by reference", () => {
    expect(S003InputSchema).toBe(ContractInputSchema);
    expect(S003OutputSchema).toBe(ContractOutputSchema);
    expect(s003EnterpriseSearchLoopback.inputSchema).toBe(ContractInputSchema);
    expect(s003EnterpriseSearchLoopback.outputSchema).toBe(ContractOutputSchema);
  });
  it("ships the generated machine contract and rejects each previous non-contract enum", async () => {
    const source = readFileSync(join(repoRoot, "skills/work-research/enterprise-search/SKILL.md"), "utf8");
    const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(source)![1]!);
    expect(frontmatter.metadata.work.inputSchema).toEqual(s003MachineSchemas.inputSchema);
    expect(frontmatter.metadata.work.outputSchema).toEqual(s003MachineSchemas.outputSchema);
    const ajv = new Ajv({ strict: false });
    ajv.addFormat("date-time", { validate: (value: string) => !Number.isNaN(Date.parse(value)) });
    const validateOutput = ajv.compile(s003MachineSchemas.outputSchema);
    const bundle = load();
    if (!bundle.ok) throw new Error("suite invalid");
    for (const c of bundle.cases) {
      const fixtures = c.fixtureRefs.map(f => JSON.parse(readFileSync(join(suiteDir, "fixtures", f), "utf8")));
      const ledger = await s003EnterpriseSearchLoopback.run(c.input as never, new FixtureToolbox(mergeFixtures(fixtures), bundle.suite.toolsUnderTest));
      expect(S003OutputSchema.safeParse(ledger).success, c.id).toBe(true);
      expect(validateOutput(ledger), c.id).toBe(true);
      const badQuery = { ...ledger, queryType: "fact" };
      expect(S003OutputSchema.safeParse(badQuery).success).toBe(false);
      const missing = { ...ledger };
      delete missing.scopeDeclared;
      expect(S003OutputSchema.safeParse(missing).success).toBe(false);
      const noOwner = S003OutputSchema.parse(ledger);
      if (noOwner.items[0]?.hits[0]) {
        noOwner.queryType = "who-knows";
        delete noOwner.items[0].hits[0].owner;
        expect(S003OutputSchema.safeParse(noOwner).success).toBe(false);
        expect(validateOutput(noOwner)).toBe(false);
      }
      const typed = S003OutputSchema.parse(ledger);
      if (typed.items[0]?.hits[0]) {
        typed.items[0].hits[0].relation = "draft-not-effective" as never;
        expect(S003OutputSchema.safeParse(typed).success).toBe(false);
      }
      typed.coverageGaps.push({ itemId: "I1", reason: "scope-not-configured" as never, suggestion: "configure" });
      expect(S003OutputSchema.safeParse(typed).success).toBe(false);
    }
  });

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
