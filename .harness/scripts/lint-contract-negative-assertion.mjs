#!/usr/bin/env node
// lint-contract-negative-assertion.mjs —— issue #473 的仓库侧入口。
//
// 判定逻辑全在 lib/contract-negative-assertion.ts（纯函数、喂 fixture 单测，那里也写着
// 这道门为什么存在）。这里只做三件事：读真实文件 → 调它 → 按结果决定退出码。
// 同 lint-body-path-param-leak.mjs / lint-rewrite-coverage.mjs 的分层先例。
//
// 输出刻意对**每一条**扫到的断言给结论（STALE / VERIFIED_ABSENT / FIELD_ONLY / PROSE），
// 不只打一行「✅ 通过」：这道门守的东西本身就是「有人拿一句没核实过的断言当事实」，
// 一道只说自己绿了的门，正是它要防的那种事实源。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildContractIndex,
  findNegativeAssertions,
  judge,
  countByVerdict,
} from "./lib/contract-negative-assertion.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT_SRC = join(ROOT, "packages/contracts/src");
const BUDGET_PATH = join(ROOT, ".harness/state/contract-negative-assertion-budget.json");

/**
 * 扫描范围。#473 的现场在 `apps/web`，但同形状的断言 `apps/api` 里更多（41 处 vs 47 处），
 * 而后端注释同样会被 coordinator 当事实引用——`apps/api/src/application/chat/ports.ts`
 * 里就曾逐字写着「契约没有消息创建端口」，与 `chat/live/page.tsx` 那句说的是同一件已经
 * 变假的事。契约包自己也扫：`packages/contracts/**` 的注释里写「契约里没有 X」而 X 就在
 * 隔壁文件声明着，是同一种谎，且离事实源最近、最像权威。
 */
const SCAN_DIRS = ["apps/web", "apps/api", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", "generated", "coverage"]);
const SOURCE_RE = /\.(?:ts|tsx|mts|mjs)$/;

function collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (SOURCE_RE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push({ file: relative(ROOT, full), source: readFileSync(full, "utf8") });
    }
  }
}

/* ── 1. 先证明尺子量得出东西（#473 立的第一条纪律，对本门自己也生效）────────── */
// 「零命中 ⇒ 不存在」是本仓栽过的坑。契约索引为空 / 一个源文件都没扫到时，本门会
// 一条断言都报不出来，那时它的「绿」与「什么都没测」长得一模一样——所以这里不给绿，
// 直接非 0 退出，让扫不全变成一件会红的事，而不是一件安静通过的事。
if (!existsSync(CONTRACT_SRC) || !statSync(CONTRACT_SRC).isDirectory()) {
  console.error(`✗ 找不到契约源目录 ${relative(ROOT, CONTRACT_SRC)} —— 本门无法判定，不给绿。`);
  process.exit(1);
}

const contractFiles = [];
collect(CONTRACT_SRC, contractFiles);
const index = buildContractIndex(contractFiles);

if (index.operations.size === 0) {
  console.error("✗ 契约索引里零个 operation —— 索引器坏了或契约搬家了，本门无法判定，不给绿。");
  process.exit(1);
}

const sources = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (existsSync(abs)) collect(abs, sources);
}
if (sources.length === 0) {
  console.error(`✗ 扫描范围里零个源文件（${SCAN_DIRS.join(", ")}）—— 本门无法判定，不给绿。`);
  process.exit(1);
}

/* ── 2. 判定 ─────────────────────────────────────────────────────────── */
const assertions = sources.flatMap((f) => findNegativeAssertions(f.file, f.source));
const report = judge(assertions, index);
const counts = countByVerdict(report);

let failed = false;

if (report.stale.length > 0) {
  failed = true;
  console.error(`✗ [stale] ${report.stale.length} 条断言说「契约里没有 X」，而 X 就是契约里的一个 operation：`);
  for (const j of report.stale) {
    console.error(`   · ${j.assertion.file}:${j.assertion.line} —— 断言没有 \`${j.identifier}\``);
    console.error(`     契约里它就在 ${j.declaredAt.file}:${j.declaredAt.line}`);
    console.error(`     原文：${j.assertion.text.slice(0, 100)}`);
  }
  console.error("   这句话已经变假了。改注释（说清今天的真实情况）或删掉它——**不要**保留一句");
  console.error("   会说谎的断言：缺失的事实源只会让人去查，说谎的事实源会让人停止查（#473 的 #461 事故）。");
}

/* ── 3. 散文断言走「只减不增」的预算 ────────────────────────────────────── */
// 没点名标识符的断言（`契约里没有「分享线程」操作`）机械上不可判定。逐条判红会把这道门
// 变成全量注释 lint，#473 明确禁止（噪声淹没信号，最后被 skip）。但一条都不管，等于留了
// 一个「去掉反引号就绕过」的后门。折中：记一个总数预算，只能变小。
//   · 变大 ⇒ 你新写了一条无法机械核对的否定性断言。改成点名标识符（`契约里没有
//     \`deleteTemplate\` 操作`）就能被核实；确有理由写散文，就在 diff 里显式抬这个数字，
//     让它出现在 review 里，而不是悄悄溜进去。
//   · 变小 ⇒ 好事，但要把新数字写回来，否则预算会一直虚高，形同没有棘轮
//     （同 rewrite-coverage-allowlist 的先例：陈旧条目判红，棘轮才会自己收紧）。
const budgetDoc = existsSync(BUDGET_PATH) ? JSON.parse(readFileSync(BUDGET_PATH, "utf8")) : null;
if (!budgetDoc || typeof budgetDoc.proseBudget !== "number") {
  failed = true;
  console.error(`✗ 读不到散文断言预算 ${relative(ROOT, BUDGET_PATH)}（应含数字字段 proseBudget）。`);
  console.error(`   今天实测 ${report.proseCount} 条，把它写进去即可。`);
} else if (report.proseCount > budgetDoc.proseBudget) {
  failed = true;
  console.error(
    `✗ [prose-budget] 机械上不可判定的否定性断言 ${report.proseCount} 条 > 预算 ${budgetDoc.proseBudget} 条。`,
  );
  console.error("   新增的那条请用反引号点名契约标识符（operation 名），本门才核实得了它。");
} else if (report.proseCount < budgetDoc.proseBudget) {
  failed = true;
  console.error(
    `✗ [prose-budget] 实测 ${report.proseCount} 条 < 预算 ${budgetDoc.proseBudget} 条 —— 棘轮要收紧。`,
  );
  console.error(`   把 ${relative(ROOT, BUDGET_PATH)} 的 proseBudget 改成 ${report.proseCount}。`);
}

/* ── 4. 逐条结论 ─────────────────────────────────────────────────────── */
console.log(
  `[contract-negative-assertion] 扫了 ${sources.length} 个源文件、${index.operations.size} 个契约 operation、` +
    `${index.fields.size} 个契约字段；扫到 ${assertions.length} 条否定性断言。`,
);
console.log(
  `  STALE=${counts.STALE}  VERIFIED_ABSENT=${counts.VERIFIED_ABSENT}  ` +
    `FIELD_ONLY=${counts.FIELD_ONLY}  PROSE=${counts.PROSE}`,
);

if (process.argv.includes("--list")) {
  for (const j of report.judgements) {
    const id = j.identifier ? ` \`${j.identifier}\`` : "";
    const where = j.declaredAt ? ` ← ${j.declaredAt.file}:${j.declaredAt.line}` : "";
    console.log(`  ${j.verdict.padEnd(15)} ${j.assertion.file}:${j.assertion.line}${id}${where}`);
  }
} else {
  // 被核实过的那些是本门产出的**正面**结论（「这句断言今天成立」），值得默认打出来：
  // 它们是「这把尺子量得出东西」的正样本，没有它们，绿色就没有任何信息量。
  for (const j of report.judgements) {
    if (j.verdict !== "VERIFIED_ABSENT") continue;
    console.log(`  ✓ ${j.assertion.file}:${j.assertion.line} 断言没有 \`${j.identifier}\`——契约里确实查不到它。`);
  }
  for (const j of report.judgements) {
    if (j.verdict !== "FIELD_ONLY") continue;
    console.log(
      `  ~ ${j.assertion.file}:${j.assertion.line} \`${j.identifier}\` 不是 operation，` +
        `只在 ${j.declaredAt.file}:${j.declaredAt.line} 作字段出现——本门不据此判定（字段名不定位契约里的位置）。`,
    );
  }
  console.log("  （加 --list 看全部逐条结论，含 PROSE 那些）");
}

console.log(
  failed
    ? "\n❌ lint-contract-negative-assertion 不通过。"
    : "✅ lint-contract-negative-assertion: 没有已经变假的契约否定性断言。",
);
process.exit(failed ? 1 : 0);
