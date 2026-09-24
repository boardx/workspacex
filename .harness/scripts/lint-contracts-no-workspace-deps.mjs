#!/usr/bin/env node
/**
 * lint-contracts-no-workspace-deps.mjs —— 契约包不依赖任何工作区包（backlog C4）。
 *
 * ## 为什么要有这一道
 *
 * `@repo/contracts` 是前后端、第三方客户端共同照着写的那份东西——开源方案里它是
 * **最该开放**的包。技能包内容（判据阈值、方法论正文）是**最该积累**的资产，开放策略
 * 正相反。两者一旦出现依赖，内容就会随契约一起分发出去，开源与售卖的边界当场失效。
 *
 * 这不是假想：投后判据阈值曾经就放在契约包里（#3856 搬出到 `@repo/maau-postinvest-report`）。
 * 搬家时在 README 里写了「契约包不得依赖内容包」——那是一句话，不是一道门。
 * 本仓规矩：没有脚本的规范视为未落地。
 *
 * ## 查什么
 *
 * 规则取最严也最简单的那一版：**契约包不依赖任何工作区包**，不只是内容包。
 * 契约是最内层的共享内核，它往外依赖任何东西都是方向错误；只盯内容包的话，
 * 下一个内容包换个名字就绕过去了。
 *
 *   ① package.json 的 dependencies / devDependencies / peerDependencies 里
 *      不得出现 `workspace:` 协议或 `@repo/` 名字；
 *   ② src/ 下的源码不得 import `@repo/*`；
 *   ③ src/ 下的源码不得用相对路径跳出契约包目录（`../../` 绕过包边界）。
 *
 * ## 这道门对自己断言的一件事
 *
 * 报告**扫描了多少个文件**，扫到 0 个文件时判失败——空集不是全绿。
 * `lint-arch-deps` 曾经从未扫到过一个文件却一直被当作强制门控（见其文件头）。
 *
 * 用法：
 *   node .harness/scripts/lint-contracts-no-workspace-deps.mjs
 *   node .harness/scripts/lint-contracts-no-workspace-deps.mjs --root <仓库根>   # 测试用
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const argRoot = process.argv.indexOf("--root");
const ROOT = argRoot > -1
  ? resolve(process.argv[argRoot + 1])
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PKG_DIR = join(ROOT, "packages", "contracts");
const SRC_DIR = join(PKG_DIR, "src");

const findings = [];

// ① package.json
const pkgPath = join(PKG_DIR, "package.json");
if (!existsSync(pkgPath)) {
  console.error(`契约包依赖检查：找不到 ${relative(ROOT, pkgPath)}，无法判定——不许判绿。`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (name.startsWith("@repo/") || String(spec).startsWith("workspace:")) {
      findings.push({ where: `packages/contracts/package.json`, what: `${field} 依赖了工作区包 ${name}（${spec}）` });
    }
  }
}

// ②③ 源码
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "generated") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(e)) out.push(p);
  }
  return out;
}
const files = existsSync(SRC_DIR) ? walk(SRC_DIR) : [];
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const rel = relative(ROOT, f);
  for (const m of text.matchAll(SPEC)) {
    const spec = m[1];
    if (spec.startsWith("@repo/")) {
      findings.push({ where: rel, what: `import 了工作区包 ${spec}` });
    } else if (spec.startsWith(".")) {
      const target = resolve(dirname(f), spec);
      if (target !== PKG_DIR && !target.startsWith(PKG_DIR + sep)) {
        findings.push({ where: rel, what: `相对路径 ${spec} 跳出了契约包目录` });
      }
    }
  }
}

console.log(`契约包依赖检查：扫描 package.json + ${files.length} 个源码文件，违规 ${findings.length} 处`);
if (files.length === 0) {
  console.error("扫到 0 个源码文件——空集不是全绿，判失败。检查 packages/contracts/src 是否还在。");
  process.exit(1);
}
if (findings.length) {
  for (const f of findings) console.error(`  ${f.where}\n    ${f.what}`);
  console.error("\n契约包是最内层的共享内核，也是开源方案里最该开放的包：它不许依赖任何工作区包。");
  process.exit(1);
}
console.log("✅ 契约包不依赖任何工作区包");
