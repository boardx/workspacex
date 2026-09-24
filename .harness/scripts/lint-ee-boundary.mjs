#!/usr/bin/env node
/**
 * lint-ee-boundary.mjs —— 开源代码不依赖企业版代码（backlog C3，D26）。
 *
 * ## 为什么要有这一道
 *
 * D26 定下的边界：企业版代码放 `apps/ee-*` / `packages/ee-*`（lib/ownership.mjs 的 EE_DIR）。
 * 开源版必须在**拿掉全部 ee-* 目录**后仍能构建、运行——否则「开源」只是一个跑不起来的子集。
 * 方向只允许 ee → oss，不允许 oss → ee。这是方案承诺登记表里「OSS 不依赖 EE」那一行。
 *
 * ## 查什么（只对归属为 oss 的工作区包）
 *
 *   ① package.json 的 dependencies / devDependencies / peerDependencies / optionalDependencies
 *      不得出现 ee-* 包的名字（按 ee-* 目录里实际的 package.json name 对，也兜底 `@repo/ee-` 前缀）；
 *   ② 源码不得 import 这些名字；
 *   ③ 源码不得用相对路径进入任何 ee-* 目录。
 *
 * ## 这道门对自己断言的一件事
 *
 * 今天仓库里 ee-* 包是 0 个——这是事实，照实报告，不算失败；
 * 但扫描的**开源包源码文件**为 0 时判失败：空集不是全绿。
 *
 * 用法：
 *   node .harness/scripts/lint-ee-boundary.mjs
 *   node .harness/scripts/lint-ee-boundary.mjs --root <仓库根>   # 测试用
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyWorkspace, EE_DIR } from "./lib/ownership.mjs";

const argRoot = process.argv.indexOf("--root");
const ROOT = argRoot > -1
  ? resolve(process.argv[argRoot + 1])
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ws = classifyWorkspace(ROOT);
const eeDirs = ws.filter((w) => EE_DIR.test(w.dir)).map((w) => w.dir);
const eeNames = new Set(
  eeDirs.map((d) => JSON.parse(readFileSync(join(ROOT, d, "package.json"), "utf8")).name).filter(Boolean),
);
const isEeName = (n) => eeNames.has(n) || n.startsWith("@repo/ee-");
const eeAbs = eeDirs.map((d) => join(ROOT, d));
const intoEe = (p) => eeAbs.some((d) => p === d || p.startsWith(d + sep));

const SKIP = new Set(["node_modules", "dist", "build", ".next", ".turbo", "coverage", "generated"]);
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(e)) out.push(p);
  }
  return out;
}
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

const findings = [];
const oss = ws.filter((w) => w.class === "oss");
let fileCount = 0;
for (const w of oss) {
  const pkg = JSON.parse(readFileSync(join(ROOT, w.dir, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (isEeName(name)) findings.push({ where: `${w.dir}/package.json`, what: `${field} 依赖了企业版包 ${name}` });
    }
  }
  for (const f of walk(join(ROOT, w.dir))) {
    fileCount++;
    const text = readFileSync(f, "utf8");
    const rel = relative(ROOT, f);
    for (const m of text.matchAll(SPEC)) {
      const spec = m[1];
      const bare = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (isEeName(bare)) findings.push({ where: rel, what: `import 了企业版包 ${spec}` });
      else if (spec.startsWith(".") && intoEe(resolve(dirname(f), spec))) {
        findings.push({ where: rel, what: `相对路径 ${spec} 进入了企业版目录` });
      }
    }
  }
}

console.log(
  `开源/企业版边界检查：开源包 ${oss.length} 个、源码文件 ${fileCount} 个，企业版包 ${eeDirs.length} 个，违规 ${findings.length} 处`,
);
if (fileCount === 0) {
  console.error("扫到 0 个开源包源码文件——空集不是全绿，判失败。检查 lib/ownership.mjs 的归属表。");
  process.exit(1);
}
if (findings.length) {
  for (const f of findings) console.error(`  ${f.where}\n    ${f.what}`);
  console.error("\n开源版必须在拿掉全部 ee-* 目录后仍能构建运行：依赖方向只许 ee → oss（D26）。");
  process.exit(1);
}
console.log("✅ 开源代码不依赖企业版代码");
