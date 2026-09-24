#!/usr/bin/env node
/**
 * 把 `playwright.parity-eval.config.ts` 的 JSON 结果折成十维得分，写报告到
 * `evidence/design-parity-eval/<round>.md`（+ 同名 .json）。
 *
 *   node apps/web/e2e/parity-eval/score.mjs --round R0 [--in apps/web/test-results/parity-eval/results.json]
 *
 * 维度得分 = 该维通过条数 / 该维总条数（0–1），总分 = 十维之和（0–10）。
 * 检查标题以 `[Dx.cy]` 开头；没有这个前缀的测试不计分（也不该存在）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** 维度定义的唯一出处。含义对照 Claude Design 公开的产品行为。 */
export const DIMENSIONS = {
  D1: { name: "视觉定制", what: "明暗主题、强调色落到每一页、任意品牌色、字体" },
  D2: { name: "设计系统", what: "圆角 / 密度 / 字体一处改处处变，存得住，导出跟着走" },
  D3: { name: "产出类型", what: "手机 App、桌面 Web 应用、官网落地页、幻灯片" },
  D4: { name: "组件表达力", what: "表格、带数据的图表、下拉与单选、弹窗叠层" },
  D5: { name: "生成体验", what: "生成中可见进度与取消、取消不丢草稿、下一步建议、照图画" },
  D6: { name: "直接编辑", what: "属性面板、撤销、重做、画布上直接改字、拖拽排序" },
  D7: { name: "批注", what: "钉在元素上的批注、批注列表、一次交给 AI 改" },
  D8: { name: "变体", what: "一次出多个方案并排比、选一个替换、选了能撤销" },
  D9: { name: "可交互原型", what: "预览里点导航换页、tabs 切换、开关勾选、能打字" },
  D10: { name: "交付交接", what: "可点击 HTML、PDF、图片与文档、分享链接、代码" },
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const round = arg("round", "R0");
const input = resolve(arg("in", join(ROOT, "apps/web/test-results/parity-eval/results.json")));
if (!existsSync(input)) { console.error(`没有结果文件：${input}（先跑 playwright.parity-eval.config.ts）`); process.exit(2); }
const report = JSON.parse(readFileSync(input, "utf8"));

const checks = [];
const walk = (suite) => {
  for (const s of suite.suites ?? []) walk(s);
  for (const spec of suite.specs ?? []) {
    const m = spec.title.match(/^\[(D\d+)\.(c\d+)\]\s*(.*)$/);
    if (m === null) continue;
    const results = spec.tests?.[0]?.results ?? [];
    const last = results.at(-1);
    const passed = last?.status === "passed";
    const err = (last?.error?.message ?? "").split("\n").find((l) => l.trim() !== "")?.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 160) ?? "";
    checks.push({ dim: m[1], id: `${m[1]}.${m[2]}`, title: m[3], passed, err });
  }
};
walk(report);

const byDim = Object.keys(DIMENSIONS).map((d) => {
  const cs = checks.filter((c) => c.dim === d);
  const passed = cs.filter((c) => c.passed).length;
  return { dim: d, ...DIMENSIONS[d], passed, total: cs.length, score: cs.length === 0 ? 0 : passed / cs.length, checks: cs };
});
const total = byDim.reduce((s, d) => s + d.score, 0);
// 记**最后一次改动产品代码**的提交（评测工具本目录不算），不是 HEAD：报告本身随一个只动 evidence 的提交入库，
// 那个提交的 sha 在报告写出来的时候还不存在，记 HEAD 就永远指向「上一个」提交。
const sha = (() => { try { return execSync("git log -1 --format=%h -- apps packages ':!apps/web/e2e/parity-eval'", { cwd: ROOT }).toString().trim(); } catch { return "?"; } })();
// 评测工具自身（本目录）不算「被测代码」：改打分脚本不该让报告说被测的产品有未提交改动。
const dirty = (() => { try { return execSync("git status --porcelain -- apps packages ':!apps/web/e2e/parity-eval'", { cwd: ROOT }).toString().trim() !== ""; } catch { return false; } })();

const lines = [
  `# 对标评测 ${round}：${total.toFixed(1)} / 10`,
  "",
  `> 代码版本 \`${sha}\`${dirty ? "（工作区有未提交改动）" : ""} · ${checks.filter((c) => c.passed).length}/${checks.length} 条检查通过 · 由 \`apps/web/e2e/parity-eval/score.mjs\` 生成`,
  "",
  "| 维度 | 得分 | 通过 | 量什么 |",
  "|---|---|---|---|",
  ...byDim.map((d) => `| ${d.dim} ${d.name} | ${d.score.toFixed(2)} | ${d.passed}/${d.total} | ${d.what} |`),
  `| **合计** | **${total.toFixed(1)}** | ${checks.filter((c) => c.passed).length}/${checks.length} | |`,
  "",
  "## 逐条",
  "",
  ...byDim.flatMap((d) => [
    `### ${d.dim} ${d.name}（${d.passed}/${d.total}）`,
    "",
    ...d.checks.map((c) => `- ${c.passed ? "✅" : "❌"} \`${c.id}\` ${c.title}${c.passed || c.err === "" ? "" : `\n  - ${c.err.replace(/\|/g, "\\|")}`}`),
    "",
  ]),
];
const outDir = join(ROOT, "evidence/design-parity-eval");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${round}.md`), lines.join("\n"));
writeFileSync(join(outDir, `${round}.json`), JSON.stringify({ round, sha, dirty, total: Number(total.toFixed(2)), dims: byDim.map(({ checks: cs, ...d }) => ({ ...d, checks: cs.map(({ err: _e, ...c }) => c) })) }, null, 2));
console.log(`${round}: ${total.toFixed(1)} / 10  →  evidence/design-parity-eval/${round}.md`);
for (const d of byDim) console.log(`  ${d.dim.padEnd(4)} ${d.name.padEnd(8)} ${d.score.toFixed(2)}  (${d.passed}/${d.total})`);
