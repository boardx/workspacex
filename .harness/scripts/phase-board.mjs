#!/usr/bin/env node
/**
 * 阶段看板 —— 纯 ASCII，给人类一眼看清：
 *   谁在干活 · 当前目标 · 范围边界 · 各自挂着哪些 issue ·
 *   承诺时间 · 是否已经超时 · 总协调者的目标时间 · 必须人类做的事
 *
 * ⚠ 它**每次都现查 GitHub 与进度板**，不是一张写死的快照 ——
 *   写死的看板会在第一次状态变化时开始说谎，而说谎的看板比没有看板更糟。
 *
 * 数据源（三处，都是真的）：
 *   · issue 与 owner  ← `gh issue list --label core-loop`（标签是机械二分的）
 *   · 八步真实状态     ← `apps/web/e2e/core-loop.spec.ts` 里 `test(` vs `test.fail(`
 *   · 承诺时间与人类阻断项 ← `.harness/state/core-loop-commitments.json`
 *
 * 用法：pnpm harness board   或   node .harness/scripts/phase-board.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const W = 78;

/** 现在时刻。允许用 BOARD_NOW 覆盖，这样「超时」这条逻辑本身可以被测试。 */
const NOW = new Date(process.env.BOARD_NOW ?? Date.now());

const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));
/** 中日韩字符占两列。不算这个，所有竖线都会歪。 */
const width = (s) => [...s].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
const line = (ch = "─") => ch.repeat(W);
const row = (s) => console.log("│ " + pad(s, W - 1) + "│");
const rule = () => console.log("├" + line() + "┤");
const top = (t) => { console.log("┌" + line() + "┐"); row(t); console.log("├" + line() + "┤"); };
const bot = () => console.log("└" + line() + "┘");

function gh(args) {
  try { return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 24 })); }
  catch { return null; }
}

const cfg = JSON.parse(readFileSync(join(ROOT, ".harness/state/core-loop-commitments.json"), "utf8"));

/* ── 1. 八步真实状态：直接读进度板，不读任何人的说法 ──────────────────── */
const spec = readFileSync(join(ROOT, "apps/web/e2e/core-loop.spec.ts"), "utf8");
const steps = [...spec.matchAll(/^\s*(test(?:\.fail)?)\(\s*[`"](.+?)[`"]/gm)]
  .map(([, kind, title]) => ({
    green: kind === "test",
    title: title.replace(/\$\{EMPTY_DB_TAG\}\s*/, "").trim(),
    issues: [...title.matchAll(/#(\d+)/g)].map((m) => m[1]),
  }));
const green = steps.filter((s) => s.green).length;

/* ── 2. issue 与 owner ─────────────────────────────────────────────── */
const open = gh(["issue", "list", "--state", "open", "--label", "core-loop", "--limit", "100",
  "--json", "number,title,labels"]) ?? [];
const closed = gh(["issue", "list", "--state", "closed", "--label", "core-loop", "--limit", "200",
  "--json", "number"]) ?? [];
const ownerOf = (i) => (i.labels.find((l) => l.name.startsWith("owner:"))?.name ?? "owner:未指派").slice(6);

const byOwner = new Map();
for (const i of open) {
  if (!byOwner.has(ownerOf(i))) byOwner.set(ownerOf(i), []);
  byOwner.get(ownerOf(i)).push(i);
}

/* ── 3. 超时判定 ───────────────────────────────────────────────────── */
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const cn = (iso) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: cfg._tz }));
function dueOf(num) {
  const c = cfg.commitments[num];
  if (!c) return { txt: "未承诺", late: false, note: "⚠ 没有承诺时间 —— 没有 deadline 的活会无限期漂着" };
  const d = new Date(c.due);
  const late = NOW > d;
  const mins = Math.round(Math.abs(NOW - d) / 60000);
  return {
    txt: hhmm(cn(c.due)),
    late,
    note: c.note,
    step: c.step,
    delta: late ? `已超时 ${Math.floor(mins / 60)}h${mins % 60}m` : `还剩 ${Math.floor(mins / 60)}h${mins % 60}m`,
  };
}

/* ── 输出 ──────────────────────────────────────────────────────────── */
console.log();
top(`阶段看板 · 八步核心闭环          ${hhmm(NOW)}  (${cfg._tz})`);
row("");
row("目标");
for (const l of wrap(cfg.goal, W - 7)) row("  " + l);
row("");
row("范围");
for (const l of wrap(cfg.scope_rule, W - 7)) row("  " + l);
rule();

row(`进度板   ${green}/${steps.length} 步真绿      （数据源：core-loop.spec.ts，不是谁的说法）`);
row("");
for (const s of steps) {
  const mark = s.green ? "[✔]" : "[✘]";
  const tail = s.green ? "" : "  ← " + (s.issues.length ? s.issues.map((n) => "#" + n).join(" ") : "无 issue");
  row(`  ${mark} ${trunc(s.title, 52)}${tail}`);
}
rule();

row(`Issue 台账   ${closed.length} 已关闭 / ${open.length} 仍 open`);
row("");
for (const [owner, items] of [...byOwner].sort((a, b) => b[1].length - a[1].length)) {
  const lates = items.filter((i) => dueOf(String(i.number)).late).length;
  row(`■ ${owner}   ${items.length} 项${lates ? `   🔴 ${lates} 项已超时` : ""}`);
  for (const i of items) {
    const d = dueOf(String(i.number));
    const flag = d.late ? `!! ${d.delta}` : d.delta;
    row(`   #${String(i.number).padEnd(4)} ${d.txt.padEnd(6)} ${pad(flag, 14)} 步骤 ${d.step ?? "—"}`);
    row(`         ${trunc(i.title, 62)}`);
    if (d.note) for (const l of wrap("· " + d.note, W - 14)) row("         " + l);
  }
  row("");
}
rule();

const ct = new Date(cfg.coordinator_target);
const ctLate = NOW > ct;
row(`coord-main 总目标   ${hhmm(cn(cfg.coordinator_target))}   ${ctLate ? "🔴 已超时" : "还剩 " + Math.round((ct - NOW) / 60000) + " 分钟"}`);
row("  八步全绿 = 交付完成。在此之前 out-of-scope 的工作一律是抢工时。");
rule();

row("🔴 必须由你（人类）完成 —— 我做不了，做完之前八步全绿也上不了线");
row("");
cfg.human_blockers.forEach((b, n) => {
  row(`  ${n + 1}. ${b.title}`);
  for (const l of wrap("为什么：" + b.why, W - 9)) row("     " + l);
  for (const l of wrap("挡住了：" + b.blocks, W - 9)) row("     " + l);
  row("     $ " + trunc(b.cmd, W - 12));
  row("");
});
bot();
console.log();

function wrap(s, n) {
  const out = []; let cur = "";
  for (const ch of s) { if (width(cur + ch) > n) { out.push(cur); cur = ""; } cur += ch; }
  if (cur) out.push(cur);
  return out;
}
function trunc(s, n) {
  if (width(s) <= n) return s;
  let cur = "";
  for (const ch of s) { if (width(cur + ch) > n - 1) break; cur += ch; }
  return cur + "…";
}
