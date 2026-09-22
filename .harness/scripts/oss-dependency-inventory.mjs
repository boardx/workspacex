#!/usr/bin/env node
/**
 * 开源就绪度检查 ①：第三方依赖清单与许可证盘点。
 *
 * 为什么存在：仓库要开源，就必须先知道自己在再分发什么。本仓此前
 * **没有任何 package.json 带 `license` 字段，也没有依赖许可证清单**，
 * 这意味着「能不能合法开源」这个问题没有答案（见 docs/research/open-source-business-model.md）。
 *
 * 本脚本不做判断，只产出事实：
 *   - 从 pnpm-lock.yaml 提取全部第三方包（唯一事实源，不靠 node_modules 是否装过）
 *   - node_modules 存在时，从每个包的 package.json 读取 license
 *   - 未解析到许可证的包单独列出——**未解析不等于安全**
 *
 * 用法：
 *   node .harness/scripts/oss-dependency-inventory.mjs            # 打印摘要
 *   node .harness/scripts/oss-dependency-inventory.mjs --json out.json
 *   node .harness/scripts/oss-dependency-inventory.mjs --strict   # 有未解析或高风险许可证则退出码 1
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOCKFILE = join(ROOT, "pnpm-lock.yaml");

/** 需要人工确认才能随产品再分发的许可证族。列在这里不等于禁用，等于「必须有结论」。 */
const NEEDS_REVIEW = [
  /^AGPL/i, /^GPL-[23]/i, /^SSPL/i, /^BUSL/i, /^BSL/i,
  /^CC-BY-NC/i, /^Elastic/i, /^commercial/i, /^UNLICENSED$/i, /^SEE LICENSE/i,
];

function parseLockPackages(text) {
  // pnpm-lock v9：packages: 段下每个条目形如 "  '@scope/name@1.2.3':" 或 "  name@1.2.3:"
  const out = new Map();
  const lines = text.split("\n");
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
    if (inPackages && /^\S/.test(line)) break;           // 离开 packages 段
    if (!inPackages) continue;
    const m = line.match(/^ {2}'?((?:@[^/'@]+\/)?[^'@\s]+)@([^'\s:]+)'?:\s*$/);
    if (m) out.set(`${m[1]}@${m[2]}`, { name: m[1], version: m[2] });
  }
  return out;
}

function resolveLicense(name) {
  const pkgJson = join(ROOT, "node_modules", name, "package.json");
  if (!existsSync(pkgJson)) return null;
  try {
    const p = JSON.parse(readFileSync(pkgJson, "utf8"));
    if (typeof p.license === "string") return p.license;
    if (p.license && typeof p.license.type === "string") return p.license.type;
    if (Array.isArray(p.licenses) && p.licenses[0]?.type) return p.licenses[0].type;
    return null;
  } catch { return null; }
}

if (!existsSync(LOCKFILE)) {
  console.error("找不到 pnpm-lock.yaml，请在仓库根目录运行");
  process.exit(2);
}

const pkgs = parseLockPackages(readFileSync(LOCKFILE, "utf8"));
const nodeModulesPresent = existsSync(join(ROOT, "node_modules"));

const rows = [];
for (const [key, { name, version }] of pkgs) {
  rows.push({ key, name, version, license: resolveLicense(name) });
}

const unresolved = rows.filter((r) => !r.license);
const review = rows.filter((r) => r.license && NEEDS_REVIEW.some((re) => re.test(r.license)));
const byLicense = new Map();
for (const r of rows) {
  const k = r.license ?? "(未解析)";
  byLicense.set(k, (byLicense.get(k) ?? 0) + 1);
}

const report = {
  generatedAt: new Date().toISOString(),
  nodeModulesPresent,
  totalPackages: rows.length,
  resolved: rows.length - unresolved.length,
  unresolved: unresolved.length,
  needsReview: review.map((r) => ({ name: r.name, version: r.version, license: r.license })),
  licenseHistogram: Object.fromEntries([...byLicense].sort((a, b) => b[1] - a[1])),
};

const jsonIdx = process.argv.indexOf("--json");
if (jsonIdx !== -1 && process.argv[jsonIdx + 1]) {
  writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(report, null, 2));
}

console.log(`第三方包总数      ${report.totalPackages}`);
console.log(`已解析许可证      ${report.resolved}`);
console.log(`未解析许可证      ${report.unresolved}`);
console.log(`需人工确认        ${report.needsReview.length}`);
if (!nodeModulesPresent) {
  console.log("\n⚠ node_modules 不存在，本次只清点了包名，没有读到任何许可证。");
  console.log("  先跑 pnpm install 再跑本脚本，结论才完整。");
}
if (report.needsReview.length) {
  console.log("\n需人工确认的包：");
  for (const r of report.needsReview) console.log(`  ${r.name}@${r.version}  ${r.license}`);
}

if (process.argv.includes("--strict")) {
  if (!nodeModulesPresent || report.unresolved > 0 || report.needsReview.length > 0) {
    console.error("\nstrict：存在未解析或待确认的许可证，开源就绪度检查未通过。");
    process.exit(1);
  }
}
