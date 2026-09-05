/**
 * scrub-file.ts —— 把一份日志脱敏后写进证据包的小 CLI。
 *
 * 用法：`tsx apps/web/e2e/support/scrub-file.ts <输入文件> <输出文件> [尾部行数]`
 *
 * 存在的理由是**唯一事实源**：脱敏规则只在 `real-model-evidence.ts` 的
 * `scrubSecrets` 里声明一次。后端日志（`/tmp/e2e-api.log`、devapp 的 journalctl）
 * 同样要进证据包，如果在 shell 里另写一套 `sed` 规则，就成了同一件事的第二份声明
 * ——本仓已经五次因此漂移（AGENTS.md 那条警告）。这个文件是那份规则的薄壳，不是新规则。
 *
 * 输入读不到时**不静默产出空文件**：写一行显式说明，让证据包里"这份日志没取到"
 * 与"这份日志是空的"能被区分开。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { scrubSecrets } from "./real-model-evidence";

const [, , inputPath, outputPath, tailArg] = process.argv;
if (inputPath === undefined || outputPath === undefined) {
  console.error("usage: tsx scrub-file.ts <input> <output> [tailLines]");
  process.exit(2);
}

let body: string;
try {
  body = readFileSync(inputPath, "utf8");
} catch (error) {
  body = `<未能读取 ${inputPath}：${String(error)}>\n`;
}

const tailLines = tailArg === undefined ? null : Number.parseInt(tailArg, 10);
if (tailLines !== null && Number.isFinite(tailLines) && tailLines > 0) {
  const lines = body.split("\n");
  body = lines.slice(Math.max(0, lines.length - tailLines)).join("\n");
}

writeFileSync(outputPath, scrubSecrets(body), "utf8");
console.log(`[scrub-file] ${inputPath} → ${outputPath}（${body.length} 字符，已脱敏）`);
