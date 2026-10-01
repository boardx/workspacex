/** Execute the same strict compiler as G2 for the full authoritative 200-Skill denominator. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorkSkillPackages } from "../src/infrastructure/work-eval/fs-work-stack-gates";
import { newWorkSkillSchemaValidator } from "../src/application/work-eval/machine-schema-validator";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const ids = [...new Set([...readFileSync(resolve(root, "requirements/work-stack-v2/WORK-STACK-320-LIST.md"), "utf8").matchAll(/\|\s*(S\d{3})\s*\|/g)].map(match => match[1]!))].sort();
if (ids.length !== 200) throw new Error(`authoritative Skill denominator drift: ${ids.length}`);
const packages = discoverWorkSkillPackages(root).filter(pkg => pkg.kind === "skill");
const rows = ids.map(stableId => {
  const sources = packages.filter(pkg => pkg.stableId === stableId).map(pkg => {
    const issues: string[] = [];
    const manifest = pkg.manifest as Record<string, unknown> | undefined;
    const validators = new Map<string, ReturnType<ReturnType<typeof newWorkSkillSchemaValidator>["compile"]>>();
    for (const field of ["inputSchema", "outputSchema"] as const) {
      try {
        const schema = manifest?.[field];
        if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("missing machine schema object");
        validators.set(field, newWorkSkillSchemaValidator().compile(schema as Record<string, unknown>));
      } catch (error) { issues.push(`${field}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const casesFile = resolve(root, `evals/work-stack/${stableId}/cases.jsonl`);
    const sampleIssues: string[] = []; let cases = 0; let inputsValid = 0; let outputsPresent = 0; let outputsValid = 0;
    if (existsSync(casesFile)) for (const line of readFileSync(casesFile, "utf8").split("\n").filter(line => line.trim())) {
      try {
        const sample = JSON.parse(line) as { id?: string; input?: unknown; expect?: { outputSample?: unknown } };
        cases++;
        const input = validators.get("inputSchema"), output = validators.get("outputSchema");
        if (input?.(sample.input)) inputsValid++;
        else sampleIssues.push(`case ${sample.id}: input ${input ? JSON.stringify(input.errors) : "schema unavailable"}`);
        if (sample.expect?.outputSample !== undefined) {
          outputsPresent++;
          if (output?.(sample.expect.outputSample)) outputsValid++;
          else sampleIssues.push(`case ${sample.id}: output ${output ? JSON.stringify(output.errors) : "schema unavailable"}`);
        }
      } catch (error) { sampleIssues.push(`case JSON invalid: ${String(error)}`); }
    }
    return { source: relative(root, pkg.skillMd), state: issues.length ? "INVALID_MACHINE_SCHEMA" : "COMPILES", issues,
      samples: { cases, inputsValid, outputsPresent, outputsValid, missingOutputSamples: cases - outputsPresent, issues: sampleIssues } };

  });
  return { stableId, state: sources.length === 0 ? "MISSING_RUNTIME_PACKAGE" : sources.every(source => source.state === "COMPILES") ? "COMPILES" : "INVALID_MACHINE_SCHEMA", suitePresent: existsSync(resolve(root, `evals/work-stack/${stableId}/suite.json`)), sources };
});
const samples = rows.flatMap(row => row.sources[0]?.samples.cases ? [row.sources[0].samples] : []);
const uniqueSuiteSamples = {
  cases: samples.reduce((n, sample) => n + sample.cases, 0),
  inputsValid: samples.reduce((n, sample) => n + sample.inputsValid, 0),
  outputsPresent: samples.reduce((n, sample) => n + sample.outputsPresent, 0),
  outputsValid: samples.reduce((n, sample) => n + sample.outputsValid, 0),
  missingOutputSamples: samples.reduce((n, sample) => n + sample.missingOutputSamples, 0),
};
const report = { uniqueSuiteSamples, denominator: ids.length, runtimeUnique: rows.filter(row => row.sources.length).length, runtimeFiles: packages.length, suitePresent: rows.filter(row => row.suitePresent).length, schemaCompiles: rows.filter(row => row.state === "COMPILES").length, quality: "BLOCKED: compilation is not subject execution or model quality evidence", rows };
const json = JSON.stringify(report, null, 2) + "\n";
const output = process.argv[process.argv.indexOf("--output") + 1];
if (process.argv.includes("--output")) { if (!output) throw new Error("--output requires a path"); writeFileSync(output, json); }
else process.stdout.write(json);
process.exitCode = rows.some(row => row.state !== "COMPILES") ? 1 : 0;
