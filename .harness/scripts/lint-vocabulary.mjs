#!/usr/bin/env node
/**
 * lint-vocabulary.mjs —— 词汇单一事实源门控。
 *
 * ## 为什么要有这一道
 *
 * 本仓的铁律是「同一事实不得声明在两处」。**名字也是事实。**
 * 已经栽过一次：MAAU 同时指「画布产物」与「商业分发单元」，
 * 文档与代码各说各的，直到有人逐行读代码才发现。
 *
 * 2026-09-23 统一两组叫法（登记在 `PROJECT.md` 的「词汇单一事实源」节）：
 *   - 商业与分发单元 → **技能包**（不再叫 MAAU；仓库本来就有 skill pack 这个词）
 *   - 平台层面的记忆 → **平台大脑**（不再叫「我们自己的组织大脑」，也不再叫「团队记忆」——
 *     后者把范围说小了，它装的是跨所有实例的运行事实与工作、创新、学习的全部积累；
 *     「组织大脑」是产品概念，指客户把产出物沉淀进本组织知识库）
 *
 * 没有脚本的规范视为未落地，所以有本文件。
 *
 * ## 检查什么
 *
 * 只扫**面向人的散文**（`docs/`、`.harness/instructions/`、`.agents/`），
 * 不扫代码与标识符——标识符允许滞后于叫法（`@repo/maau-*`、
 * `capability_id`、目录名都保持原样，改它们波及 40 个代码文件）。
 *
 * 豁免：变更记录与术语对照表要引用旧词才能说明改名，靠 `ALLOW_CONTEXT` 放行。
 *
 * 用法：
 *   node .harness/scripts/lint-vocabulary.mjs
 *   node .harness/scripts/lint-vocabulary.mjs --strict
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN = ["docs", ".harness/instructions", ".agents"];

/**
 * 迭代记录是**逐轮追加的历史**：它记录的是当时说了什么、当时叫什么。
 * 改写它就把痕迹抹了（本仓铁律：静态记录不是活事实，但也不许伪造）。
 * 所以整份豁免，叫法以现行方案正文的术语节为准。
 */
const HISTORY_FILES = [/-iterations(-\d+)?\.md$/];

/** 被取代的叫法。`why` 写进报错，让人知道该用什么。 */
const RETIRED = [
  { re: /我们自己的组织大脑/g, use: "平台大脑",
    why: "「组织大脑」是产品概念（客户的）；我们自己那份叫平台大脑" },
  { re: /团队记忆/g, use: "平台大脑",
    why: "团队记忆把范围说小了：它是平台层面的记忆，含跨实例运行事实与工作、创新、学习的积累（2026-09-23 定）" },
  // `MAAU 画布`（maau-canvas，WX-S021）是**设计方法**，保留原名，故排除后接「 画布」。
  { re: /(?<![A-Za-z`\/-])MAAU(?![-`])/g, use: "技能包",
    why: "商业与分发单元统一叫技能包；MAAU 画布（maau-canvas）是设计方法，另一回事" },
];

/**
 * 代码标识符不算叫法，逐个放行：反引号包起来的、路径里的、连字符命名的。
 * 先把这些片段从行里剔掉再匹配，比在正则里堆负向断言可读。
 */
function stripIdentifiers(line) {
  return line
    .replace(/`[^`]*`/g, " ")            // 反引号代码
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")   // 链接
    // 标识符里的 maau 一律小写（maau-canvas、@repo/maau-*、lint-maau-manifest）。
    // 这里**必须区分大小写**：加 `i` 会把散文里的大写 MAAU 一并剔掉，
    // 门就永远是绿的——2026-09-23 实测踩过，0 命中是假的。
    .replace(/[\w@./-]*maau[\w@./-]*/g, " ")
    .replace(/@[\w.]+/g, " ")           // @文件名.png 这类引用是字面量
    .replace(/MAAU\u0020?画布/g, " ");  // 设计方法，保留原名
}

/** 允许出现旧词的上下文：说明改名本身。 */
const ALLOW_CONTEXT = [
  /变更记录/, /此前/, /不再叫/, /改名/, /改叫/, /旧词/, /旧用法/, /一词两义/,
  /术语/, /取代/, /曾/, /原名/, /lint-vocabulary/,
];

/** 变更记录整节豁免：它的职责就是逐版复述当时的叫法。 */
const HISTORY_HEADING = /^#{1,6}\s*变更记录/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".git")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".md")) out.push(p);
  }
  return out;
}

const findings = [];
for (const root of SCAN) {
  for (const file of walk(join(ROOT, root))) {
    const rel = relative(ROOT, file);
    if (HISTORY_FILES.some((re) => re.test(rel))) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let inHistory = false;
    lines.forEach((line, i) => {
      if (/^#{1,6}\s/.test(line)) inHistory = HISTORY_HEADING.test(line);
      if (inHistory) return;
      if (ALLOW_CONTEXT.some((re) => re.test(line))) return;
      const probe = stripIdentifiers(line);
      for (const rule of RETIRED) {
        rule.re.lastIndex = 0;
        const m = rule.re.exec(probe);
        if (m) findings.push({ file: rel, line: i + 1, hit: m[0].trim(), use: rule.use, why: rule.why });
      }
    });
  }
}

console.log(`词汇检查：扫描 ${SCAN.join(" / ")} 下的 Markdown，命中 ${findings.length} 处`);
if (findings.length) {
  console.log("");
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}`);
    console.log(`    用了「${f.hit}」→ 应为「${f.use}」`);
    console.log(`    ${f.why}`);
  }
  console.log("\n说明改名本身时可以引用旧词——在同一行里写上「此前叫」「变更记录」等即可放行。");
} else {
  console.log("✅ 没有已取代的叫法");
}

if (process.argv.includes("--strict") && findings.length) {
  console.error("\nstrict：存在已取代的叫法，未通过。");
  process.exit(1);
}
