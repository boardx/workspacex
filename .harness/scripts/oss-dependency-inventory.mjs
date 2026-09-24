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
 *   node .harness/scripts/oss-dependency-inventory.mjs --registry # 本机没装的包（多为别的平台的二进制）
 *                                                                 # 按确切版本向 npm registry 查许可证
 *
 * `--registry` 默认关：门控要能离线跑。本机不装的包大多是 Windows / macOS 专属二进制，
 * 桌面版会随别的平台发出去，所以它们同样在再分发范围内，不能因为本机没装就不查。
 */
import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { expandOpsDirs, NOT_SHIPPED_ROOT } from "./lib/ops-plane.mjs";
import { needsReview } from "./lib/spdx-review.mjs";

const ROOT = process.cwd();
const LOCKFILE = join(ROOT, "pnpm-lock.yaml");

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

/**
 * pnpm 的真实布局是 `node_modules/.pnpm/<名字，/ 换成 +>@<版本>[_<peer 后缀>]/node_modules/<名字>/`。
 * 根目录 `node_modules/<名字>` 只有被提升的直接依赖，本仓 2163 个包里只占 42 个。
 *
 * ⚠ 2026-09-24 更正：初版只读根目录 `node_modules/<名字>`，而且**不看版本**——
 * 于是装了依赖也只解析出 42 个，而且解析出来的可能是另一个版本的许可证。
 * 同一个包不同版本换过许可证并不罕见，按名字不按版本查，等于给错的答案盖章。
 */
const STORE = join(ROOT, "node_modules", ".pnpm");
const storeIndex = new Map();
if (existsSync(STORE)) {
  for (const dir of readdirSync(STORE)) {
    // 名字里可能带 @（scope），版本前的最后一个 @ 才是分隔符；peer 后缀以 _ 开头
    const m = /^(.+?)@([^@_]+)(?:_.*)?$/.exec(dir);
    if (!m) continue;
    const name = m[1].replace("+", "/");
    const key = `${name}@${m[2]}`;
    if (!storeIndex.has(key)) storeIndex.set(key, join(STORE, dir, "node_modules", name, "package.json"));
  }
}

/**
 * package.json 没写 `license` 字段、但包里带了 LICENSE 文件的，按文件正文认常见许可证。
 * 实测 @ag-ui/*、@copilotkit/*、khroma 都是这样（字段空、文件是 MIT）。认不出来就返回 null，
 * 宁可留给人看，也不猜。返回值带 `(LICENSE 文件)` 后缀，报告里看得出是从正文认的。
 */
function licenseFromFile(dir) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => /^(licen[cs]e|copying)(\.|$)/i.test(n)); } catch { return null; }
  for (const n of names) {
    const t = readFileSync(join(dir, n), "utf8").slice(0, 2000);
    const id =
      /Permission is hereby granted, free of charge/i.test(t) ? "MIT" :
      /Apache License[\s\S]{0,40}Version 2\.0/i.test(t) ? "Apache-2.0" :
      /Permission to use, copy, modify, and\/or distribute this software for any/i.test(t) ? "ISC" :
      /GNU LESSER GENERAL PUBLIC LICENSE/i.test(t) ? "LGPL" :
      /GNU GENERAL PUBLIC LICENSE/i.test(t) ? "GPL" :
      /Mozilla Public License/i.test(t) ? "MPL" : null;
    if (id) return `${id}(LICENSE 文件)`;
  }
  return null;
}

function resolveLicense(name, version) {
  const candidates = [storeIndex.get(`${name}@${version}`), join(ROOT, "node_modules", name, "package.json")];
  for (const pkgJson of candidates) {
    if (!pkgJson || !existsSync(pkgJson)) continue;
    try {
      const p = JSON.parse(readFileSync(pkgJson, "utf8"));
      if (p.version !== version) continue; // 根目录那份可能是别的版本，版本不符就不采信
      if (typeof p.license === "string") return p.license;
      if (p.license && typeof p.license.type === "string") return p.license.type;
      if (Array.isArray(p.licenses) && p.licenses[0]?.type) return p.licenses[0].type;
      return licenseFromFile(dirname(pkgJson));
    } catch { /* 读不了就看下一个候选 */ }
  }
  return null;
}

if (!existsSync(LOCKFILE)) {
  console.error("找不到 pnpm-lock.yaml，请在仓库根目录运行");
  process.exit(2);
}

const lockText = readFileSync(LOCKFILE, "utf8");
const pkgs = parseLockPackages(lockText);

/**
 * 随产品分发的闭包：只有交付给客户的东西才构成再分发。
 * 起点 = 产品侧各工作区项目的 dependencies + optionalDependencies（不含 devDependencies）；
 * 排除仓库根（harness 工具链）与运营平面（名单在 lib/ops-plane.mjs，与生产依赖门控共用一份）；
 * 沿 lockfile 的 snapshots 递归展开，workspace 链接则跳进对应项目继续展开。
 */
const lock = parseYaml(lockText);
const excluded = new Set([NOT_SHIPPED_ROOT, ...expandOpsDirs(ROOT, readdirSync, existsSync, join, dirname)]);
const shipped = new Set();
const seenImporters = new Set();
const stack = [];
function pushDeps(deps) {
  for (const [dep, v] of Object.entries(deps ?? {})) {
    const version = typeof v === "string" ? v : v.version;
    if (version.startsWith("link:")) {
      const target = join(version.slice(5)).replace(/\\/g, "/");
      if (!excluded.has(target)) visitImporter(target);
      continue;
    }
    stack.push(`${dep}@${version}`);
  }
}
function visitImporter(id) {
  if (seenImporters.has(id) || excluded.has(id)) return;
  seenImporters.add(id);
  const imp = lock.importers?.[id];
  if (!imp) return;
  pushDeps(imp.dependencies);
  pushDeps(imp.optionalDependencies);
}
for (const id of Object.keys(lock.importers ?? {})) visitImporter(id);
while (stack.length) {
  const snapKey = stack.pop();
  const base = snapKey.replace(/\(.*$/, "");
  if (shipped.has(base)) continue;
  shipped.add(base);
  const snap = lock.snapshots?.[snapKey] ?? lock.snapshots?.[base];
  if (!snap) continue;
  pushDeps(snap.dependencies);
  pushDeps(snap.optionalDependencies);
}
const nodeModulesPresent = existsSync(join(ROOT, "node_modules"));

const rows = [];
for (const [key, { name, version }] of pkgs) {
  const license = resolveLicense(name, version);
  const installed = storeIndex.has(key) || existsSync(join(ROOT, "node_modules", name, "package.json"));
  rows.push({ key, name, version, license, shipped: shipped.has(key), source: license ? "local" : null,
    reason: license ? null : installed ? "已安装但 package.json 未声明许可证" : "本机未安装（多为其他平台专属包）" });
}

if (process.argv.includes("--registry")) {
  const todo = rows.filter((r) => !r.license);
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const r = todo[i++];
      const url = `https://registry.npmjs.org/${r.name.replace("/", "%2F")}/${encodeURIComponent(r.version)}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) { r.reason = `registry 返回 ${res.status}`; continue; }
        const p = await res.json();
        const lic = typeof p.license === "string" ? p.license
          : p.license?.type ?? (Array.isArray(p.licenses) ? p.licenses[0]?.type : null);
        if (lic) { r.license = lic; r.source = "registry"; r.reason = null; }
        else r.reason = "registry 上也未声明许可证";
      } catch (e) { r.reason = `registry 查询失败：${e.name}`; }
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
}

const unresolved = rows.filter((r) => !r.license);
const review = rows.filter((r) => r.license && needsReview(r.license));
const shippedRows = rows.filter((r) => r.shipped);
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
  resolvedFromRegistry: rows.filter((r) => r.source === "registry").length,
  shippedPackages: shippedRows.length,
  shippedUnresolved: shippedRows.filter((r) => !r.license).length,
  needsReview: review.map((r) => ({ name: r.name, version: r.version, license: r.license, shipped: r.shipped })),
  unresolvedList: unresolved.map((r) => ({ name: r.name, version: r.version, reason: r.reason })),
  licenseHistogram: Object.fromEntries([...byLicense].sort((a, b) => b[1] - a[1])),
};

const jsonIdx = process.argv.indexOf("--json");
if (jsonIdx !== -1 && process.argv[jsonIdx + 1]) {
  writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(report, null, 2));
}

console.log(`第三方包总数      ${report.totalPackages}`);
console.log(`已解析许可证      ${report.resolved}`);
console.log(`未解析许可证      ${report.unresolved}`);
console.log(`需人工确认        ${report.needsReview.length}（其中随产品分发 ${review.filter((r) => r.shipped).length}）`);
console.log(`随产品分发的包    ${report.shippedPackages}（其中未解析 ${report.shippedUnresolved}）`);
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
