// cycle-report.ts — C-cycle 周期健康表（只读，无 --apply 概念）。
//
// 来源：work-cycle-proposal.md §4.2（PR #443 + amendments）。聚合三个数据源：
// 1. coord-gateway GET /api/coord/time——权威时钟与当前周期 id（ADR-014）。
//    本文件曾用本机 `Date.now()` 自己算周期边界，是 ADR-014 背景 §1 点名的那处
//    「每个 agent 各算各的 cycle id」；周期时钟的唯一权威实现在
//    apps/coord-gateway/src/cycle.ts，这里只读，不再复述算法。
// 2. coord-gateway GET /api/coord/repos/<COORD_REPO>/claims（bearer）——active
//    claims 的心跳年龄，SLA "in_progress 无进展" 的权威数据源。
// 3. gh：专用 work-cycle issue（label coordination:work-cycle）上的 cycle-plan/result
//    评论——谁在本周期承诺了什么、上周期完成率；以及 gh pr list——open PR 的等待时长
//    （SLA：新 PR 同周期内要有首个 review 结论）、近 24h merged PR 的 开出→合并
//    流动时间（提案唯一成功指标）。
//
// 2026-08 割接（issue #381）：本命令此前读已退役的 coord-service `COORD_SERVICE_URL`
// + `GET /status`（ADR-017 决策 4 已整体换掉凭据体系）。旧权威不存在了，而代码把
// 「没配 / 问不到」静默降级成一行「跳过租约健康检查」并以 0 退出——读报告的人看到
// 一张完整的健康表，看不到权威压根没被问过。
//
// 因此本命令 **fail-closed**（ADR-006 判例、ADR-017 背景 §1）：配置缺失、401/403、
// 非 2xx、超时/不可达、响应形状异常，一律显式报错 + 非零退出，绝不渲染成
// 「无活跃租约」或任何健康形状的输出。fail-open ≠ fail-silent。
import { sh } from "./lib/sh";
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import { createCoordClient } from "@repo/coord-protocol/client";
import { errDetail } from "./lib/coord-client";
// 「哪个 issue 是 work-cycle issue、怎么读它的评论」只写一处：#534 的门与本表共用
// 同一个读取口，免得门与健康表各读各的、判断不一致（AGENTS.md：同一事实不得声明在两处）。
import { WORK_CYCLE_LABEL, fetchWorkCycleComments } from "./lib/cycle-result-gate";

const GATEWAY_TIMEOUT_MS = 8_000;
/** 心跳超过这个年龄的活跃租约标记为可疑（持有者可能已经不在了）。 */
const STALE_HEARTBEAT_MINUTES = 30;

interface PrSummary {
  number: number;
  title: string;
  createdAt: string;
  mergedAt?: string;
}

interface CycleInfo {
  id: string;
  started_at: string;
  ends_at: string;
  remaining_seconds: number;
  elapsed_seconds: number;
}

interface TimePayload {
  now: string;
  epoch_ms: number;
  cycle: CycleInfo;
}

/** gh 调用的三态：ok / 命令失败（问不到）/ 输出不是预期形状。
 *  「问不到」绝不塌缩成空数组——那正是本 issue 要修的形状。 */
type GhOutcome<T> = { kind: "ok"; value: T } | { kind: "error"; detail: string };

function hoursBetween(aIso: string, b: Date): number {
  return (b.getTime() - new Date(aIso).getTime()) / 3_600_000;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (sorted.length % 2 === 0 && lower !== undefined && upper !== undefined) {
    return (lower + upper) / 2;
  }
  return upper ?? null;
}

function fmtRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function ghJson<T>(cmd: string, what: string): GhOutcome<T> {
  const result = sh(cmd);
  if (result.code !== 0) {
    const tail = result.stdout.trim().split("\n").slice(-3).join(" / ");
    return { kind: "error", detail: `gh 调用失败（exit ${result.code}）${tail ? `：${tail}` : ""}` };
  }
  try {
    return { kind: "ok", value: JSON.parse(result.stdout || "null") as T };
  } catch {
    return { kind: "error", detail: `${what} 的 gh 输出不是合法 JSON——形状异常，不当成空结果` };
  }
}

/** 权威时钟。公开只读端点，不需要 token；读不到就没有周期可报。 */
async function fetchAuthoritativeTime(baseUrl: string): Promise<GhOutcome<TimePayload>> {
  const url = `${baseUrl}/api/coord/time`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
    if (!res.ok) return { kind: "error", detail: `HTTP ${res.status}` };
    const body = (await res.json()) as Partial<TimePayload>;
    if (typeof body.now !== "string" || typeof body.cycle?.id !== "string") {
      return { kind: "error", detail: "响应缺少 now/cycle.id——形状异常" };
    }
    return { kind: "ok", value: body as TimePayload };
  } catch (e) {
    return { kind: "error", detail: `网络异常：${(e as Error).message}` };
  }
}

export async function cycleReport(_args: Args): Promise<void> {
  // ── 0. 权威配置（缺一不可；没有权威就不出报告）────────────────────────────
  const baseUrl = process.env["COORD_GATEWAY_URL"]?.replace(/\/+$/, "");
  const token = process.env["COORD_API_TOKEN"];
  const repo = process.env["COORD_REPO"];
  const missing = [
    baseUrl ? null : "COORD_GATEWAY_URL",
    token ? null : "COORD_API_TOKEN",
    repo ? null : "COORD_REPO",
  ].filter((name): name is string => name !== null);
  if (!baseUrl || !token || !repo) {
    log.err(
      `${missing.join(" / ")} 未配置——cycle-report 读的是协调权威（coord-gateway，ADR-017），` +
        "没有权威就不出报告，不按本地时钟和空租约硬编一张健康表。"
    );
    process.exitCode = 1;
    return;
  }

  // ── 1. 权威时钟 + 当前周期（ADR-014）──────────────────────────────────────
  const time = await fetchAuthoritativeTime(baseUrl);
  if (time.kind === "error") {
    log.err(
      `读不到权威时钟（GET ${baseUrl}/api/coord/time：${time.detail}）——` +
        "协调权威联系不上时不要按本地时钟硬猜周期边界，先排查网络/服务。"
    );
    process.exitCode = 1;
    return;
  }
  const now = new Date(time.value.now);
  const cycle = time.value.cycle;
  log.step(
    `当前周期：${cycle.id}（已进行 ${Math.round(cycle.elapsed_seconds / 60)} 分钟，` +
      `剩 ${fmtRemaining(cycle.remaining_seconds)}）`
  );

  // ── 2. 权威租约（问不到 ≠ 无租约）─────────────────────────────────────────
  const client = createCoordClient({
    gatewayUrl: baseUrl,
    token,
    repo,
    agentId: process.env["COORD_AGENT_ID"],
    fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) }),
  });
  const claims = await client.listActiveClaims();
  if (claims.kind === "error") {
    // errDetail 只给 `HTTP <status>`；形状异常（200 但缺 leases 数组）光看状态码
    // 会像成功，所以把客户端的判词一并带出来。
    const detail = claims.status === undefined ? errDetail(claims) : `${errDetail(claims)}，${claims.message}`;
    log.err(
      `读不到权威租约（GET ${baseUrl}/api/coord/repos/${repo}/claims：${detail}）——` +
        "问不到 ≠ 空闲；401/403 请检查 COORD_API_TOKEN 是否仍有效。"
    );
    process.exitCode = 1;
    return;
  }

  // ── 3. cycle-plan / cycle-result 评论 ─────────────────────────────────────
  // 读取口只有一份（lib/cycle-result-gate.ts）：#534 的 cycle-result 门与本表共用，
  // 免得门与健康表各读各的、对「本周期有没有人汇报」给出两套判断
  // （AGENTS.md：同一事实不得声明在两处）。三态返回里「读不到」不塌缩成「空评论」，
  // 本表照旧 fail-closed：问不到 GitHub ⇒ 报错 + 非零退出，不渲染成一张完整健康表。
  const fetched = fetchWorkCycleComments({ limit: 60 });
  if (fetched.kind === "unavailable") {
    log.err(`读不到 work-cycle issue 的评论（${fetched.reason}）——GitHub 叙述源不可达，报告不完整。`);
    process.exitCode = 1;
  } else if (fetched.kind === "no-issue") {
    log.warn(`未找到 label 为 ${WORK_CYCLE_LABEL} 的 open work-cycle issue——cycle-plan/result 无处可读。`);
  } else {
    const issueNumber = fetched.issue;
    const plans = fetched.comments.filter(
      (c) => c.body.startsWith("cycle-plan") && c.body.includes(`cycle:${cycle.id}`)
    );
    const results = fetched.comments.filter((c) => c.body.startsWith("cycle-result"));
    log.info(`work-cycle issue：#${issueNumber}`);
    if (plans.length === 0) {
      log.warn(`本周期（${cycle.id}）还没有任何 cycle-plan——周期开始 10 分钟内每个在任 coordinator 应发一条。`);
    } else {
      log.info(`本周期 cycle-plan（${plans.length} 条）：`);
      for (const p of plans) {
        const byMatch = /by:(\S+)/.exec(p.body);
        const commitLine = p.body.split("\n").find((l) => l.startsWith("commit:")) ?? "";
        log.info(`  - ${byMatch?.[1] ?? "?"} ${commitLine}`);
      }
    }
    const lastResult = results[results.length - 1];
    if (lastResult) {
      log.info(`最近一条 cycle-result（${lastResult.createdAt}）：${lastResult.body.split("\n")[0]}`);
    }
  }

  // ── 4. open PR 等待时长（SLA：同周期内要有首个 review 结论；这里报的是 open
  //       时长，review 明细留给人看 PR 页面——脚本只标记"开了超过一个周期还 open"的）
  const cycleHours = (Date.parse(cycle.ends_at) - Date.parse(cycle.started_at)) / 3_600_000;
  const openPrs = ghJson<PrSummary[]>(
    `gh pr list --state open --limit 50 --json number,title,createdAt`,
    "open PR 列表"
  );
  if (openPrs.kind === "error") {
    log.err(`读不到 open PR 列表（${openPrs.detail}）——等待时长这一节无数据，不按 0 个渲染。`);
    process.exitCode = 1;
  } else {
    const stale = openPrs.value.filter((pr) => hoursBetween(pr.createdAt, now) > cycleHours);
    log.info(
      `open PR：${openPrs.value.length} 个，其中 ${stale.length} 个已开出超过一个周期（${cycleHours}h）：`
    );
    for (const pr of stale) {
      log.info(`  ⚠ #${pr.number}（open ${hoursBetween(pr.createdAt, now).toFixed(1)}h）${pr.title.slice(0, 60)}`);
    }
  }

  // ── 5. flow time（唯一成功指标）：近 24h merged 的 开出→合并 中位时长 ──────
  const mergedPrs = ghJson<PrSummary[]>(
    `gh pr list --state merged --limit 30 --json number,title,createdAt,mergedAt`,
    "merged PR 列表"
  );
  if (mergedPrs.kind === "error") {
    log.err(`读不到 merged PR 列表（${mergedPrs.detail}）——flow time 无数据，不按"无数据"渲染成健康。`);
    process.exitCode = 1;
  } else {
    const merged = mergedPrs.value.filter((pr) => pr.mergedAt && hoursBetween(pr.mergedAt, now) <= 24);
    const flowHours = merged
      .map((pr) => (pr.mergedAt ? hoursBetween(pr.createdAt, new Date(pr.mergedAt)) : null))
      .filter((v): v is number => v !== null);
    const medianFlow = median(flowHours);
    log.info(
      `flow time（近 24h 合并的 ${merged.length} 个 PR，开出→合并中位时长）：` +
        (medianFlow === null ? "无数据" : `${medianFlow.toFixed(1)}h`)
    );
  }

  // ── 6. coord-gateway active claims（权威租约状态）─────────────────────────
  if (claims.leases.length === 0) {
    log.info(`coord-gateway（${repo}）：已查询权威，当前无活跃租约。`);
  } else {
    log.info(`coord-gateway（${repo}）活跃租约（${claims.leases.length} 个）：`);
    for (const lease of claims.leases) {
      const heartbeatAgeMinutes = (now.getTime() - new Date(lease.last_heartbeat_at).getTime()) / 60_000;
      const flag = heartbeatAgeMinutes > STALE_HEARTBEAT_MINUTES ? "⚠ " : "";
      log.info(
        `  ${flag}${lease.resource_id} ← ${lease.agent_id}（心跳 ${heartbeatAgeMinutes.toFixed(0)} 分钟前）`
      );
    }
  }
}
