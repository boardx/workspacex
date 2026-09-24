#!/usr/bin/env node
// lint-pnpm-override-selector.mjs —— issue #2614 的仓库侧入口。
//
// 判定逻辑在 lib/pnpm-override-selector.ts（纯函数、喂 fixture 单测），这里只做三件事：
// 读真实文件 → 调它 → 按结果决定退出码。同 lint-test-listen-loopback.mjs 的分层先例。
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  analyzeOverrideEntries,
  overrideEntriesFromPackageJson,
  overrideEntriesFromWorkspaceManifest,
} from "./lib/pnpm-override-selector.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".venv",
  "test-results",
  "playwright-report",
]);
const WORKSPACE_MANIFESTS = new Set(["pnpm-workspace.yaml", "pnpm-workspace.yml"]);

function collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name === "package.json" || WORKSPACE_MANIFESTS.has(entry.name)) {
      out.push(full.slice(ROOT.length + 1));
    }
  }
}

const files = [];
collect(ROOT, files);

const entries = [];
const unreadable = [];
for (const file of files) {
  const source = readFileSync(join(ROOT, file), "utf8");
  try {
    if (basename(file) === "package.json") {
      entries.push(...overrideEntriesFromPackageJson(file, source));
    } else {
      entries.push(...overrideEntriesFromWorkspaceManifest(file, parseYaml(source)));
    }
  } catch (error) {
    unreadable.push({ file, reason: error instanceof Error ? error.message : String(error) });
  }
}

const report = analyzeOverrideEntries(entries, { filesScanned: files.length, unreadable });

// 扫到 0 个清单只可能是路径接错了。「没做判断」在门控上不算通过。
if (report.filesScanned === 0) {
  console.error("✗ [pnpm-override-selector] 扫到 0 个 package.json —— 扫描根接错了，这不是「通过」。");
  process.exit(1);
}

if (report.unreadable.length > 0) {
  console.error(`✗ [pnpm-override-selector] ${report.unreadable.length} 个清单解析失败，无法判定：`);
  for (const bad of report.unreadable) console.error(`   · ${bad.file} —— ${bad.reason}`);
  process.exit(1);
}

if (report.nested.length > 0) {
  console.error(`✗ [pnpm-override-selector] ${report.nested.length} 处 override 用了 parent>child 选择器（issue #2614）：`);
  for (const hit of report.nested) {
    console.error(`   · ${hit.file} → ${hit.field}["${hit.key}"] = "${hit.value}"`);
    console.error(`       父包 ${hit.parent} / 子包 ${hit.child}`);
  }
  console.error("   这个选择器对**由 peerDependency 自动解析**出来的边不可靠：任何触发全仓重新");
  console.error("   resolve 的操作都可能把它解析成不满足 range 的版本，而 pnpm 只告警不报错——静默装错版本。");
  console.error("   改法：在真正用到它的 workspace 包里声明**直接依赖**并钉死版本（#2613 的 9182fa3 先例），");
  console.error("   direct dependency 参与正常 resolve，冲突当场报错。详细理由见");
  console.error("   .harness/scripts/lib/pnpm-override-selector.ts 顶部注释（本条判据的单一事实源）。");
  process.exit(1);
}

console.log(
  `✓ [pnpm-override-selector] ${report.filesScanned} 个清单 / ${report.entriesScanned} 条 override，无 parent>child 选择器`,
);
process.exit(0);
