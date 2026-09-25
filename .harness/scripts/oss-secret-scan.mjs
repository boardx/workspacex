#!/usr/bin/env node
/**
 * 开源就绪度检查 ②：git 历史凭据扫描。
 *
 * 为什么存在：公开一个仓库公开的是**全部历史**，不是当前 HEAD。
 * 删掉一个 key 再 commit，那个 key 仍然躺在历史里，任何人 clone 后都能翻出来。
 *
 * 本脚本是**兜底**，不是替代品。有条件时请用 gitleaks / trufflehog，
 * 它们的规则集比这里全得多。本脚本的价值是：无外部工具的环境里也能跑，
 * 且作为 CI 门控可以拦住最常见的几类明文凭据。
 *
 * ⚠ 浅 clone（shallow clone）里跑等于没跑——脚本会检测并明确告警。
 *
 * 用法：
 *   node .harness/scripts/oss-secret-scan.mjs              # 扫全部可见历史
 *   node .harness/scripts/oss-secret-scan.mjs --head-only  # 只扫工作树
 *   node .harness/scripts/oss-secret-scan.mjs --strict     # 有命中则退出码 1
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RULES = [
  { id: "aws-access-key",   re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token",     re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "openai-key",       re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { id: "anthropic-key",    re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/ },
  { id: "slack-token",      re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "google-api-key",   re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "private-key-block",re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "jwt",              re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { id: "aliyun-ak",        re: /\bLTAI[A-Za-z0-9]{12,}\b/ },
  // 赋值式明文口令/密钥：排掉占位符与从 env 读取的写法
  { id: "assigned-secret",  re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\n]{8,}["']/i,
    ignore: /process\.env|\$\{|<[^>]+>|xxx|example|placeholder|changeme|dummy|redacted|\*{4,}|test|fake|sample/i },
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });
}

const headOnly = process.argv.includes("--head-only");
let shallow = false;
try { shallow = git(["rev-parse", "--is-shallow-repository"]).trim() === "true"; } catch {}

let commitCount = 0;
try { commitCount = Number(git(["rev-list", "--all", "--count"]).trim()); } catch {}

// ⚠ 2026-09-24 更正：`--head-only` 初版有两个叠在一起的 bug，结果是**永远报 0 命中**：
//   ① 用了 require("node:fs")，本文件是 ES 模块，require 未定义，ReferenceError 被 catch 吞掉，
//      每个文件都读成空串；
//   ② 就算读得到，也是把全部文件拼成一个字符串——仓库里有 PNG / PPTX 等大文件，
//      会超出字符串长度上限直接崩。①把②盖住了，所以这条路径从来没有真正跑过。
// 现在逐个文件扫，跳过二进制（含 NUL 字节）与超过 2 MB 的文件，并报告跳过了多少。
const MAX_BYTES = 2 * 1024 * 1024;
let skippedFiles = 0;
const chunks = [];
if (headOnly) {
  for (const f of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
    let buf;
    try { buf = readFileSync(f); } catch { skippedFiles++; continue; }
    if (buf.length > MAX_BYTES || buf.includes(0)) { skippedFiles++; continue; }
    chunks.push(`commit (工作树:${f})`);
    for (const l of buf.toString("utf8").split("\n")) chunks.push(l);
  }
} else {
  // 不用展开运算符：几百万行展开成参数会超出调用参数上限
  for (const l of git(["log", "--all", "-p", "--no-color", "--no-textconv"]).split("\n")) chunks.push(l);
}

const hits = [];
const lines = chunks;
let currentCommit = "(工作树)";
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const cm = line.match(/^commit ([0-9a-f]{7,40}|\(工作树:[^)]*\))/);
  if (cm) { currentCommit = cm[1].startsWith("(") ? "(工作树)" : cm[1].slice(0, 12); continue; }
  for (const rule of RULES) {
    if (!rule.re.test(line)) continue;
    if (rule.ignore && rule.ignore.test(line)) continue;
    hits.push({ rule: rule.id, commit: currentCommit, sample: line.trim().slice(0, 120) });
  }
}

console.log(`可见 commit 数    ${commitCount}`);
console.log(`扫描范围          ${headOnly ? "仅工作树" : "全部可见历史"}`);
if (headOnly) console.log(`跳过的文件        ${skippedFiles}（二进制或超过 2 MB）`);
console.log(`命中              ${hits.length}`);
{
  // 按规则的原始命中数：明细按「规则@commit」去重，工作树模式下全部落在同一个标签上，看不出分布
  const byRule = new Map();
  for (const h of hits) byRule.set(h.rule, (byRule.get(h.rule) ?? 0) + 1);
  for (const [r, n] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(`  ${r.padEnd(18)}${n}`);
}

if (shallow || commitCount < 200) {
  console.log("\n⚠ 这是**浅 clone 或历史被截断**的仓库副本。");
  console.log("  历史扫描的结论只覆盖本地可见的部分，不能当作「历史是干净的」。");
  console.log("  开源前必须在完整 clone（git clone --no-single-branch，无 --depth）上重跑。");
}

if (hits.length) {
  console.log("\n命中明细（只打印规则与位置，不回显完整凭据）：");
  const seen = new Set();
  for (const h of hits) {
    const k = `${h.rule}@${h.commit}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  [${h.rule}] commit ${h.commit}`);
  }
  console.log("\n命中不等于泄露，但每一条都要人工确认，并假定该凭据已泄露、立即轮换。");
}

if (process.argv.includes("--strict")) {
  if (hits.length > 0) { console.error("\nstrict：存在疑似凭据，未通过。"); process.exit(1); }
  if (shallow || commitCount < 200) { console.error("\nstrict：历史不完整，无法给出通过结论。"); process.exit(1); }
}
