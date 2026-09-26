#!/usr/bin/env node
/**
 * 把 `playwright.kg-experience-eval.config.ts` 的 JSON 结果折成十维得分，写到
 * `evidence/kg-experience-eval/<round>.md` + `<round>.json`，每条检查的截图写到 `shots/<round>/<id>.jpg`。
 *
 *   node apps/web/e2e/kg-experience-eval/score.mjs --round R0 [--in apps/web/test-results/kg-experience-eval/results.json]
 *   node apps/web/e2e/kg-experience-eval/score.mjs --round R0 --freeze   # 只在 R0：把检查清单与指纹写进锁文件
 *
 * 每条检查的证据 = 它在浏览器里留下的截图（`shot`）+ 量到的数（`measure`，如每道题的回答、首字毫秒数）。
 * 没有证据的检查不算数：门会拒绝。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { CHECK_TITLE, DIMENSIONS, EVIDENCE_DIR, LOCK_FILE, PASS_MARK, REPO_ROOT, rubricHash, scoreChecks } from "./rubric.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const round = arg("round", null);
if (round === null || !/^R\d+$/.test(round)) { console.error("--round R<n> is required"); process.exit(2); }
const input = resolve(arg("in", join(REPO_ROOT, "apps/web/test-results/kg-experience-eval/results.json")));
if (!existsSync(input)) { console.error(`没有结果文件：${input}（先跑 playwright.kg-experience-eval.config.ts）`); process.exit(2); }
const report = JSON.parse(readFileSync(input, "utf8"));

const outDir = join(REPO_ROOT, EVIDENCE_DIR);
const shotDir = join(outDir, "shots", round);
rmSync(shotDir, { recursive: true, force: true });
mkdirSync(shotDir, { recursive: true });

const checks = [];
const walk = (suite) => {
  for (const s of suite.suites ?? []) walk(s);
  for (const spec of suite.specs ?? []) {
    const m = spec.title.match(CHECK_TITLE);
    if (m === null) continue;
    const id = `${m[1]}.${m[2]}`;
    const last = (spec.tests?.[0]?.results ?? []).at(-1);
    const passed = last?.status === "passed";
    const err = (last?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim() !== "")?.slice(0, 200) ?? "";
    const measures = [];
    const shots = [];
    for (const a of last?.attachments ?? []) {
      const body = a.body !== undefined ? Buffer.from(a.body, "base64") : a.path && existsSync(a.path) ? readFileSync(a.path) : null;
      if (body === null) continue;
      if (a.name === "measure") measures.push(JSON.parse(body.toString("utf8")));
      if (a.name === "shot") {
        const file = `shots/${round}/${id}${shots.length === 0 ? "" : `-${shots.length + 1}`}.jpg`;
        writeFileSync(join(outDir, file), body);
        shots.push(file);
      }
    }
    checks.push({ dim: m[1], id, title: m[3], passed, err, evidence: { shots, measures } });
  }
};
walk(report);
checks.sort((a, b) => Number(a.dim.slice(1)) - Number(b.dim.slice(1)) || a.id.localeCompare(b.id));

const { dims, total } = scoreChecks(checks);
const hash = rubricHash();
const sha = (() => { try { return execSync("git log -1 --format=%h -- apps packages", { cwd: REPO_ROOT }).toString().trim(); } catch { return "?"; } })();
const dirty = (() => { try { return execSync("git status --porcelain -- apps packages", { cwd: REPO_ROOT }).toString().trim() !== ""; } catch { return false; } })();
const byDim = dims.map((d) => ({ ...d, checks: checks.filter((c) => c.dim === d.dim) }));

const md = [
  `# 记忆体验评测 ${round}：${total.toFixed(1)} / 10`,
  "",
  `> 代码版本 \`${sha}\`${dirty ? "（工作区有未提交改动）" : ""} · ${checks.filter((c) => c.passed).length}/${checks.length} 条检查通过 · 门槛 ${PASS_MARK.toFixed(1)} · 检查指纹 \`${hash.slice(0, 12)}\` · 由 \`apps/web/e2e/kg-experience-eval/score.mjs\` 生成`,
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
    ...d.checks.map((c) => {
      const lines = [`- ${c.passed ? "✅" : "❌"} \`${c.id}\` ${c.title}`];
      if (!c.passed && c.err !== "") lines.push(`  - ${c.err.replace(/\|/g, "\\|")}`);
      for (const m of c.evidence.measures) lines.push(`  - 量到：\`${JSON.stringify(m).slice(0, 300).replace(/`/g, "'")}\``);
      for (const s of c.evidence.shots) lines.push(`  - 截图：[${s}](${s})`);
      return lines.join("\n");
    }),
    "",
  ]),
];
writeFileSync(join(outDir, `${round}.md`), md.join("\n"));
writeFileSync(join(outDir, `${round}.json`), JSON.stringify({
  round, sha, dirty, rubricHash: hash, total, passMark: PASS_MARK,
  dims: byDim.map(({ checks: cs, ...d }) => ({ ...d, checks: cs.map(({ err, ...c }) => ({ ...c, ...(c.passed ? {} : { failure: err }) })) })),
}, null, 2));

if (process.argv.includes("--freeze")) {
  if (round !== "R0") { console.error("--freeze 只在 R0 用：之后的改动走锁文件里的修订记录"); process.exit(2); }
  writeFileSync(join(REPO_ROOT, LOCK_FILE), JSON.stringify({
    frozenAt: "R0",
    r0Hash: hash,
    checks: checks.map((c) => c.id),
    amendments: [],
  }, null, 2) + "\n");
}

console.log(`${round}: ${total.toFixed(1)} / 10  →  ${EVIDENCE_DIR}/${round}.md`);
for (const d of byDim) console.log(`  ${d.dim.padEnd(4)} ${d.name.padEnd(6)} ${d.score.toFixed(2)}  (${d.passed}/${d.total})`);
void DIMENSIONS;
