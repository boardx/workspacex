#!/usr/bin/env node
// lint-test-listen-loopback.mjs —— issue #2992 的仓库侧入口。
//
// 判定逻辑在 lib/test-listen-loopback.ts（纯函数、喂 fixture 单测），这里只做三件事：
// 读真实文件 → 调它 → 按结果决定退出码。同 lint-body-path-param-leak.mjs 的分层先例。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeListenSites } from "./lib/test-listen-loopback.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["apps", "packages"];
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".turbo", ".venv", "test-results"]);

function collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push({ file: full.slice(ROOT.length + 1), source: readFileSync(full, "utf8") });
    }
  }
}

const files = [];
for (const r of ROOTS) {
  const dir = join(ROOT, r);
  if (existsSync(dir)) collect(dir, files);
}

if (files.length === 0) {
  console.warn("! [test-listen-loopback] 扫到 0 个文件，本次不判定——这不是「通过」，是「没做判断」。");
  process.exit(0);
}

const report = analyzeListenSites(files);

if (report.wildcard.length > 0) {
  console.error(`✗ [test-listen-loopback] ${report.wildcard.length} 处 listen(0) 绑通配地址（issue #2992）：`);
  for (const site of report.wildcard) console.error(`   · ${site.file}:${site.line} —— ${site.snippet}`);
  console.error("   `listen(0)` 绑 0.0.0.0，测试随后 fetch 127.0.0.1——两者不是同一个地址，");
  console.error("   抽到的临时端口可能已被别的进程占在 127.0.0.1 上，请求就打到那个进程去了。");
  console.error("   #2992 的四条红收到的 body 是本仓零命中的 `Invalid CSRF token`：没跑到，却长得像断言挂了。");
  console.error('   改成 `listen(0, "127.0.0.1", ...)`：bind 哪个地址就 fetch 哪个地址，冲突当场 EADDRINUSE。');
  process.exit(1);
}

console.log(`✓ [test-listen-loopback] ${report.filesScanned} 个文件，listen(0) 全部绑在回环地址上`);
process.exit(0);
