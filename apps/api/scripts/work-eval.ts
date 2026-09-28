/**
 * `pnpm harness eval --entity <ID> [--baseline] [--case E2[,E3]] [--version <digest>] [--evals-root <dir>]`（EV02）。
 * .harness/scripts/cli.ts 的 `eval` 子命令转发到本脚本；实现见 src/infrastructure/work-eval/fs-eval-suite.ts。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, parseEvalArgs, runEvalCommand } from "../src/infrastructure/work-eval/fs-eval-suite";

const args = parseEvalArgs(process.argv.slice(2));
if (args.unknown.length > 0) process.stderr.write(`SUITE_INVALID unknown argument(s): ${args.unknown.join(" ")}\n`);
if (!args.entity || args.unknown.length > 0) {
  process.stderr.write("usage: harness eval --entity <S###|W###|D###> [--baseline] [--case <id,...>] [--version <digest>] [--evals-root <dir>]\n");
  process.exit(EXIT.SUITE_INVALID);
}
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
runEvalCommand({ repoRoot, entity: args.entity, baseline: args.baseline, cases: args.cases, version: args.version, evalsRoot: args.evalsRoot ? resolve(args.evalsRoot) : undefined })
  .then(r => process.exit(r.exitCode))
  .catch(e => {
    process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(EXIT.CASE_FAILED_OR_ERROR);
  });
