#!/usr/bin/env node
/**
 * 全局指挥板生成器 —— `pnpm harness dashboard`
 *
 * 与 `harness board`（core-loop 专用 ASCII 板）互补：本命令回答的是
 * 「**整个仓库现在什么状况**」——给任何 agent 开工前 30 秒建立全局感，
 * 也给 coordinator 生成对人类的汇报底稿。
 *
 * ⚠ 铁律同 phase-board：**每次现查活信号，绝不读快照**。
 *   写死的看板会在第一次状态变化时开始说谎。
 *
 * 数据源（全部是会随状况改变的信号）：
 *   · 开放 PR + CI/可合状态      ← `gh pr list --json`
 *   · 近 24h 合并               ← `git log origin/main --since`
 *   · feature 状态分布 + 在编槽  ← 各 phase 的 feature_list.json（权威）
 *   · 等人类签核面               ← design-signoff/delta 里 status: pending（磁盘实读）
 *   · 等人类 Accept 的提案       ← docs/proposals/*.md 头部「状态：Proposed」
 *   · 逐 agent 状态              ← registry.yaml（身份）+ coord-gateway GET /claims
 *     （谁还活着，ADR-017）+ feature owner（在做什么）+ PR headRefName（是否有对应 PR）
 *   · 本机资源                  ← load / wsx 栈数 /（占准入闸的活栈）
 *
 * 输出：stdout 摘要 + `.harness/state/DASHBOARD.md`（带时间戳的派生视图，
 * 头部自带「本文件是派生视图，重跑覆盖，别手改」声明）。
 *
 * 用法：
 *   pnpm harness dashboard              # 全量
 *   pnpm harness dashboard --no-remote  # 跳过 gh/git fetch + coord-gateway 查询（离线/快速模式）
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadavg, cpus } from "node:os";
import { parse as parseYaml } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_REMOTE = process.argv.includes("--no-remote");
const sh = (cmd, args, opts = {}) => {
  try { return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: 30_000, ...opts }).trim(); }
  catch { return null; }
};

/* ── 1. PR 队列 ─────────────────────────────────────────────── */
let prs = [];
if (!NO_REMOTE) {
  const raw = sh("gh", ["pr", "list", "--state", "open", "--limit", "30",
    "--json", "number,title,mergeStateStatus,isDraft,headRefName"]);
  if (raw) prs = JSON.parse(raw);
}

/* ── 2. 近 24h 合并 ──────────────────────────────────────────── */
let merged = [];
if (!NO_REMOTE) {
  sh("git", ["fetch", "origin", "main", "--quiet"]);
  const log = sh("git", ["log", "origin/main", "--since=24 hours ago", "--pretty=%h %s"]);
  merged = log ? log.split("\n").filter(Boolean) : [];
}

/* ── 3. feature 状态分布（权威清单实读）──────────────────────── */
const phasesDir = join(ROOT, "phases");
const phases = [];
/** owner agent id → 该 agent 名下 in_progress 的 feature（跨 phase 聚合），
 *  供下面「逐 agent 状态」板块复用——同一次磁盘扫描，不重复读。 */
const ownerInProgress = new Map();
for (const name of readdirSync(phasesDir).sort()) {
  const p = join(phasesDir, name, "feature_list.json");
  if (!existsSync(p)) continue;
  let fl; try { fl = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
  const fs = Array.isArray(fl) ? fl : fl.features ?? [];
  const by = { not_started: 0, in_progress: 0, blocked: 0, passing: 0 };
  const slots = [];
  for (const f of fs) {
    if (f.status in by) by[f.status] += 1;
    if (f.status === "in_progress") {
      slots.push(`${f.id}(${f.owner ?? "无主"})`);
      if (f.owner) {
        if (!ownerInProgress.has(f.owner)) ownerInProgress.set(f.owner, []);
        ownerInProgress.get(f.owner).push(`${name}/${f.id}`);
      }
    }
  }
  phases.push({ name, total: fs.length, ...by, slots });
}

/* ── 4. 等人类面：pending 签核 + Proposed 提案 ────────────────── */
const pendingSignoffs = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name === "design-signoff.md") {
      const head = readFileSync(full, "utf8").slice(0, 400);
      if (/^status:\s*pending/m.test(head)) pendingSignoffs.push(full.slice(ROOT.length + 1));
    }
  }
};
for (const ph of readdirSync(phasesDir)) {
  walk(join(phasesDir, ph, "contracts"));
  walk(join(phasesDir, ph, "design-deltas"));
}
const proposedDocs = [];
const propDir = join(ROOT, "docs", "proposals");
if (existsSync(propDir)) for (const f of readdirSync(propDir)) {
  if (!f.endsWith(".md")) continue;
  const head = readFileSync(join(propDir, f), "utf8").slice(0, 500);
  if (/状态：\s*Proposed|status:\s*Proposed/i.test(head)) proposedDocs.push(f);
}

/* ── 5. 逐 agent 状态（ADR-010「待建」项，issue #1162）──────────
 * 三个数据源现拼：
 *   a) registry.yaml         → 谁应该在（身份，不代表活着）
 *   b) coord-gateway /claims → 谁真的持有租约、心跳多久前（ADR-017 权威载体；
 *      未配置 COORD_GATEWAY_URL/COORD_API_TOKEN/COORD_REPO 时显式标「未连接」，
 *      不当作「无租约」——fail-open ≠ fail-silent，见 coord-protocol/client.ts 顶部纪律）
 *   c) 上面 §3 扫出的 ownerInProgress + PR headRefName（`worker/<owner>-...`
 *      命名约定，见 AGENTS.md）→ 在做哪个 feature、有没有对应 PR
 * 卡点提示是启发式，不是权威判断——机械信号不足时明写「信号不足」，不猜。 */
let registryAgents = [];
try {
  const reg = parseYaml(readFileSync(join(ROOT, ".harness", "agents", "registry.yaml"), "utf8"));
  registryAgents = (reg.agents ?? []).filter((a) => a.active !== false);
} catch { /* registry 读不出来就是空列表，下面会显式报告 0 个 */ }

let claimsByAgent = null; // null = 未查（未配置或查询失败），Map = 查到了（含 0 条）
if (!NO_REMOTE && process.env.COORD_GATEWAY_URL && process.env.COORD_API_TOKEN && process.env.COORD_REPO) {
  try {
    const base = process.env.COORD_GATEWAY_URL.replace(/\/+$/, "");
    const res = await fetch(`${base}/api/coord/repos/${process.env.COORD_REPO}/claims`, {
      headers: { authorization: `Bearer ${process.env.COORD_API_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const body = await res.json();
      const leases = Array.isArray(body.leases) ? body.leases : [];
      claimsByAgent = new Map();
      for (const lease of leases) {
        if (lease.status !== "active") continue;
        if (!claimsByAgent.has(lease.agent_id)) claimsByAgent.set(lease.agent_id, []);
        claimsByAgent.get(lease.agent_id).push(lease);
      }
    }
  } catch { /* claimsByAgent 留 null——下面显式报告「查询失败」而不是假装空 */ }
}

const agentRows = registryAgents.map((a) => {
  const leases = claimsByAgent?.get(a.id) ?? [];
  const inProgress = ownerInProgress.get(a.id) ?? [];
  const ownPrs = prs.filter((p) => p.headRefName?.startsWith(`worker/${a.id}-`) || p.headRefName === `worker/${a.id}`);

  let leaseText;
  if (claimsByAgent === null) leaseText = "（coord-gateway 未连接，查不到）";
  else if (leases.length === 0) leaseText = "（无活跃租约）";
  else leaseText = leases.map((l) => {
    const ageMin = (Date.now() - new Date(l.last_heartbeat_at).getTime()) / 60_000;
    const flag = ageMin > 30 ? "⚠ " : "";
    return `${flag}${l.resource_id}（心跳 ${ageMin.toFixed(0)}m 前）`;
  }).join("、");

  let hint;
  const staleLease = leases.some((l) => (Date.now() - new Date(l.last_heartbeat_at).getTime()) / 60_000 > 30);
  if (staleLease) hint = "⚠ 心跳超 30 分钟，可能掉线，人类需确认/回收";
  else if (inProgress.length > 0 && ownPrs.length === 0) hint = "在编但未见对应 PR——可能还在写，或已经写完没开 PR";
  else if (ownPrs.some((p) => !p.isDraft && p.mergeStateStatus && p.mergeStateStatus !== "CLEAN")) hint = "PR 待处理（review/CI/冲突），人类或 reviewer 可介入";
  else if (inProgress.length === 0 && ownPrs.length === 0 && leases.length === 0) hint = claimsByAgent === null ? "信号不足（未连 coord-gateway）" : "空闲";
  else hint = "运行中";

  return { id: a.id, kind: a.kind ?? "?", leaseText, inProgress, ownPrs, hint };
});

/* ── 6. 本机资源 ─────────────────────────────────────────────── */
const load1 = loadavg()[0].toFixed(1);
const cores = cpus().length;
const stacks = (sh("docker", ["ps", "--format", "{{.Names}}"]) ?? "")
  .split("\n").filter((n) => n.startsWith("wsx-"));
const stackProjects = new Set(stacks.map((n) => n.replace(/-(postgres|redis|minio)-\d+$/, "")));

/* ── 汇总渲染 ────────────────────────────────────────────────── */
const now = new Date().toISOString().replace("T", " ").slice(0, 16);
const lines = [];
lines.push(`# 全局指挥板（派生视图 —— \`pnpm harness dashboard\` 重跑覆盖，别手改）`);
lines.push(``);
lines.push(`> 生成于 ${now}（本机时区）。所有数字来自现查的活信号；读到本文件时它可能已过期，`);
lines.push(`> 要现状请重跑命令，不要引用本文件里的数字做决策依据（静态痕迹 ≠ 动态事实）。`);
lines.push(``);
lines.push(`## PR 队列（${prs.length} 开放）`);
if (prs.length === 0) lines.push(NO_REMOTE ? `（--no-remote 跳过）` : `（空）`);
for (const p of prs) lines.push(`- #${p.number} [${p.isDraft ? "draft" : p.mergeStateStatus}] ${p.title}`);
lines.push(``);
lines.push(`## 近 24h 合入 main（${merged.length}）`);
for (const m of merged.slice(0, 25)) lines.push(`- ${m}`);
if (merged.length > 25) lines.push(`- …另 ${merged.length - 25} 条`);
lines.push(``);
lines.push(`## feature 状态（权威清单实读）`);
lines.push(`| phase | 总数 | passing | in_progress（在编槽） | blocked | not_started |`);
lines.push(`|---|---:|---:|---|---:|---:|`);
for (const ph of phases) {
  lines.push(`| ${ph.name} | ${ph.total} | ${ph.passing} | ${ph.in_progress}${ph.slots.length ? `：${ph.slots.join("、")}` : ""} | ${ph.blocked} | ${ph.not_started} |`);
}
lines.push(``);
lines.push(`## 等人类（签核/Accept 面）`);
lines.push(`- pending 签核 ${pendingSignoffs.length} 份：`);
for (const s of pendingSignoffs) lines.push(`  - \`${s}\``);
lines.push(`- Proposed 提案 ${proposedDocs.length} 份：${proposedDocs.map((d) => `\`${d}\``).join("、") || "（无）"}`);
lines.push(``);
lines.push(`## 逐 agent 状态（registry.yaml ${registryAgents.length} 个在册 active agent）`);
if (claimsByAgent === null && !NO_REMOTE) {
  lines.push(`> ⚠ coord-gateway 未连接（缺 COORD_GATEWAY_URL/COORD_API_TOKEN/COORD_REPO，或查询失败）——`);
  lines.push(`> 下表「租约」列查不到，不代表这些 agent 空闲，是这次没问到（fail-open ≠ fail-silent）。`);
}
if (agentRows.length === 0) {
  lines.push(`（registry.yaml 读取失败或没有 active agent）`);
} else {
  lines.push(`| agent | kind | 租约（心跳） | 在编 feature | 关联 PR | 卡点提示 |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of agentRows) {
    const prText = r.ownPrs.length ? r.ownPrs.map((p) => `#${p.number}[${p.isDraft ? "draft" : p.mergeStateStatus}]`).join("、") : "（无）";
    lines.push(`| ${r.id} | ${r.kind} | ${r.leaseText} | ${r.inProgress.join("、") || "（无）"} | ${prText} | ${r.hint} |`);
  }
}
lines.push(``);
lines.push(`## 本机资源`);
lines.push(`- load1=${load1} / ${cores} 核（perCore=${(load1 / cores).toFixed(2)}；>1.5 别开重活）`);
lines.push(`- wsx 隔离栈 ${stackProjects.size} 套（准入闸上限 2；verify:base 自身需 2 套——见 #1032）`);
lines.push(``);

const out = lines.join("\n");
writeFileSync(join(ROOT, ".harness", "state", "DASHBOARD.md"), out);
console.log(out);
console.log(`→ 已写入 .harness/state/DASHBOARD.md`);
