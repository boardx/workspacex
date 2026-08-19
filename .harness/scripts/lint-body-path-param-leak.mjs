#!/usr/bin/env node
// lint-body-path-param-leak.mjs —— issue #1580 的仓库侧入口。
//
// 判定逻辑全在 lib/body-path-param-leak.ts（纯函数、喂 fixture 单测）。这里只做三件事：
// 读真实文件 → 调它 → 按结果决定退出码。同 lint-rewrite-coverage.mjs 的分层先例。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBodyPathParamLeaks, allowlistKey, staleAllowlistEntries } from "./lib/body-path-param-leak.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_LIB = join(ROOT, "apps/web/lib");
const ALLOWLIST_PATH = join(ROOT, ".harness/state/body-path-param-leak-allowlist.json");

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

const allowlistDoc = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
  : { entries: [] };
const allowlistEntries = allowlistDoc.entries ?? [];
const allowlist = new Set(allowlistEntries);

const report = analyzeBodyPathParamLeaks(files, allowlist);

if (report.incomplete) {
  console.warn(`! [body-path-param-leak] 扫不全，本次不判定：${report.incompleteReason}`);
  console.warn("  这不是「通过」，是「没做判断」——请修扫描器或路径，别让它一直静默。");
  process.exit(0);
}

const stale = staleAllowlistEntries(files, allowlist);

let failed = false;

if (report.gaps.length > 0) {
  failed = true;
  console.error(`✗ [body-path-param-leak] ${report.gaps.length} 处 body 里带了路径参数名（见 F950/F961，PR #1549）：`);
  for (const gap of report.gaps) {
    console.error(`   · ${gap.file}:${gap.line} —— body 里出现 "${gap.param}"，而它已经在 URL 路径里了`);
    console.error(`     ${gap.snippet}...`);
  }
  console.error("   controller 的 body schema 若是 `.in.omit({ 该参数: true })`——契约 object 是");
  console.error("   `.strict()`，`.omit()` 保留 strict，body 里多带一个路径参数会被 zod 判未知字段 ⇒ 400。");
  console.error("   若确认对应 controller 用的是全量 `.in`（未 .omit()，路径参数本来就该在 body 里再传一次），");
  console.error(`   把 "${allowlistKey("<file>", "<param>")}" 加进 .harness/state/body-path-param-leak-allowlist.json。`);
}

if (stale.length > 0) {
  failed = true;
  console.error(`✗ [body-path-param-leak] allowlist 有 ${stale.length} 条已经不缺了，请删掉：${stale.join(", ")}`);
  console.error("   棘轮只减不增。留着已经不缺的豁免，等于给未来的回归留一扇没人看守的门。");
}

if (!failed) {
  console.log(
    `✓ [body-path-param-leak] ${report.filesScanned} 个文件，body 里没有未豁免的路径参数泄漏` +
      (allowlist.size > 0 ? `（${allowlist.size} 条已知合法冗余在棘轮名单里）` : ""),
  );
}

process.exit(failed ? 1 : 0);
