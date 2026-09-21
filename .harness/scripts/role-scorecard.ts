/**
 * `pnpm harness scorecard [--role <id>]` —— 角色记分卡。
 *
 * 人类 2026-08-12 指令："让 main、domain agent、subagent 很清楚当前他们的目标是什么、
 * blocker 是什么、需要谁的帮忙，一眼可以看到；同时需要有一个验收标准，每个人都知道
 * 自己的现状分数、目标分数是什么"。
 *
 * 一屏四问：**① 我的目标（现状→目标） ② 我的 blocker ③ 我在等谁 ④ 我的下一个动作**。
 *
 * ## 它不产生任何分数
 *
 * 现状分一律来自 `computeReadiness()`——与 `pnpm harness readiness` **同一次判定、
 * 同一套门（G1-G6）**。两处各算一遍迟早漂移，而漂移永远往「看起来达标」的方向去。
 * 目标分来自 `role-charter.json`，且被 S6 钉死在 `PASS_THRESHOLD` 上。
 *
 * ## 查不到就说查不到
 *
 * issue 的归属要联网（`gh`）。拿不到时**整列显示「查不到」并明说原因**，不猜成
 * 「无人认领」——猜出来的归属会诱导 agent 去抢一个其实有人在做的活，
 * 比没有归属更糟（#823 是同型事故：队列顶部留着已关闭的 issue，让人去做已做完的事）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./lib/paths";
import { readKnownAgentIdentities, type AgentIdentity } from "./lib/agent-identity";
import { log } from "./lib/log";
import { sh } from "./lib/sh";
import type { Args } from "./lib/args";
import { computeReadiness } from "./core-loop-readiness-doctor";
import { PASS_THRESHOLD } from "./lib/core-loop-readiness";
import {
  validateCharter, buildScorecard, classifyBlockers, nextActionFor,
  type CharterFile, type IssueMeta, type TrackVerdictLike, type WaitingOn,
} from "./lib/role-scorecard";

const CHARTER_PATH = join(STATE_DIR, "role-charter.json");

/** 身份那一行怎么显示——`active: false` 是**真实信号**，不能吞掉。 */
function identityLine(ident: AgentIdentity | undefined): string {
  if (!ident) return "⚠ 既不在 registry.yaml，也不在 .harness/agents/*.yaml —— 给一个不存在的角色发分毫无意义";
  const base = `${ident.kind}（reports_to: ${ident.reportsTo ?? "—"}）`;
  return ident.active ? base : `${base}  ⚠ registry 标记为**停用**（active: false）`;
}

/**
 * 批量取 issue 元数据。**拿不到就返回 null**（不是空 Map）——
 * 空 Map 会被下游读成「这些 issue 都不存在」，那是把「问不到」伪装成了「有答案」。
 */
function readIssueMeta(numbers: readonly number[]): Map<number, IssueMeta> | null {
  if (numbers.length === 0) return new Map();
  const probe = sh("gh auth status");
  if (probe.code !== 0) return null;
  const meta = new Map<number, IssueMeta>();
  for (const n of numbers) {
    const r = sh(`gh issue view ${n} --json number,state,title,labels`);
    if (r.code !== 0) continue; // 单条查不到 ⇒ 下游按 unknown 处理，不猜
    try {
      const j = JSON.parse(r.stdout) as { state: string; title: string; labels: { name: string }[] };
      meta.set(n, { state: j.state, title: j.title, labels: j.labels.map((l) => l.name) });
    } catch { /* 解析不了同样按 unknown */ }
  }
  return meta;
}

function waitingLabel(w: WaitingOn): string {
  switch (w.on) {
    case "human": return "🔒 等人类";
    case "role": return `👤 等 ${w.who}`;
    case "unowned": return "❗ 无人认领";
    case "closed": return "✅ 已关闭（该从队列摘掉）";
    case "unknown": return "❔ 查不到";
  }
}

export function roleScorecard(args: Args): void {
  const strict = args.flags.strict === true;
  const only = args.opts.role ?? null;  // ⚠ 带值的参数落在 opts 不是 flags（parseArgs 的约定）

  if (!existsSync(CHARTER_PATH)) { log.err(`找不到 ${CHARTER_PATH}`); process.exit(1); }
  const charter = JSON.parse(readFileSync(CHARTER_PATH, "utf8")) as CharterFile;

  // 角色权威 = registry 身份 ∪ 便携 subagent 规格。registry 优先（它带 kind/reports_to）。
  // 判据在 lib/agent-identity.ts —— #1142 起是单一事实源，feature.owner 的机械门读同一份。
  const registry = readKnownAgentIdentities();
  const { state, verdict } = computeReadiness();

  const verdicts = new Map<string, TrackVerdictLike>(verdict.tracks.map((t) => [t.id, t]));
  const maxima = new Map<string, number>(Object.entries(state.tracks).map(([id, t]) => [id, t.max]));

  /* ── charter 自检：七道门 ─────────────────────────────────────────── */
  const violations = validateCharter(charter, new Set(registry.keys()), maxima, PASS_THRESHOLD);
  if (violations.length > 0) {
    log.warn(`⚠ role-charter.json 有 ${violations.length} 条违规（记分卡照常渲染，但这些角色的判定不可信）：`);
    for (const v of violations) {
      if (v.code === "TARGET_DRIFTS_FROM_AUTHORITY") {
        log.warn(`  · [${v.code}] ${v.role}/${v.item}：charter 写 ${v.charter}，权威门槛是 ${v.authority}`);
      } else if (v.code === "UNKNOWN_ROLE") {
        log.warn(`  · [${v.code}] ${v.role} 既不在 registry.yaml 也不在 .harness/agents/*.yaml —— 给一个不存在的角色发分毫无意义`);
      } else {
        log.warn(`  · [${v.code}] ${JSON.stringify(v)}`);
      }
    }
  }

  const roles = only ? [only] : Object.keys(charter.roles);

  /* ── 一次性把所有要查的 issue 收齐再查，避免每个角色各查一遍 ── */
  const allIssues = new Set<number>();
  for (const r of roles) for (const o of charter.roles[r]?.owns ?? []) {
    for (const n of verdicts.get(o.id)?.blockingIssues ?? []) allIssues.add(n);
  }
  const issueMeta = readIssueMeta([...allIssues]);
  if (issueMeta === null) {
    log.warn("⚠ 取不到 issue 状态（gh 未登录或离线）——「我在等谁」整列显示「查不到」，不猜。");
  }

  for (const role of roles) {
    const spec = charter.roles[role];
    log.step(`角色记分卡：${role}`);

    const ident = registry.get(role);
    if (!spec) {
      // 不在 charter 里的角色：三问照答（只需要 owner: 标签），但**不编一个分数出来**。
      log.info(`   身份：${identityLine(ident)}`);
      log.info("   ① 我的目标：**本角色在 charter 里没有可评分项**。");
      log.info("      这不是「满分」，是「今天还没有任何 per-role 量化 authority 覆盖它」——");
      log.info("      v1 只实现了 clr_track 一种可评项，见 role-charter.json 的 _scope。");
      continue;
    }

    log.info(`   身份：${identityLine(ident)}`);
    log.info(`   使命：${spec.mission}`);

    const card = buildScorecard(role, spec, ident ?? { kind: "unknown", reportsTo: null }, verdicts);

    /* ── ① 我的目标 ── */
    log.info("");
    log.info(`   ① 我的目标 —— ${card.met ? "✅ 全部达标" : `还差 ${round1(card.totalGap)} 分`}`);
    log.info("   | 可评项 | 现状 | 目标 | 差 | 为什么不是记录分 |");
    log.info("   |---|---|---|---|---|");
    for (const i of card.items) {
      const why = i.discounts.length === 0 ? "—" : i.discounts.join(" / ");
      log.info(`   | ${i.id} ${i.name} | ${i.current} | ${i.target} | ${i.gap === 0 ? "—" : round1(i.gap)} | ${why} |`);
    }

    /* ── ②③ 我的 blocker / 我在等谁 ── */
    const mine = card.items.flatMap((i) => i.blockingIssues);
    const uniq = [...new Set(mine)];
    log.info("");
    if (uniq.length === 0) {
      log.info("   ②③ 我的 blocker：无（该 track 没有声明 blocking_issues）");
    } else {
      log.info("   ②③ 我的 blocker / 我在等谁");
      for (const w of classifyBlockers(uniq, issueMeta)) {
        const tail = w.on === "unknown" ? w.why : w.title;
        log.info(`      #${w.issue}  ${waitingLabel(w)}  ${tail}`);
      }
    }

    /* ── ④ 我的下一个动作 ── */
    const next = nextActionFor(verdict.queue, new Set(uniq));
    log.info("");
    log.info(`   ④ 我的下一个动作：${next === null
      ? "统一队列里没有属于我的活（照实说没有，不硬塞一条）"
      : `#${next} —— 它是统一队列里属于我的第一条`}`);
    log.info("");
  }

  /* ── strict：只在**记录自相矛盾**时退非 0，分数低不退（同 readiness 的分寸）── */
  if (strict && violations.length > 0) {
    log.err(`✗ role-charter.json 有 ${violations.length} 条结构违规`);
    process.exit(1);
  }
  if (strict) log.ok("✓ role-charter.json 结构合法（分数高低不影响本检查的退出码）");
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
