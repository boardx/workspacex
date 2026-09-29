/**
 * `pnpm harness eval --entity <ID> [--baseline] [--case E2[,E3]] [--version <digest>] [--evals-root <dir>]`（EV02）。
 * `pnpm harness eval --all-skills [--baseline] [--write-back] [--evals-root <dir>]`（EV05；回写需
 * `WORK_EVAL_API_URL` + `WORK_EVAL_API_TOKEN` = 平台运营凭据）。
 * .harness/scripts/cli.ts 的 `eval` 子命令转发到本脚本；实现见 src/infrastructure/work-eval/。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpBatchCatalog, runAllSkillsCommand } from "../src/infrastructure/work-eval/all-skills-eval";
import { EXIT, parseEvalArgs, runEvalCommand } from "../src/infrastructure/work-eval/fs-eval-suite";

const USAGE = "usage: harness eval --entity <S###|W###|D###> [--baseline] [--case <id,...>] [--version <digest>] [--evals-root <dir>]\n"
  + "       harness eval --all-skills [--baseline] [--write-back] [--evals-root <dir>]\n";
const args = parseEvalArgs(process.argv.slice(2));
if (args.unknown.length > 0) process.stderr.write(`SUITE_INVALID unknown argument(s): ${args.unknown.join(" ")}\n`);
const conflicting = args.allSkills && (args.entity !== undefined || args.cases.length > 0 || args.version !== undefined);
const writeBackWithoutBatch = args.writeBack && !args.allSkills;
if ((!args.entity && !args.allSkills) || args.unknown.length > 0 || conflicting || writeBackWithoutBatch) {
  process.stderr.write(USAGE);
  process.exit(EXIT.SUITE_INVALID);
}
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evalsRoot = args.evalsRoot ? resolve(args.evalsRoot) : undefined;
const apiUrl = process.env.WORK_EVAL_API_URL;
const apiToken = process.env.WORK_EVAL_API_TOKEN;

const run = args.allSkills
  ? runAllSkillsCommand({
    repoRoot, evalsRoot, baseline: args.baseline, writeBack: args.writeBack,
    ...(args.writeBack && apiUrl && apiToken ? { catalog: new HttpBatchCatalog({ baseUrl: apiUrl, headers: { authorization: `Bearer ${apiToken}` } }) } : {}),
  })
  : runEvalCommand({ repoRoot, entity: args.entity!, baseline: args.baseline, cases: args.cases, version: args.version, evalsRoot });
run
  .then(r => process.exit(r.exitCode))
  .catch(e => {
    process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(EXIT.CASE_FAILED_OR_ERROR);
  });
