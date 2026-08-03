// tick.ts — 每个 agent 每个 loop 跑的**唯一一条命令**（ADR-014 统一时钟 + loop 纪律）。
//
// 背景（真实事故）：coord-architecture 自己的协调租约在集成 p23 期间静默过期 8 小时
// ——因为"续约"全靠会话想起来做；同期 cycle-report 用本地时钟算周期，机器时钟一漂
// 各算各的。教训与 ADR-012 同款：**能机械化的纪律，绝不交给记性**。
//
// 一条命令做完一个 loop 该做的四件事，任何 runtime 都能在自己的循环里调它：
//   1. 读权威时钟（coord-gateway GET /api/coord/time）——现在几点、当前哪个周期、还剩多久
//   2. 报本地时钟漂移（>60s 告警：你按错误时间协调会误判租约新鲜度/周期边界）
//   3. 续自己的租约（acquire-or-renew，避免静默过期）
//   4. 拉任务收件箱（有 pending 就提示 ack）
// 输出是给人/agent 读的行动清单；正常退出 0，权威缺失/不可达退出非 0；--json 供脚本消费。
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import { createCoordClientFromEnv } from "@repo/coord-protocol/client";
import { errDetail } from "./lib/coord-client";

const DRIFT_WARN_SECONDS = 60;

interface TimePayload {
  now: string;
  epoch_ms: number;
  cycle: { id: string; started_at: string; ends_at: string; remaining_seconds: number; elapsed_seconds: number };
}

function env(name: string): string | undefined {
  return process.env[name];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function fmtRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

export async function tick(args: Args): Promise<void> {
  const sessionId = args.opts["session"] ?? env("COORD_AGENT_ID");
  const asJson = args.flags["json"] === true;
  const baseUrl = env("COORD_GATEWAY_URL")?.replace(/\/+$/, "");
  const token = env("COORD_API_TOKEN");
  const repo = env("COORD_REPO");

  if (!baseUrl) {
    log.err("COORD_GATEWAY_URL 未配置——tick 需要权威时钟（ADR-014/ADR-017）。见 agent-bootstrap.md 第 3 步。");
    process.exitCode = 1;
    return;
  }

  // ── 1. 权威时钟 ────────────────────────────────────────────────────────────
  const localBefore = Date.now();
  const timeUrl = `${baseUrl}/api/coord/time`;
  const time = await fetchJson<TimePayload>(timeUrl);
  if (!time) {
    log.err(`[clock] 读不到权威时钟（${timeUrl}）——协调权威联系不上时不要按本地时钟硬猜，先排查网络/服务。`);
    process.exitCode = 1;
    return;
  }
  // 往返一半近似单程延迟，剩下的差值即本地时钟漂移
  const rttHalf = (Date.now() - localBefore) / 2;
  const driftSeconds = Math.round(((localBefore + rttHalf) - time.epoch_ms) / 1000);

  const out: Record<string, unknown> = {
    now: time.now,
    cycle: time.cycle,
    drift_seconds: driftSeconds,
  };

  if (!asJson) {
    log.info(`[clock] 权威时刻 ${time.now}`);
    log.info(`[cycle] ${time.cycle.id}（本周期剩 ${fmtRemaining(time.cycle.remaining_seconds)}；结束前必须发 cycle-result）`);
  }

  // ── 2. 时钟漂移告警 ────────────────────────────────────────────────────────
  if (Math.abs(driftSeconds) > DRIFT_WARN_SECONDS) {
    log.err(
      `[clock] 本地时钟与权威时钟相差 ${driftSeconds}s（阈值 ${DRIFT_WARN_SECONDS}s）——` +
        `你对租约新鲜度/周期边界的判断会出错。一律以 GET /time 为准，并修本机时钟（NTP）。`
    );
    out["drift_warning"] = true;
  }

  const client = createCoordClientFromEnv();
  if (!token || !repo || !sessionId || !client) {
    log.err(
      "[lease/inbox] COORD_API_TOKEN/COORD_REPO/COORD_AGENT_ID（或 --session）未完整配置——" +
        "tick 不能跳过权威续约与收件箱。旧 COORD_SERVICE_* 已退役（ADR-017）。"
    );
    out["authority_configured"] = false;
    if (asJson) console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
    return;
  }

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // ── 3. 续租约（acquire-or-renew，防静默过期）─────────────────────────────
  const claims = await client.listActiveClaims();
  if (claims.kind === "error") {
    log.err(`[lease] 查询 coord-gateway 权威租约失败（${errDetail(claims)}）——问不到不等于空闲。`);
    out["lease"] = { renewed: false, error: errDetail(claims) };
    process.exitCode = 1;
  } else {
    const mine = claims.leases.filter((lease) => lease.agent_id === sessionId);
    if (mine.length === 0) {
      if (!asJson) log.info(`[lease] agent=${sessionId} 无活跃租约——如你正在履职，先运行对应的 lock-acquire/claim。`);
      out["lease"] = { agent_id: sessionId, renewed: false, absent: true };
    } else {
      const renewed: Array<{ resource_id: string; lease_id: string; renewed: boolean; error?: string }> = [];
      for (const lease of mine) {
        const ageMin = (Date.parse(time.now) - Date.parse(lease.last_heartbeat_at)) / 60000;
        const hb = await client.heartbeat(lease.lease_id);
        if (hb.kind === "ok") {
          if (!asJson)
            log.ok(
              `[lease] 已续约 ${lease.resource_id}（lease ${lease.lease_id}；续约前心跳 ${ageMin.toFixed(1)} 分钟前，ttl ${lease.ttl_seconds}s）`
            );
          renewed.push({ resource_id: lease.resource_id, lease_id: lease.lease_id, renewed: true });
        } else {
          const detail = hb.kind === "gone" ? `租约已终态（${hb.leaseStatus ?? "released/expired"}）` : errDetail(hb);
          log.err(`[lease] 续约失败（${lease.resource_id} / ${lease.lease_id}：${detail}）——重新认领。`);
          renewed.push({ resource_id: lease.resource_id, lease_id: lease.lease_id, renewed: false, error: detail });
          process.exitCode = 1;
        }
      }
      out["lease"] = { agent_id: sessionId, renewed: renewed.every((item) => item.renewed), leases: renewed };
    }
  }

  // ── 4. 任务收件箱（#594 平台中立派工）────────────────────────────────────
  const inbox = await fetchJson<{ tasks: Array<{ id: number; issue: number; priority: string; note: string | null }> }>(
    `${baseUrl}/api/coord/repos/${repo}/tasks?assignee=${encodeURIComponent(sessionId)}&status=pending`,
    { headers: authHeaders }
  );
  if (!inbox || !Array.isArray(inbox.tasks)) {
    log.err("[inbox] 读取 coord-gateway 任务收件箱失败——不能把不可达伪装成空收件箱。");
    out["pending_tasks"] = null;
    process.exitCode = 1;
    if (asJson) console.log(JSON.stringify(out, null, 2));
    return;
  }
  const pending = inbox.tasks;
  out["pending_tasks"] = pending;
  if (!asJson) {
    if (pending.length === 0) {
      log.info("[inbox] 无待接任务。");
    } else {
      log.info(`[inbox] ${pending.length} 个待接任务——ack 后开工：`);
      for (const t of pending) {
        log.info(`  · task ${t.id} → issue #${t.issue}（${t.priority}）${t.note ? ` — ${t.note}` : ""}`);
        log.info(
          `    ack: curl -s -X POST -H "Authorization: Bearer $COORD_API_TOKEN" ` +
            `"${baseUrl}/api/coord/repos/${repo}/tasks/${t.id}/ack"`
        );
      }
    }
  }

  if (asJson) console.log(JSON.stringify(out, null, 2));
}
