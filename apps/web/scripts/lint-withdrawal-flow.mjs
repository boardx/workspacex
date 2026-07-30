#!/usr/bin/env node
/**
 * lint-withdrawal-flow.mjs — 撤回链单一事实源门控（2026-07-28）
 *
 * 为什么这条比一般的重复代码严重：
 * **撤回链是对受访者的合规承诺。** 同一件事在三个屏上说出三个不同的时限，
 * 就是三份互相矛盾的对外声明。事实上它已经漂移过一次——第 03 步在
 * `lib/mock/entry.ts` 是「≤5 分钟」、在 `lib/mock/files.ts` 是「即时」。
 *
 * 数值来源是已拍板的裁决（D-13 内容 / D-15 时限 / D-19 对外替换需人工），
 * 唯一事实源 `lib/withdrawal-flow.ts`。本脚本保证：
 *   ① 没有第二份五步定义（除单源外不得出现 `WITHDRAWAL_FLOW` 的数组字面量）；
 *   ② 没有硬写的撤回时限字面量（「5 分钟」「30 天」等必须来自 `WITHDRAWAL_SLA_SUMMARY`）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "lib", "withdrawal-flow.ts");
const src = readFileSync(SOURCE, "utf8");
if (!/export const WITHDRAWAL_FLOW: WithdrawalStepSpec\[\] = \[/.test(src)) {
  console.error("✗ lib/withdrawal-flow.ts 里找不到 WITHDRAWAL_FLOW 定义（单一事实源读取失败）");
  process.exit(1);
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "__fixtures__" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

// 撤回语境的判定词：只有同时出现「撤回/退出检索/物理删除」这类词，时限才受本规则管辖。
// 否则「延时 5 分钟」「批准卡现场 5 分钟超时」这类无关内容会被误伤。
const WITHDRAW_CONTEXT = /撤回|退出检索|物理删除|待删除队列|证据已撤回/;
const HARDCODED_SLA = /(≤?\s*\d+\s*分钟|≤?\s*\d+\s*天(?!数))/;

let fail = 0;
for (const file of [...walk(join(ROOT, "lib")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "app"))]) {
  if (file === SOURCE) continue;
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");

  // ① 第二份定义
  const body = lines.join("\n");
  if (/(const|let)\s+WITHDRAWAL_FLOW\s*[:=]/.test(body) && !/from "@\/lib\/withdrawal-flow"/.test(body)) {
    console.error(`✗ [副本] ${rel} 里出现第二份 WITHDRAWAL_FLOW 定义 —— 必须从 lib/withdrawal-flow.ts 取`);
    fail++;
  }

  // ② 撤回语境里的硬写时限
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(line)) return;          // 注释行
    if (/WITHDRAWAL_SLA_SUMMARY|withdrawal-flow/.test(line)) return; // 来自单源
    if (!WITHDRAW_CONTEXT.test(line)) return;
    const m = HARDCODED_SLA.exec(line);
    if (m) {
      console.error(`✗ [硬写时限] ${rel}:${i + 1} 撤回语境里出现「${m[1].trim()}」—— 请用 WITHDRAWAL_SLA_SUMMARY`);
      fail++;
    }
  });
}

console.log(
  fail === 0
    ? "✅ lint-withdrawal-flow：撤回链单源，无副本、无硬写时限"
    : `\n❌ ${fail} 处违规。撤回链是**对外合规承诺**，改它必须有对应裁决（现为 D-13 / D-15 / D-19）。`,
);
process.exit(fail === 0 ? 0 : 1);
