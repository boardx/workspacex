/**
 * `pnpm run lint:work-stack-gates [--entity <ID>] [--json]`（EV03）。
 * `.harness/scripts/lint-work-stack-gates.mjs` 转发到本脚本；实现见 src/infrastructure/work-eval/fs-work-stack-gates.ts。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGateArgs, runWorkStackGates } from "../src/infrastructure/work-eval/fs-work-stack-gates";

const args = parseGateArgs(process.argv.slice(2));
if (args.unknown.length > 0) {
  process.stderr.write(`unknown argument(s): ${args.unknown.join(" ")}\nusage: lint:work-stack-gates [--entity <S###>] [--json]\n`);
  process.exit(2);
}
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
process.exit(runWorkStackGates({ repoRoot, entity: args.entity, json: args.json }).exitCode);
