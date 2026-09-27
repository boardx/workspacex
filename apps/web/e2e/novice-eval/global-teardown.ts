import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { report, score, type Check } from "./score.mjs";

/** 全部旅程跑完后读逐条落盘的检查记录，算分、写 `report.md`、打到终端。 */
export default function globalTeardown(): void {
  const out = process.env.NOVICE_OUT ?? join(process.cwd(), "test-results", "novice-eval");
  const file = join(out, "checks.jsonl");
  const checks: Check[] = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Check) : [];
  const result = score(checks);
  const md = report(result);
  writeFileSync(join(out, "report.md"), md);
  writeFileSync(join(out, "score.json"), JSON.stringify({ score: result.score, checks }, null, 2));
  console.log(`\n${md}\n`);
}
