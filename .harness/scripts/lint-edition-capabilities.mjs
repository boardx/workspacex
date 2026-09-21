#!/usr/bin/env node
/**
 * lint-edition-capabilities.mjs —— 本地版↔在线版能力差异矩阵的**落地门控**
 *
 * 立场（AGENTS.md）：没有脚本的规范条目视为未落地。一张只被界面读的矩阵会慢慢变成装饰：
 * 界面上写着「本地版不可用」，而后端照旧走那条路——2026-09-22 实测到的正是这一幕
 * （本地版声明不出网，`selectImageProvider` 却返回 bailian 指向公网 DashScope）。
 *
 * 三条检查：
 *   1. 形状：每一行的 `enforcement` 必须是四个已知取值之一；`gated` 必须带
 *      `enforcementRef`，其余取值必须是 `null`（不许写一个没人核对的 ref）。
 *   2. `gated` 的 ref 必须真的能在实现代码里搜到（不含契约自身与测试）。
 *      搜不到 = 这一行自称被代码看住，实际没有。
 *   3. `declared-only` 逐条打印。它不判失败——已知缺口是允许存在的，但必须**可见**，
 *      而且数量写在这里：多出来一条，这里的数字就对不上，谁加的谁得解释。
 *
 * 用法：node .harness/scripts/lint-edition-capabilities.mjs
 * 退出码：0 = 全过；1 = 有违规。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT = join(ROOT, "packages/contracts/src/deployment.ts");
/** 实现代码的搜索面。刻意**不含** packages/contracts（那是声明处）与任何 tests/ 目录。 */
const SEARCH_ROOTS = ["apps/api/src", "apps/web/lib", "apps/web/components", "apps/web/app", "packages/local-runtime/src"];
const KNOWN = new Set(["gated", "unset-by-default", "by-construction", "declared-only"]);
/**
 * 今天允许存在的「已知缺口」条数。**改这个数字要连带解释为什么**——它存在的唯一目的
 * 就是让缺口不能悄悄变多（同本仓其它计数型门控的做法）。
 */
const EXPECTED_DECLARED_ONLY = 3;

const source = readFileSync(CONTRACT, "utf8");

/** 逐行解析矩阵里每一行的 id / enforcement / enforcementRef —— 不引入 TS 运行时。 */
function rows() {
  const start = source.indexOf("export const EDITION_CAPABILITIES = [");
  if (start === -1) { console.error("✗ 契约里找不到 EDITION_CAPABILITIES"); process.exit(1); }
  const body = source.slice(start, source.indexOf("] as const satisfies", start));
  const out = [];
  for (const chunk of body.split(/\n  \{\n/).slice(1)) {
    const id = /id:\s*"([^"]+)"/.exec(chunk)?.[1];
    const enforcement = /enforcement:\s*"([^"]+)"/.exec(chunk)?.[1];
    const refRaw = /enforcementRef:\s*(null|"[^"]+")/.exec(chunk)?.[1];
    out.push({ id, enforcement, ref: refRaw === "null" ? null : refRaw?.slice(1, -1) ?? undefined });
  }
  return out;
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "tests" || name === "test" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

const haystack = SEARCH_ROOTS.flatMap((rel) => {
  try { return [...files(join(ROOT, rel))]; } catch { return []; }
}).map((f) => readFileSync(f, "utf8")).join("\n");

let fail = 0;
const declaredOnly = [];
for (const row of rows()) {
  if (row.id === undefined) { console.error("✗ 矩阵里有一行没有 id"); fail++; continue; }
  if (!KNOWN.has(row.enforcement)) {
    console.error(`✗ [${row.id}] enforcement="${String(row.enforcement)}" 不是已知取值（${[...KNOWN].join(" / ")}）`);
    fail++; continue;
  }
  if (row.enforcement === "gated") {
    if (!row.ref) { console.error(`✗ [${row.id}] 自称 gated 却没有 enforcementRef`); fail++; continue; }
    if (!haystack.includes(row.ref)) {
      console.error(`✗ [${row.id}] enforcementRef "${row.ref}" 在实现代码里搜不到`);
      console.error("    这一行自称被代码看住，实际没有——要么接上判据，要么把 enforcement 改成实话。");
      fail++;
    }
  } else if (row.ref !== null) {
    console.error(`✗ [${row.id}] enforcement=${row.enforcement} 不该带 enforcementRef（没人核对它）`);
    fail++;
  }
  if (row.enforcement === "declared-only") declaredOnly.push(row.id);
}

console.log(`已知缺口（declared-only，界面照它说话但没有机械保证）${declaredOnly.length} 条：${declaredOnly.join(", ") || "无"}`);
if (declaredOnly.length !== EXPECTED_DECLARED_ONLY) {
  console.error(`✗ 已知缺口数从 ${EXPECTED_DECLARED_ONLY} 变成 ${declaredOnly.length}。`);
  console.error("    变少了是好事，把脚本里的 EXPECTED_DECLARED_ONLY 一起改小；变多了请说明为什么。");
  fail++;
}

if (fail > 0) { console.error(`\n❌ lint-edition-capabilities：${fail} 处违规。`); process.exit(1); }
console.log("✅ lint-edition-capabilities：矩阵每一行的落地方式都对得上。");
