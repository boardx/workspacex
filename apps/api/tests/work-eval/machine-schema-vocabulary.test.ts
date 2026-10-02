import { afterAll, expect, it } from "vitest";
import { runWorkStackGates } from "../../src/infrastructure/work-eval/fs-work-stack-gates";
import { cleanupFixtures, goodRepo, quiet, s003Manifest, writeSkill } from "./gates-fixture";

afterAll(cleanupFixtures);
it.each([
  { type: "object", requried: ["result"] },
  { type: "object", properties: { result: { type: "string", format: "date-tmie" } } },
  { type: "object", properties: { result: { type: "string", format: "email" } } },
])("G2 refuses ignored constraints instead of reporting valid machine schema: %j", schema => {
  const root = goodRepo();
  writeSkill(root, { ...s003Manifest(), outputSchema: schema });
  expect(runWorkStackGates({ repoRoot: root, ...quiet }).judgements[0]!.gates.find(g => g.gate === "G2")).toMatchObject({ outcome: "fail", reasonCode: "SCHEMA_INVALID" });
});
