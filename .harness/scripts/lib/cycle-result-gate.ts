// cycle-result-gate.ts — C-cycle 周期汇报义务的**机械门控**（#534）。
//
// 背景（真实事故）：coord-chat-e2e 跑了十几个周期、一次 cycle-result 都没发；
// coord-main 同样没发。而 `harness tick` 每一轮都逐字提示「结束前必须发 cycle-result」
// ——**每次都读到了、每次都没发**，十几个周期无人发现，包括当事人自己。
// 这是 AGENTS.md「**没有脚本的规范条目视为未落地**」的教科书实例：
// coordinator-sop.md 的 C-cycle 章节白纸黑字写着义务，而没有任何脚本会因为它没被履行而变红。
//
// 判据要**轻**：查有没有，不查写得好不好（同 #517「查可达性，不查结果」）。
// 检查内容质量的门控跑不动，最后一定被 skip 掉。
//
// ## 判定（唯一事实源，文档只引用不复述）
//   某 agent 持有**协调类**活跃租约（coordinator-role / module），
//   且该租约在**刚结束的那个周期**开始前就已持有，
//   而 work-cycle issue 上没有它为那个周期发的 cycle-result ⇒ **FAIL（红）**。
//
// ## 红线 10：必须红在「该周期没有评论」上，不能红在前置失败上
//   拿不到租约列表 / 拿不到评论 / 解析不到周期 id / 租约时间戳不可解析——
//   这些一律走 `kind: "precondition"` 且 **不是 FAIL**：问不到不等于没发，
//   在残缺输入上做否定性判断，红的理由就是错的（同 lib/github-issues.ts 的三态不变量）。
//
// 时钟不在本文件里算：周期边界与 cycle id 由权威时钟给（ADR-014，GET /api/coord/time），
// 调用方把 `cycle` 原样传进来。本文件只做纯判定 + 一个可注入 exec 的 gh 读取口。
import { sh as defaultSh, type ShResult } from "./sh";

/** 全仓唯一的 `[coordination] work-cycle` issue 的 label（coordinator-sop.md）。 */
export const WORK_CYCLE_LABEL = "coordination:work-cycle";

/** 周期长度 3h——与 coord-gateway src/cycle.ts 的 CYCLE_HOURS 同一常数，用来回推上一个周期。 */
const CYCLE_HOURS = 3;

/**
 * 宽限期：cycle-result「可与下周期 cycle-plan 合并成一条」（work-cycle-proposal.md §周期结束），
 * 而 cycle-plan 的窗口是「周期开始 10 分钟内」。所以新周期头 10 分钟内还没补上
 * 上一周期的 result ⇒ 只 WARN（pending），过了窗口才 FAIL。
 * 这不是「判质量」，只是把书面 SOP 里已有的截止时刻照抄成机器判据。
 */
export const DEFAULT_GRACE_MINUTES = 10;

/** 判定需要的租约字段（coord-protocol 的 Lease 子集，避免为了纯判定拖进协议包）。 */
export interface LeaseLike {
  resource_id: string;
  resource_type?: string;
  agent_id: string;
  /** ISO；用来判断「上一个周期里它就在任」 */
  claimed_at?: string;
}

/** 权威时钟给的本周期（GET /api/coord/time 的 cycle 字段子集）。 */
export interface CycleLike {
  id: string;
  started_at: string;
  elapsed_seconds?: number;
}

export interface CommentLike {
  body: string;
  createdAt?: string;
}

export type PreconditionReason =
  | "clock-unavailable"
  | "leases-unavailable"
  | "comments-unavailable"
  | "work-cycle-issue-missing"
  | "lease-timestamp-unparseable";

export type GateFinding =
  /** 红的唯一理由：该周期该 agent 没有 cycle-result */
  | { kind: "missing-cycle-result"; level: "FAIL"; agent: string; cycle: string; message: string }
  /** 还在宽限期内（可与下周期 cycle-plan 合并成一条） */
  | { kind: "pending-cycle-result"; level: "WARN"; agent: string; cycle: string; message: string }
  | { kind: "cycle-result-present"; level: "INFO"; agent: string; cycle: string; message: string }
  /** 没有协调租约 = 没有周期汇报义务（worker 不背 coordinator 的义务） */
  | { kind: "not-applicable"; level: "INFO"; message: string }
  /** 输入残缺：**不做否定性判断**，不红 */
  | { kind: "precondition"; level: "WARN"; reason: PreconditionReason; message: string };

export interface GateInput {
  /** 权威时钟的本周期；null = 读不到时钟 */
  cycle: CycleLike | null;
  /** 活跃租约（调用方可只传自己的）；null = 问不到（≠ 没有） */
  leases: readonly LeaseLike[] | null;
  /** work-cycle issue 的评论；null = 问不到（≠ 没有评论） */
  comments: readonly CommentLike[] | null;
  /** 只判这些 agent（tick 传自己）；不传 = 判全部持有协调租约的 agent */
  agents?: readonly string[];
  /** work-cycle issue 是否存在；false = 找不到那个 issue（前置失败） */
  workCycleIssueFound?: boolean;
  graceMinutes?: number;
}

export interface GateVerdict {
  findings: GateFinding[];
  /** 任一 FAIL ⇒ 红。前置失败**不会**让它为 true（红线 10）。 */
  failed: boolean;
  /** 被判定的周期 id（刚结束的那个）；前置失败时为 null */
  judgedCycle: string | null;
}

/**
 * 协调类租约才背周期汇报义务：coordinator-sop.md 写的是「每个**在任 coordinator**」。
 * worker 持有的 `issue:<n>` / `feature:*` 租约不在义务范围内——把义务扩到 worker 是
 * 在规范之外加码，那种门第一次误报就会被绕过。
 */
export function isCoordinatorLease(lease: LeaseLike): boolean {
  if (lease.resource_type === "coordinator-role" || lease.resource_type === "module") return true;
  if (lease.resource_type !== undefined && lease.resource_type !== "custom") return false;
  // resource_type 缺失或 custom 时退回 resource_id 形状（实测在用：role:coord-main / module:board）
  return /^role:coord/.test(lease.resource_id) || lease.resource_id.startsWith("module:");
}

/**
 * cycle id 归一化：权威时钟发的是紧凑形（`2026-07-15T09Z`），而 SOP 正文与人写的评论里
 * 也出现 `2026-07-15T09:00Z`。同一个周期的两种写法必须判成相等，否则门会红在拼写上。
 * 解析不出时刻 ⇒ null（该评论不计入，但这不是前置失败——前置失败只针对时钟/租约/评论的**不可达**）。
 */
export function normalizeCycleId(raw: string): string | null {
  const token = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}(:\d{2}(:\d{2}(\.\d+)?)?)?Z$/.test(token)) return null;
  const iso = token.length === 14 ? `${token.slice(0, 13)}:00:00Z` : token;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 13)}Z`;
}

export interface CycleResultRef {
  cycle: string;
  by: string;
}

/**
 * 解析一条 cycle-result 评论头行：`cycle-result cycle:<UTC起始时刻> by:<id>`
 * （格式见 work-cycle-proposal.md §周期结束）。允许与 cycle-plan 合并成一条评论，
 * 所以是逐行找，不是只看首行。
 */
export function parseCycleResults(body: string): CycleResultRef[] {
  const out: CycleResultRef[] = [];
  for (const line of body.split(/\r?\n/)) {
    const head = line.trim();
    if (!/^cycle-result\b/.test(head)) continue;
    const cycle = /\bcycle:(\S+)/.exec(head)?.[1];
    const by = /\bby:(\S+)/.exec(head)?.[1];
    if (!cycle || !by) continue;
    const normalized = normalizeCycleId(cycle);
    if (!normalized) continue;
    out.push({ cycle: normalized, by: by.toLowerCase() });
  }
  return out;
}

/** 刚结束的那个周期的 id：由本周期起始时刻回推一个周期长度。解析不到 ⇒ null。 */
export function previousCycleId(currentCycleStartedAt: string): string | null {
  const ms = Date.parse(currentCycleStartedAt);
  if (Number.isNaN(ms)) return null;
  return `${new Date(ms - CYCLE_HOURS * 3_600_000).toISOString().slice(0, 13)}Z`;
}

function precondition(reason: PreconditionReason, message: string): GateFinding {
  return { kind: "precondition", level: "WARN", reason, message };
}

export function judgeCycleResults(input: GateInput): GateVerdict {
  const findings: GateFinding[] = [];
  const done = (judgedCycle: string | null): GateVerdict => ({
    findings,
    failed: findings.some((f) => f.level === "FAIL"),
    judgedCycle,
  });

  if (!input.cycle) {
    findings.push(precondition("clock-unavailable", "读不到权威时钟的本周期——不判周期汇报义务（不能按本地时钟硬猜周期边界）。"));
    return done(null);
  }
  const judged = previousCycleId(input.cycle.started_at);
  if (!judged) {
    findings.push(
      precondition("clock-unavailable", `权威时钟的 started_at 解析不出时刻（"${input.cycle.started_at}"）——推不出上一个周期，不判。`),
    );
    return done(null);
  }

  if (input.leases === null) {
    findings.push(precondition("leases-unavailable", "拿不到活跃租约列表——问不到不等于没人在任，不判周期汇报义务。"));
    return done(judged);
  }

  const wanted = input.agents?.map((a) => a.toLowerCase());
  const obligated = new Map<string, LeaseLike[]>();
  let timestampBroken = false;
  const cycleStartMs = Date.parse(input.cycle.started_at);
  for (const lease of input.leases) {
    if (!isCoordinatorLease(lease)) continue;
    const agent = lease.agent_id.toLowerCase();
    if (wanted && !wanted.includes(agent)) continue;
    if (lease.claimed_at !== undefined) {
      const claimedMs = Date.parse(lease.claimed_at);
      if (Number.isNaN(claimedMs)) {
        timestampBroken = true;
        findings.push(
          precondition(
            "lease-timestamp-unparseable",
            `租约 ${lease.resource_id}（${lease.agent_id}）的 claimed_at 解析不出时刻（"${lease.claimed_at}"）——判不了它在上一个周期是否在任，不判。`,
          ),
        );
        continue;
      }
      // 上一个周期结束后才认领的租约：那个周期它还没在任，没有汇报义务。
      if (claimedMs >= cycleStartMs) continue;
    }
    const list = obligated.get(agent) ?? [];
    list.push(lease);
    obligated.set(agent, list);
  }

  if (obligated.size === 0) {
    if (!timestampBroken) {
      findings.push({
        kind: "not-applicable",
        level: "INFO",
        message: `没有在周期 ${judged} 期间就在任的协调类租约——无人背该周期的 cycle-result 义务。`,
      });
    }
    return done(judged);
  }

  if (input.workCycleIssueFound === false) {
    findings.push(
      precondition("work-cycle-issue-missing", `找不到 label 为 ${WORK_CYCLE_LABEL} 的 work-cycle issue——cycle-result 无处可读，不判。`),
    );
    return done(judged);
  }
  if (input.comments === null) {
    findings.push(precondition("comments-unavailable", "读不到 work-cycle issue 的评论——问不到不等于没发过，不判。"));
    return done(judged);
  }

  const reported = new Set<string>();
  for (const c of input.comments) {
    for (const ref of parseCycleResults(c.body)) {
      if (ref.cycle === judged) reported.add(ref.by);
    }
  }

  const graceMinutes = input.graceMinutes ?? DEFAULT_GRACE_MINUTES;
  const elapsedSeconds = input.cycle.elapsed_seconds;
  const inGrace = elapsedSeconds !== undefined && elapsedSeconds < graceMinutes * 60;

  for (const [agent, leases] of [...obligated.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const held = leases.map((l) => l.resource_id).join("、");
    if (reported.has(agent)) {
      findings.push({
        kind: "cycle-result-present",
        level: "INFO",
        agent,
        cycle: judged,
        message: `${agent} 已发周期 ${judged} 的 cycle-result。`,
      });
    } else if (inGrace) {
      findings.push({
        kind: "pending-cycle-result",
        level: "WARN",
        agent,
        cycle: judged,
        message: `${agent}（持有 ${held}）还没发周期 ${judged} 的 cycle-result——还在 ${graceMinutes} 分钟宽限期内（可与本周期 cycle-plan 合并成一条），现在补。`,
      });
    } else {
      findings.push({
        kind: "missing-cycle-result",
        level: "FAIL",
        agent,
        cycle: judged,
        message:
          `${agent}（持有 ${held}）在周期 ${judged} 在任，却没有在 ${WORK_CYCLE_LABEL} issue 上发该周期的 cycle-result` +
          `——周期汇报义务见 coordinator-sop.md「C-cycle」；补一条 \`cycle-result cycle:${judged} by:${agent}\`（done/miss/flow）。`,
      });
    }
  }

  return done(judged);
}

// ── gh 读取口（唯一实现，cycle-report 与 tick 共用）────────────────────────────

export type WorkCycleCommentsResult =
  | { kind: "ok"; issue: number; comments: { body: string; createdAt: string }[] }
  | { kind: "no-issue"; reason: string }
  | { kind: "unavailable"; reason: string };

export interface FetchWorkCycleCommentsOptions {
  /** owner/name；不传则由 gh 从当前目录解析 */
  repo?: string;
  cwd?: string;
  /** 取最近多少条评论（周期只看最近两三条，取 120 足够覆盖） */
  limit?: number;
  /** 测试注入口 */
  exec?: (cmd: string, cwd?: string) => ShResult;
}

/**
 * 读 work-cycle issue 的最近评论。三态返回：**「读不到」绝不退化成「空评论」**
 * ——那会让门红在错误的理由上（红线 10），也正是 lib/github-issues.ts 立的同一条不变量。
 */
export function fetchWorkCycleComments(opts: FetchWorkCycleCommentsOptions = {}): WorkCycleCommentsResult {
  const exec = opts.exec ?? defaultSh;
  const limit = opts.limit ?? 120;
  const repoArg = opts.repo ? ` --repo ${JSON.stringify(opts.repo)}` : "";

  const listed = exec(
    `gh issue list${repoArg} --state open --label ${JSON.stringify(WORK_CYCLE_LABEL)} --json number --limit 10`,
    opts.cwd,
  );
  if (listed.code !== 0) {
    return { kind: "unavailable", reason: `gh issue list 退出码 ${listed.code}：${(listed.stderr || listed.stdout).trim().slice(0, 200)}` };
  }
  let rows: unknown;
  try {
    rows = JSON.parse(listed.stdout || "[]");
  } catch (e) {
    return { kind: "unavailable", reason: `gh issue list 输出不是 JSON：${(e as Error).message}` };
  }
  if (!Array.isArray(rows)) return { kind: "unavailable", reason: "gh issue list 输出不是数组" };
  const numbers = (rows as Array<{ number?: unknown }>)
    .map((r) => r.number)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  const issue = numbers[0];
  if (issue === undefined) {
    return { kind: "no-issue", reason: `没有 open 且 label 为 ${WORK_CYCLE_LABEL} 的 issue` };
  }

  const viewed = exec(
    `gh issue view ${issue}${repoArg} --json comments --jq '[.comments[-${limit}:][] | {body, createdAt}]'`,
    opts.cwd,
  );
  if (viewed.code !== 0) {
    return { kind: "unavailable", reason: `gh issue view ${issue} 退出码 ${viewed.code}：${(viewed.stderr || viewed.stdout).trim().slice(0, 200)}` };
  }
  let comments: unknown;
  try {
    comments = JSON.parse(viewed.stdout || "[]");
  } catch (e) {
    return { kind: "unavailable", reason: `gh issue view ${issue} 输出不是 JSON：${(e as Error).message}` };
  }
  if (!Array.isArray(comments)) return { kind: "unavailable", reason: `gh issue view ${issue} 输出不是数组` };
  return {
    kind: "ok",
    issue,
    comments: (comments as Array<{ body?: unknown; createdAt?: unknown }>).map((c) => ({
      body: typeof c.body === "string" ? c.body : "",
      createdAt: typeof c.createdAt === "string" ? c.createdAt : "",
    })),
  };
}
