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

/* ── PR 等待时长（人类 2026-08-05：「一旦提交了 PR 必须马上合并，要避免等待」）──
 *
 * 等待是**免费的**，所以它会一直变长而没人报警：CI 早就绿了，PR 静静躺着，
 * 而看板上那条 issue 仍显示「进行中」。本仓今天就这样晾过四个全绿的 PR。
 *
 * ⇒ 把「全绿之后还等了多久」变成一个会亮红的数字。SLA 是**从全绿算起**，
 *   不是从开 PR 算起 —— 等 CI 不是浪费，等人才是。 */
const prs = gh(["pr", "list", "--state", "open", "--limit", "50",
  "--json", "number,title,createdAt,isDraft,statusCheckRollup,mergeStateStatus"]) ?? [];
/** 全绿 PR 允许的最长等待（分钟）。超过就是有人在等人，不是在等机器。 */
const MERGE_SLA_MIN = 30;
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
  if (!c) return { txt: "未承诺", late: false, delta: "无期限", step: "—", next: null, blockedBy: null,
    note: "⚠ 没有承诺时间 —— 没有 deadline 的活会无限期漂着，也没人知道下一步该做什么" };
  const d = new Date(c.due);
  const late = NOW > d;
  const mins = Math.round(Math.abs(NOW - d) / 60000);
  return {
    txt: hhmm(cn(c.due)),
    late,
    note: c.note,
    next: c.next ?? null,
    blockedBy: c.blocked_by ?? null,
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

/* ── 一句话结论 + 瓶颈 ────────────────────────────────────────
 *
 * 看板最容易变成「一堆真实数字，但没人知道该干嘴」。所以第一屏必须回答
 * 三个问题：现在什么状态 / 卡在哪 / 谁的下一步是什么。
 *
 * ⚠ 瓶颈是**算出来的**，不是写死的一句话：写死的瓶颈会在情况变化后
 *   继续言之凿凿，而那比没有更糟。判据按优先级：
 *   ① 人类阻断项未解 —— 它挡的是「能不能上线」，比任何代码进度都靠前；
 *   ② 有 issue 被别的 issue 挡着 —— 那条挡路的就是瓶颈；
 *   ③ 否则瓶颈是「谁手上的红步骤最多」。 */
const red = steps.length - green;
const blocked = open.filter((i) => cfg.commitments[String(i.number)]?.blocked_by);
let bottleneck, bottleneckWhy;
if (cfg.human_blockers.length > 0) {
  bottleneck = `人类阻断项 ${cfg.human_blockers.length} 条（见本页最下方）`;
  bottleneckWhy = "八步全绿也上不了线 —— 这两件只有人类做得了，且一条命令能解开两个";
} else if (blocked.length > 0) {
  const b = cfg.commitments[String(blocked[0].number)].blocked_by;
  bottleneck = `#${blocked[0].number} 被 ${b} 挡着`;
  bottleneckWhy = "解开那一条，下游才动得了";
} else {
  const worst = [...byOwner].sort((a, b) => b[1].length - a[1].length)[0];
  bottleneck = worst ? `${worst[0]}（手上 ${worst[1].length} 条）` : "无";
  bottleneckWhy = "没有依赖阻塞，瓶颈就是最长的那条串行链";
}

row(`状态   ${green}/${steps.length} 步真绿 · ${red} 步红 · ${open.length} 个 issue 未关 · ${prs.length} 个 PR 未合`);
row("");
row(`🔻 当前瓶颈   ${bottleneck}`);
for (const l of wrap(bottleneckWhy, W - 8)) row(`   ${l}`);
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
    // 「下一步」是这块看板对 owner 的全部要求：不写它，看板就只是一份状态陈列。
    if (d.next) for (const l of wrap("▶ 下一步：" + d.next, W - 14)) row("         " + l);
    if (d.blockedBy) row(`         ⛔ 被 ${d.blockedBy} 挡着 —— 那条不动，这条做不了`);
  }
  row("");
}
rule();

/* ── PR 等待时长 ─────────────────────────────────────────── */
row(`PR 队列   ${prs.length} 个 open      SLA：全绿后 ${MERGE_SLA_MIN} 分钟内必须合或说明为什么不合`);
row("");
if (prs.length === 0) row("  （空）");
for (const pr of prs) {
  const checks = pr.statusCheckRollup ?? [];
  const bad = checks.filter((c) => c.conclusion === "FAILURE" || c.conclusion === "CANCELLED");
  const pending = checks.filter((c) => (c.status ?? "") !== "COMPLETED" && !c.conclusion);
  // 「全绿多久了」用最后一条检查的完成时刻，不是 PR 创建时刻：等 CI 不算等待。
  const doneAt = checks.map((c) => c.completedAt).filter(Boolean).sort().at(-1);
  const ageMin = Math.round((NOW - new Date(pr.createdAt)) / 60000);
  let state, flag = "";
  if (pr.isDraft) state = "DRAFT";
  else if (bad.length) state = `红 ${bad.map((c) => c.name).join(",")}`;
  else if (pending.length) state = `跑中 ${pending.length}`;
  else {
    const waited = doneAt ? Math.round((NOW - new Date(doneAt)) / 60000) : 0;
    state = `全绿 已等 ${waited}m`;
    if (waited > MERGE_SLA_MIN) flag = "  !! 超 SLA，为什么还没合";
  }
  row(`  #${String(pr.number).padEnd(4)} ${pad(state, 30)} 开了 ${ageMin}m${flag}`);
  row(`        ${trunc(pr.title, 60)}`);
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
