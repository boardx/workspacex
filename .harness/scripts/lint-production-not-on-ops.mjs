#!/usr/bin/env node
/**
 * lint-production-not-on-ops.mjs —— 生产不依赖运营平面（backlog C7）。
 *
 * ## 为什么要有这一道
 *
 * 开源方案把一批东西划进「不交付 · 内部运营平面」：协调平面（coord-gateway 与 coord-* 包）、
 * devportal 的协作层与平台层。这一类**不交付、不承诺可移植**——它们绑在 Cloudflare 的
 * Durable Object 上，客户拿不到，也跑不起来。
 *
 * 由此推出一条方向纪律（方案「三条纪律」第一条）：**运营面可以读生产，生产不能反过来依赖运营面。**
 * 否则两件事同时坏掉：
 *   · 自托管客户拿到的产品里有一个指向我们运营面的依赖，离开我们就跑不起来；
 *   · 选 Cloudflare 做运营面的正面理由是**故障域**——运营台要在生产挂掉时还能用。
 *     生产若依赖运营面，故障域就重新连成了一个。
 *
 * ## 名单怎么定
 *
 * 只列**运营平面**一侧（`OPS_DIRS`），其余 apps/* 与 packages/* 一律视为生产。
 * 反过来列生产名单的话，新加一个应用没人记得登记，它就默认不受检查——
 * 默认值必须落在严格的那一侧。
 *
 * ## 查什么（对每个生产目录）
 *
 *   ① package.json 依赖了运营平面的包；
 *   ② 源码 import 运营平面的包，或用相对路径伸进运营平面目录；
 *   ③ 源码读 `COORD_*` 环境变量——那是运行时依赖，不经过 import 也照样把生产绑在运营面上。
 *
 * 扫到 0 个文件判失败：空集不是全绿。
 *
 * 用法：
 *   node .harness/scripts/lint-production-not-on-ops.mjs
 *   node .harness/scripts/lint-production-not-on-ops.mjs --root <仓库根>   # 测试用
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expandOpsDirs } from "./lib/ops-plane.mjs";

const argRoot = process.argv.indexOf("--root");
const ROOT = argRoot > -1
  ? resolve(process.argv[argRoot + 1])
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// 运营平面名单的唯一事实源在 lib/ops-plane.mjs（依赖盘点也要用它）。
const opsDirs = expandOpsDirs(ROOT, readdirSync, existsSync, join, dirname);
const opsNames = new Set(
  opsDirs.map((d) => join(ROOT, d, "package.json")).filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, "utf8")).name).filter(Boolean),
);
const opsAbs = opsDirs.map((d) => join(ROOT, d));
const productDirs = ["apps", "packages"].flatMap((top) =>
  existsSync(join(ROOT, top))
    ? readdirSync(join(ROOT, top)).map((e) => `${top}/${e}`).filter((d) => statSync(join(ROOT, d)).isDirectory())
    : [],
).filter((d) => !opsDirs.includes(d));

const SKIP = new Set(["node_modules", ".next", "dist", "build", "out", ".turbo", "generated", ".wrangler", "coverage"]);
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(e)) out.push(p);
  }
  return out;
}
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
const ENV = /\bCOORD_[A-Z0-9_]+/g;
const pkgOf = (spec) => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];

const findings = [];
let scanned = 0;
for (const d of productDirs) {
  const pj = join(ROOT, d, "package.json");
  if (existsSync(pj)) {
    const pkg = JSON.parse(readFileSync(pj, "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (opsNames.has(name)) findings.push({ where: `${d}/package.json`, what: `${field} 依赖了运营平面的包 ${name}` });
      }
    }
  }
  for (const f of walk(join(ROOT, d))) {
    scanned++;
    const text = readFileSync(f, "utf8");
    const rel = relative(ROOT, f);
    for (const m of text.matchAll(SPEC)) {
      const spec = m[1];
      if (opsNames.has(pkgOf(spec))) findings.push({ where: rel, what: `import 了运营平面的包 ${spec}` });
      else if (spec.startsWith(".")) {
        const t = resolve(dirname(f), spec);
        if (opsAbs.some((o) => t === o || t.startsWith(o + sep))) findings.push({ where: rel, what: `相对路径 ${spec} 伸进了运营平面目录` });
      }
    }
    for (const m of new Set(text.match(ENV) ?? [])) {
      findings.push({ where: rel, what: `读了运营平面的环境变量 ${m}（运行时依赖）` });
    }
  }
}

console.log(`生产不依赖运营平面：运营平面 ${opsDirs.length} 个目录（${[...opsNames].length} 个包），` +
  `检查生产 ${productDirs.length} 个目录、${scanned} 个源码文件，违规 ${findings.length} 处`);
if (scanned === 0 || opsNames.size === 0) {
  console.error("扫到 0 个生产源码文件或 0 个运营平面包——空集不是全绿，判失败。");
  process.exit(1);
}
if (findings.length) {
  for (const f of findings) console.error(`  ${f.where}\n    ${f.what}`);
  console.error("\n运营面可以读生产，生产不能反过来依赖运营面：否则自托管客户离开我们就跑不起来，故障域也重新连成了一个。");
  process.exit(1);
}
console.log("✅ 生产不依赖运营平面");
