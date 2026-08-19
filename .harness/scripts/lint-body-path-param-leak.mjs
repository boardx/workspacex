#!/usr/bin/env node
// lint-body-path-param-leak.mjs —— issue #1580 的仓库侧入口。
//
// 判定逻辑全在 lib/body-path-param-leak.ts（纯函数、喂 fixture 单测）。这里只做三件事：
// 读真实文件 → 调它 → 按结果决定退出码。同 lint-rewrite-coverage.mjs 的分层先例。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBodyPathParamLeaks } from "./lib/body-path-param-leak.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_LIB = join(ROOT, "apps/web/lib");

function collectFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
      out.push({ file: full.slice(ROOT.length + 1), source: readFileSync(full, "utf8") });
    }
  }
}

const files = [];
if (existsSync(WEB_LIB)) collectFiles(WEB_LIB, files);

const report = analyzeBodyPathParamLeaks(files);

if (report.incomplete) {
  console.warn(`! [body-path-param-leak] 扫不全，本次不判定：${report.incompleteReason}`);
  console.warn("  这不是「通过」，是「没做判断」——请修扫描器或路径，别让它一直静默。");
  process.exit(0);
}

if (report.gaps.length > 0) {
  console.error(`✗ [body-path-param-leak] ${report.gaps.length} 处 body 里带了路径参数名（见 F950/F961，PR #1549）：`);
  for (const gap of report.gaps) {
    console.error(`   · ${gap.file}:${gap.line} —— body 里出现 "${gap.param}"，而它已经在 URL 路径里了`);
    console.error(`     ${gap.snippet}...`);
  }
  console.error("   controller 的 body schema 多是 `.in.omit({ 该参数: true })`——契约 object 是");
  console.error("   `.strict()`，`.omit()` 保留 strict，body 里多带一个路径参数会被 zod 判未知字段 ⇒ 400。");
  console.error(`   ${report.filesScanned} 个文件已扫描。`);
  process.exit(1);
}

console.log(`✓ [body-path-param-leak] ${report.filesScanned} 个文件，body 里没有路径参数泄漏`);
process.exit(0);
