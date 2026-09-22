#!/usr/bin/env node
// lint-test-shared-grant.mjs —— issue #522 的仓库侧入口。
//
// 判定逻辑全在 lib/test-shared-grant.ts（纯函数、喂 fixture 单测）。这里只做三件事：
// 读真实文件 → 调它 → 按结果决定退出码。同 lint-body-path-param-leak.mjs 的分层先例。
//
// `--root <dir>`：换一棵树来扫。反证测试（lint-test-shared-grant.test.ts）用它把门
// 真跑在一份「无限定 REVOKE」的 fixture 上，证明这道门**真的会红**，而不是只证明
// 纯函数返回了一个数组。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSharedGrants, allowlistKey, staleAllowlistEntries } from "./lib/test-shared-grant.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rootArg = process.argv.indexOf("--root");
const ROOT = rootArg === -1 ? REPO_ROOT : resolve(process.argv[rootArg + 1]);
const SCAN_ROOTS = ["apps", "packages"];
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".turbo", ".venv", "test-results", "playwright-report"]);
// 名单跟着被扫的那棵树走（不是跟着脚本走）：`--root` 指到别的树时，本仓的棘轮名单
// 不该把那棵树里的违规顺手豁免掉，反证测试要的正是「一棵干净树 + 一条违规 = 红」。
const ALLOWLIST_PATH = join(ROOT, ".harness/state/test-shared-grant-allowlist.json");

/** 测试代码 = 跑在并行池里的东西：测试文件本身，以及它们 import 的 tests/ 支撑文件。 */
function isTestCode(rel) {
  const parts = rel.split(sep);
  const name = parts[parts.length - 1];
  if (!/\.tsx?$/.test(name) || name.endsWith(".d.ts")) return false;
  if (/\.(test|spec)\.tsx?$/.test(name)) return true;
  return parts.some((p) => p === "tests" || p === "test" || p === "e2e");
}

function collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else {
      const rel = full.slice(ROOT.length + 1);
      if (isTestCode(rel)) out.push({ file: rel, source: readFileSync(full, "utf8") });
    }
  }
}

const files = [];
for (const r of SCAN_ROOTS) {
  const dir = join(ROOT, r);
  if (existsSync(dir)) collect(dir, files);
}

if (files.length === 0) {
  console.warn("! [test-shared-grant] 扫到 0 个测试文件，本次不判定——这不是「通过」，是「没做判断」。");
  process.exit(0);
}

const allowlistDoc = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
  : { entries: [] };
const allowlist = new Set((allowlistDoc.entries ?? []).map((e) => (typeof e === "string" ? e : e.key)));

const report = analyzeSharedGrants(files, allowlist);
const stale = staleAllowlistEntries(files, allowlist);

let failed = false;

if (report.violations.length > 0) {
  failed = true;
  console.error(`✗ [test-shared-grant] ${report.violations.length} 条测试代码对共享角色做了无限定 GRANT/REVOKE（issue #522）：`);
  for (const v of report.violations) {
    console.error(`   · ${v.file}:${v.line} —— ${v.statement}`);
    console.error(`     对象 \`${v.object}\` 不是本文件建的，角色 \`${v.grantee}\` 是共享的 ⇒ 影响面是整个库。`);
  }
  console.error("   权限挂在角色上，worktree 隔离与每 worker 一个库名都挡不住它：vitest 是 forks 池 +");
  console.error("   maxWorkers 4，四个测试文件并行跑在同一个 Postgres 上，别的文件的夹具只要在这个窗口里");
  console.error("   碰同一张表就挂——受害者由调度决定，所以它在 CI 上长成 flake，单跑永远是绿的（#522 实测）。");
  console.error("   改法：要注入权限失败，就**限定到本用例自己的数据**——装一个双重限定的触发器");
  console.error("   （本文件的 org AND 本文件的 sentinel 前缀），别动角色权限。范例见 PR #516：");
  console.error("   apps/api/tests/agent-runtime/no-tool-run-writeback.test.ts 的 installWritebackFailureInjector。");
  console.error("   详见 .harness/instructions/testing-standards.md「数据库授权是共享可变状态」一节。");
  console.error(`   确有理由留着，把 "${allowlistKey("<file>", "<语句原文>")}" 加进`);
  console.error("   .harness/state/test-shared-grant-allowlist.json，并在那份 _readme 里写清怎么清掉它。");
}

if (stale.length > 0) {
  failed = true;
  console.error(`✗ [test-shared-grant] 棘轮名单有 ${stale.length} 条已经不存在了，请删掉：`);
  for (const key of stale) console.error(`   · ${key}`);
  console.error("   棘轮只减不增。留着已经清理掉的豁免，等于给未来的回归留一扇没人看守的门。");
}

if (report.allowed.length > 0) {
  console.warn(`! [test-shared-grant] ${report.allowed.length} 条存量豁免，待清理（棘轮名单，只许变短）：`);
  for (const a of report.allowed) console.warn(`   · ${a.file}:${a.line} —— ${a.statement}`);
}

if (!failed) {
  const byVerdict = report.sites.reduce((acc, s) => ({ ...acc, [s.verdict]: (acc[s.verdict] ?? 0) + 1 }), {});
  const shape = Object.entries(byVerdict).map(([k, n]) => `${k}=${n}`).join(" ");
  console.log(
    `✓ [test-shared-grant] ${report.filesScanned} 个测试文件，${report.sites.length} 条授权语句，` +
      `没有未豁免的共享角色无限定授权${shape ? `（${shape}）` : ""}`,
  );
}

process.exit(failed ? 1 : 0);
