/**
 * GTM 活动与漏斗存储（backlog D2）：单例 Durable Object。
 * 每条记录落盘前都过 strict schema——schema 之外的字段进不来。
 *
 * 路由（由 index.ts 在 Access 校验之后转发）：
 *   GET   /gtm/campaigns
 *   POST  /gtm/campaigns                     { id, channel, status, startsOn, endsOn? }
 *   PATCH /gtm/campaigns/:id                 { status?, endsOn? }
 *   POST  /gtm/funnel                        { days: FunnelDay[] }  摄入（同键覆盖，幂等）
 *   GET   /gtm/campaigns/:id/funnel?from=&to=  逐日计数 + 读时算的转化率 + 区间合计
 */
import { DurableObject } from "cloudflare:workers";
import {
  CampaignRecord, CreateCampaignInput, FUNNEL_STEPS, FunnelDay, FunnelIngestBatch, UpdateCampaignInput,
  conversionRates, type Step,
} from "./gtm-schema";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bad = (error: string, issues: { path: (string | number)[] }[]) => json(400, { error, fields: issues.map((i) => i.path.join(".")) });

const cmpKey = (id: string) => `cmp:${id}`;
const dayKey = (id: string, day: string) => `day:${id}:${day}`;

export class GtmLog extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["gtm", ...]
    const now = new Date().toISOString();

    if (parts[1] === "campaigns" && parts.length === 2) {
      if (request.method === "GET") {
        const map = await this.ctx.storage.list<CampaignRecord>({ prefix: "cmp:" });
        return json(200, { campaigns: [...map.values()].sort((a, b) => b.startsOn.localeCompare(a.startsOn)) });
      }
      if (request.method === "POST") {
        const input = CreateCampaignInput.safeParse(await request.json().catch(() => null));
        if (!input.success) return bad("INVALID_CAMPAIGN_INPUT", input.error.issues);
        if (await this.ctx.storage.get(cmpKey(input.data.id))) return json(409, { error: "CAMPAIGN_EXISTS" });
        const record = CampaignRecord.parse({ ...input.data, createdAt: now });
        await this.ctx.storage.put(cmpKey(record.id), record);
        return json(201, { campaign: record });
      }
    }

    if (parts[1] === "campaigns" && parts[2] && parts.length === 3 && request.method === "PATCH") {
      const existing = await this.ctx.storage.get<CampaignRecord>(cmpKey(parts[2]));
      if (!existing) return json(404, { error: "CAMPAIGN_NOT_FOUND" });
      const input = UpdateCampaignInput.safeParse(await request.json().catch(() => null));
      if (!input.success) return bad("INVALID_CAMPAIGN_INPUT", input.error.issues);
      const checked = CampaignRecord.safeParse({ ...existing, ...input.data });
      if (!checked.success) return json(422, { error: "GTM_SCHEMA_VIOLATION" });
      await this.ctx.storage.put(cmpKey(checked.data.id), checked.data);
      return json(200, { campaign: checked.data });
    }

    if (parts[1] === "funnel" && parts.length === 2 && request.method === "POST") {
      const input = FunnelIngestBatch.safeParse(await request.json().catch(() => null));
      if (!input.success) return bad("INVALID_FUNNEL_INPUT", input.error.issues);
      const ids = [...new Set(input.data.days.map((d) => d.campaignId))];
      const known = await this.ctx.storage.get<CampaignRecord>(ids.map(cmpKey));
      const unknown = ids.filter((id) => !known.has(cmpKey(id)));
      if (unknown.length) return json(422, { error: "UNKNOWN_CAMPAIGN", campaignIds: unknown });
      const entries: Record<string, FunnelDay> = {};
      for (const d of input.data.days) entries[dayKey(d.campaignId, d.day)] = FunnelDay.parse(d);
      await this.ctx.storage.put(entries);
      return json(200, { accepted: Object.keys(entries).length });
    }

    if (parts[1] === "campaigns" && parts[2] && parts[3] === "funnel" && parts.length === 4 && request.method === "GET") {
      const id = parts[2];
      const campaign = await this.ctx.storage.get<CampaignRecord>(cmpKey(id));
      if (!campaign) return json(404, { error: "CAMPAIGN_NOT_FOUND" });
      const from = url.searchParams.get("from") ?? "0000-00-00";
      const to = url.searchParams.get("to") ?? "9999-99-99";
      const map = await this.ctx.storage.list<FunnelDay>({ prefix: `day:${id}:` });
      const days = [...map.values()].filter((d) => d.day >= from && d.day <= to).sort((a, b) => a.day.localeCompare(b.day));
      const total = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, days.reduce((n, d) => n + d.counts[s], 0)])) as Record<Step, number>;
      return json(200, {
        campaign,
        days: days.map((d) => ({ day: d.day, counts: d.counts, conversion: conversionRates(d.counts) })),
        total: { counts: total, conversion: conversionRates(total) },
      });
    }
    return json(404, { error: "NOT_FOUND" });
  }
}
