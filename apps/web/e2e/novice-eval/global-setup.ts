import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** 开跑前清空上一次的检查记录——否则两次运行的记录叠在一起算分。 */
export default function globalSetup(): void {
  const out = process.env.NOVICE_OUT ?? join(process.cwd(), "test-results", "novice-eval");
  mkdirSync(out, { recursive: true });
  rmSync(join(out, "checks.jsonl"), { force: true });
}
