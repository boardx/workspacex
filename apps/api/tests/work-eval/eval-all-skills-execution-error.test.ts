import { afterEach, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { FsBatchEntityEvaluator, runAllSkillsCommand } from "../../src/infrastructure/work-eval/all-skills-eval";
import { cleanupFixtures, goodRepo, quiet } from "./gates-fixture";
afterEach(cleanupFixtures);
it("a failed current execution cannot reuse prior gate counts or hide its missing report", async () => {
  const root = goodRepo();
  const evaluator = new FsBatchEntityEvaluator({ repoRoot: root });
  expect((await evaluator.evaluate("S003", { baseline: true })).reportPath).not.toBeNull();
  rmSync(join(root, "evals/work-stack/S003/cases.jsonl"));
  const current = await evaluator.evaluate("S003", { baseline: true });
  expect(current.reportPath).toBeNull();
  expect(current.status).toBeNull();
  expect(current.error).toContain("evaluation did not produce a report");
  const batch = await runAllSkillsCommand({ repoRoot: root, baseline: true, writeBack: false, ...quiet });
  expect(batch.exitCode).not.toBe(0);
  expect(batch.summary?.totals).toMatchObject({ skills: 1, g5Pass: 0, errors: 1 });
});
