#!/usr/bin/env node
/**
 * 把 `playwright.parity-eval.config.ts` 的 JSON 结果折成十维得分，写报告到
 * `evidence/design-parity-eval/<round>.md`（+ 同名 .json）。
 *
 *   node apps/web/e2e/parity-eval/score.mjs --round R0 [--in apps/web/test-results/parity-eval/results.json]
 *   node apps/web/e2e/parity-eval/score.mjs --suite depth --round S0   # 深度评测（design-depth.eval.ts）
 *
 * 维度得分 = 该维通过条数 / 该维总条数（0–1），总分 = 十维之和（0–10）。
 * 检查标题以 `[Dx.cy]`（对标）或 `[Vx.cy]`（深度）开头；没有这个前缀的测试不计分（也不该存在）。
 * 一次 playwright 运行可以同时跑两个套件：各套件只取自己前缀的检查。
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

/**
 * 深度评测（S0 起）的维度：R10 收尾时登记的短板——「这项能力有了，但够不够用」。
 * 含义对照 Claude Design 的对应能力；V9 是唯一量代码而不是界面的一维（见 design-depth.eval.ts）。
 */
export const DEPTH_DIMENSIONS = {
  V1: { name: "批注跨设备", what: "批注存在服务端：换浏览器看得到、清存储刷新不丢" },
  V2: { name: "批注讨论", what: "批注可回复、可标记解决、可重新打开" },
  V3: { name: "导出代码能交互", what: "导出的 .tsx 在浏览器里跑：tabs、开关、勾选、底部导航都点得动" },
  V4: { name: "导出代码带图标", what: "按钮、底部导航、图标列表的图标导出为 SVG" },
  V5: { name: "查看代码", what: "编辑器里直接看、复制这份代码，改了设计代码跟着变" },
  V6: { name: "真实图片", what: "把占位图换成上传的真图：画布上显示、刷新还在、导出的代码带着它" },
  V7: { name: "演示模式", what: "全屏演示、方向键翻页与页码、Esc 退出" },
  V8: { name: "变体进阶", what: "方案旁摆着当前页、能提要求再出一组、能选出几个" },
  V9: { name: "代码规模", what: "详情页与设计工作台组件都不超过 1500 行，后续功能有地方放" },
  V10: { name: "导出 PPTX", what: "幻灯片导出为可编辑的 .pptx：页数对、文字在" },
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const suite = arg("suite", "parity");
if (suite !== "parity" && suite !== "depth") { console.error(`--suite 只能是 parity 或 depth：${suite}`); process.exit(2); }
const DIMS = suite === "depth" ? DEPTH_DIMENSIONS : DIMENSIONS;
const PREFIX = suite === "depth" ? "V" : "D";
const OUT = suite === "depth" ? "evidence/design-depth-eval" : "evidence/design-parity-eval";
const TITLE = suite === "depth" ? "深度评测" : "对标评测";
const round = arg("round", suite === "depth" ? "S0" : "R0");
const input = resolve(arg("in", join(ROOT, "apps/web/test-results/parity-eval/results.json")));
if (!existsSync(input)) { console.error(`没有结果文件：${input}（先跑 playwright.parity-eval.config.ts）`); process.exit(2); }
const report = JSON.parse(readFileSync(input, "utf8"));

const checks = [];
const walk = (suite) => {
  for (const s of suite.suites ?? []) walk(s);
  for (const spec of suite.specs ?? []) {
    const m = spec.title.match(/^\[([DV]\d+)\.(c\d+)\]\s*(.*)$/);
    if (m === null || !m[1].startsWith(PREFIX)) continue;
    const results = spec.tests?.[0]?.results ?? [];
    const last = results.at(-1);
    const passed = last?.status === "passed";
    const err = (last?.error?.message ?? "").split("\n").find((l) => l.trim() !== "")?.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 160) ?? "";
    checks.push({ dim: m[1], id: `${m[1]}.${m[2]}`, title: m[3], passed, err });
  }
};
walk(report);

const byDim = Object.keys(DIMS).map((d) => {
  const cs = checks.filter((c) => c.dim === d);
  const passed = cs.filter((c) => c.passed).length;
  return { dim: d, ...DIMS[d], passed, total: cs.length, score: cs.length === 0 ? 0 : passed / cs.length, checks: cs };
});
const total = byDim.reduce((s, d) => s + d.score, 0);
// 记**最后一次改动产品代码**的提交（评测工具本目录不算），不是 HEAD：报告本身随一个只动 evidence 的提交入库，
// 那个提交的 sha 在报告写出来的时候还不存在，记 HEAD 就永远指向「上一个」提交。
const sha = (() => { try { return execSync("git log -1 --format=%h -- apps packages ':!apps/web/e2e/parity-eval'", { cwd: ROOT }).toString().trim(); } catch { return "?"; } })();
// 评测工具自身（本目录）不算「被测代码」：改打分脚本不该让报告说被测的产品有未提交改动。
const dirty = (() => { try { return execSync("git status --porcelain -- apps packages ':!apps/web/e2e/parity-eval'", { cwd: ROOT }).toString().trim() !== ""; } catch { return false; } })();

const lines = [
  `# ${TITLE} ${round}：${total.toFixed(1)} / 10`,
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
const outDir = join(ROOT, OUT);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${round}.md`), lines.join("\n"));
writeFileSync(join(outDir, `${round}.json`), JSON.stringify({ round, sha, dirty, total: Number(total.toFixed(2)), dims: byDim.map(({ checks: cs, ...d }) => ({ ...d, checks: cs.map(({ err: _e, ...c }) => c) })) }, null, 2));
console.log(`${round}: ${total.toFixed(1)} / 10  →  ${OUT}/${round}.md`);
for (const d of byDim) console.log(`  ${d.dim.padEnd(4)} ${d.name.padEnd(8)} ${d.score.toFixed(2)}  (${d.passed}/${d.total})`);
