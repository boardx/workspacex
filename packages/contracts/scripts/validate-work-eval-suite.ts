/**
 * 校验一个 Work Stack 评测套件目录（EV01，R3.1–3.2 / E1）。
 *   tsx packages/contracts/scripts/validate-work-eval-suite.ts <evals/work-stack/<ID>> [--manifest-eval-suite-id <ID>]
 * 合法 → 退出 0；不合法 → 逐条打印 `<文件> <字段路径>: <原因>`，退出 2（WorkEvalCliExit.SUITE_INVALID）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { validateWorkEvalSuiteBundle } from "../src/work-eval";

const SUITE_INVALID_EXIT = 2;

function listFiles(root: string, dir = root): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(root, full) : [relative(root, full).split("\\").join("/")];
  });
}

const args = process.argv.slice(2);
const dirArg = args.find(a => !a.startsWith("--"));
const mIdx = args.indexOf("--manifest-eval-suite-id");
const manifestEvalSuiteId = mIdx >= 0 ? args[mIdx + 1] ?? null : null;
if (!dirArg) {
  console.error("usage: validate-work-eval-suite <suite-dir> [--manifest-eval-suite-id <ID>]");
  process.exit(SUITE_INVALID_EXIT);
}
const dir = resolve(dirArg);
const suitePath = join(dir, "suite.json");
if (!existsSync(suitePath)) {
  console.error(`${suitePath} (file): suite.json not found`);
  process.exit(SUITE_INVALID_EXIT);
}
let suiteJson: unknown;
try {
  suiteJson = JSON.parse(readFileSync(suitePath, "utf8"));
} catch (e) {
  console.error(`${suitePath} (root): invalid JSON: ${(e as Error).message}`);
  process.exit(SUITE_INVALID_EXIT);
}
const casesPath = join(dir, "cases.jsonl");
const result = validateWorkEvalSuiteBundle({
  dirName: basename(dir),
  suiteJson,
  casesJsonl: existsSync(casesPath) ? readFileSync(casesPath, "utf8") : "",
  fixtureFiles: listFiles(join(dir, "fixtures")),
  hasGrader: existsSync(join(dir, "grader.ts")),
  hasCalibrationDir: existsSync(join(dir, "calibration")),
  manifestEvalSuiteId,
});
if (!result.ok) {
  for (const i of result.issues) console.error(`${join(dir, i.file)} ${i.path}: ${i.message}`);
  process.exit(SUITE_INVALID_EXIT);
}
console.log(`OK ${result.suite.stableId}: ${result.cases.length} cases`);
