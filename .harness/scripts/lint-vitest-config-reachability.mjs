#!/usr/bin/env node
// lint-vitest-config-reachability.mjs —— issue #3164 的仓库侧入口。
//
// 判定逻辑在 lib/vitest-config-reachability.ts（纯函数、喂 fixture 单测），这里只做三件事：
// 读真实文件 → 调它 → 按结果决定退出码。同 lint-test-listen-loopback.mjs 的分层先例。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeVitestConfigReachability } from "./lib/vitest-config-reachability.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = join(ROOT, "apps", "api");
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".turbo", ".venv", "test-results", ".git"]);

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, accept, out);
    else if (accept(entry.name)) out.push(full);
  }
  return out;
}

const rel = (full) => relative(ROOT, full).split("\\").join("/");

/**
 * 入口只有两类：任意 package.json 的 scripts，和 .github/workflows 下的 workflow。
 * evidence 文本、设计文档、spec 文件里的注释**都不算**——它们证明"曾经有人敲过一次"，
 * 不证明今天还跑得起来（#3164 正是栽在这个区别上）。
 */
const entries = [];
for (const manifest of walk(ROOT, (name) => name === "package.json")) {
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts;
  } catch {
    continue;
  }
  if (!scripts) continue;
  entries.push({ name: `${rel(manifest)}#scripts`, content: Object.values(scripts).join("\n") });
}
for (const workflow of walk(join(ROOT, ".github", "workflows"), (name) => /\.ya?ml$/.test(name))) {
  entries.push({ name: rel(workflow), content: readFileSync(workflow, "utf8") });
}

const read = (full) => ({ name: full.slice(API.length + 1), content: readFileSync(full, "utf8") });
const configs = readdirSync(API)
  .filter((name) => /^vitest\..+\.config\.ts$/.test(name))
  .sort()
  .map((name) => read(join(API, name)));
// `vitest.config.ts` 是 `vitest run` 不带 --config 时的默认值，天然可达：它自身不受约束，
// 但它引用到的 config（`vitest.exclusive.config.ts` 等）算可达。
const roots = existsSync(join(API, "vitest.config.ts")) ? [read(join(API, "vitest.config.ts"))] : [];
/**
 * spec 侧只判 `tests/agent-runtime/*.live.ts`——#3164 说的是 skill 能力面那批。
 *
 * ⚠ 本门控之外还有两个零引用的 live spec：`tests/deploy/prepare-agent-db.live.ts`
 *   与 `prepare-memory-db.live.ts`（全仓零引用，需要一个"干净的一次性 PG"才能跑）。
 *   它们不在 #3164 的范围里，这里如实记一笔，不假装它们有入口。
 */
const specs = walk(join(API, "tests", "agent-runtime"), (name) => name.endsWith(".live.ts")).map(
  (full) => full.slice(API.length + 1),
);

if (configs.length === 0) {
  console.warn("! [vitest-config-reachability] 扫到 0 个 config，本次不判定——这不是「通过」，是「没做判断」。");
  process.exit(0);
}

const report = analyzeVitestConfigReachability({ configs, entries, roots, specs });
let failed = false;

if (report.orphans.length > 0) {
  failed = true;
  console.error(`✗ [vitest-config-reachability] ${report.orphans.length} 个 config 没有自动化入口（issue #3164）：`);
  for (const orphan of report.orphans) console.error(`   · apps/api/${orphan}`);
  console.error("   只能靠人手敲 `vitest --config …` 的车道 = 这条车道悄悄坏掉时没有任何东西会变红。");
  console.error("   修法：在 apps/api/package.json 里给它一个具名 script（哪怕只能手动触发），");
  console.error("   或让某条 workflow 跑它；确认不再需要的，删掉 config 本身。");
}

if (report.uncoveredSpecs.length > 0) {
  failed = true;
  console.error(`✗ [vitest-config-reachability] ${report.uncoveredSpecs.length} 个 live spec 不在任何可达 config 的 include 里：`);
  for (const spec of report.uncoveredSpecs) console.error(`   · apps/api/${spec}`);
  console.error("   `*.live.ts` 不匹配默认车道的 include，没有可达 config 收它就等于没人能跑它。");
}

if (failed) process.exit(1);

console.log(
  `✓ [vitest-config-reachability] ${report.scanned} 个 config 全部可从 npm script / workflow 到达，${specs.length} 个 live spec 全部被可达 config 覆盖`,
);
process.exit(0);
