/**
 * 两个 DO，都只是宿主：判定全在 fleet.ts 的纯函数里。
 *
 *   InstanceReports —— 每实例一个（idFromName(instanceId)）：最新上报 + 滚动历史 + 限流窗口。
 *                      这是边缘上**唯一**存上报本体的地方，形状固定为 StoredReport。
 *   FleetIndex      —— 单例：每实例一行 InstanceSummary，全部由 StoredReport 推出，
 *                      可整体丢弃后从 InstanceReports 重建（/rebuild）。
 *
 * 两处都不打日志：上报体永远不进 console / observability。
 */
import { DurableObject } from "cloudflare:workers";
import {
  HISTORY_LIMIT,
  aggregateFleet,
  parseReport,
  rateLimit,
  summarize,
  type InstanceSummary,
  type StoredReport,
} from "./fleet";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export class InstanceReports extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/ingest") {
      const input = (await request.json()) as { receivedAt: unknown; report: unknown };
      // 纵深防御：DO 自己再 parse 一次，落盘的永远是契约 parse 的输出，不是调用方给的对象。
      const parsed = parseReport(input.report);
      if (!parsed.success || typeof input.receivedAt !== "number") return json({ error: "invalid" }, 400);
      const receivedAt = input.receivedAt;

      const accepted = (await this.ctx.storage.get<number[]>("accepts")) ?? [];
      const rl = rateLimit(accepted, receivedAt);
      if (!rl.allowed) {
        await this.ctx.storage.put("accepts", rl.window);
        return json({ error: "rate_limited" }, 429);
      }
      const stored: StoredReport = { receivedAt, report: parsed.data };
      const history = (await this.ctx.storage.get<StoredReport[]>("history")) ?? [];
      history.push(stored);
      await this.ctx.storage.put({
        accepts: rl.window,
        latest: stored,
        history: history.slice(-HISTORY_LIMIT),
      });
      return json({ summary: summarize(stored) });
    }
    if (request.method === "GET" && url.pathname === "/latest") {
      const latest = await this.ctx.storage.get<StoredReport>("latest");
      return latest ? json(latest) : json({ error: "not_found" }, 404);
    }
    if (request.method === "GET" && url.pathname === "/history") {
      return json((await this.ctx.storage.get<StoredReport[]>("history")) ?? []);
    }
    return json({ error: "not_found" }, 404);
  }
}

const SUMMARY_PREFIX = "s:";

export class FleetIndex extends DurableObject {
  private async summaries(): Promise<InstanceSummary[]> {
    const map = await this.ctx.storage.list<InstanceSummary>({ prefix: SUMMARY_PREFIX });
    return [...map.values()];
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/upsert") {
      const s = (await request.json()) as InstanceSummary;
      const key = SUMMARY_PREFIX + s.instanceId;
      const prev = await this.ctx.storage.get<InstanceSummary>(key);
      if (!prev || prev.receivedAt <= s.receivedAt) await this.ctx.storage.put(key, s);
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/ids") {
      return json((await this.summaries()).map((s) => s.instanceId));
    }
    if (request.method === "GET" && url.pathname === "/projection") {
      const now = Number(url.searchParams.get("now") ?? Date.now());
      return json(aggregateFleet(await this.summaries(), now));
    }
    if (request.method === "POST" && url.pathname === "/rebuild") {
      // 丢弃整张索引，只从调用方给的 StoredReport 重新推出——证明索引是投影而非事实源。
      const { records } = (await request.json()) as { records: StoredReport[] };
      await this.ctx.storage.deleteAll();
      for (const r of records) await this.ctx.storage.put(SUMMARY_PREFIX + r.report.instanceId, summarize(r));
      return json({ rebuilt: records.length });
    }
    return json({ error: "not_found" }, 404);
  }
}
