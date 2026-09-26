/**
 * D2 —— GTM 活动与漏斗：只存聚合与不透明 ID。
 * 行为（Access 之后的摄入 / 读视图）+ 拒绝逐人数据 + 落盘内容只有 schema 形状。
 */
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { handle, type Env } from "../src/index";
import { conversionRates, GtmStoredShapes } from "../src/gtm-schema";
import { accessFixture } from "./access-fixture";

const fx = accessFixture();
beforeAll(fx.init);
const cfgEnv = (): Env => ({ ...(env as Env), ACCESS_TEAM_DOMAIN: fx.TEAM, ACCESS_AUD: fx.AUD });
async function call(method: string, path: string, body?: unknown, auth = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers["cf-access-jwt-assertion"] = await fx.good();
  return handle(new Request(`https://ops.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), cfgEnv(), fx.deps());
}
const counts = (v: number[]) => ({ visit: v[0]!, signup: v[1]!, instance_ready: v[2]!, first_value: v[3]!, retained_7d: v[4]! });

describe("GTM 活动与漏斗", () => {
  it("无 Access JWT → 401（摄入与读视图都在 Access 后）", async () => {
    expect((await call("GET", "/api/ops/gtm/campaigns", undefined, false)).status).toBe(401);
    expect((await call("POST", "/api/ops/gtm/funnel", { days: [] }, false)).status).toBe(401);
  });

  it("建活动 → 摄入逐日计数 → 读视图带转化率与合计；重放同一天是覆盖", async () => {
    const id = "cmp_launch2026q4";
    expect((await call("POST", "/api/ops/gtm/campaigns", { id, channel: "event", status: "running", startsOn: "2026-09-01" })).status).toBe(201);
    expect((await call("POST", "/api/ops/gtm/campaigns", { id, channel: "event", status: "running", startsOn: "2026-09-01" })).status).toBe(409);
    const ingest = await call("POST", "/api/ops/gtm/funnel", { days: [
      { campaignId: id, day: "2026-09-01", counts: counts([100, 20, 10, 5, 1]) },
      { campaignId: id, day: "2026-09-02", counts: counts([0, 0, 0, 0, 0]) },
    ] });
    expect(ingest.status).toBe(200);
    expect((await call("POST", "/api/ops/gtm/funnel", { days: [{ campaignId: id, day: "2026-09-02", counts: counts([50, 10, 5, 5, 0]) }] })).status).toBe(200);
    const view = (await (await call("GET", `/api/ops/gtm/campaigns/${id}/funnel?from=2026-09-01&to=2026-09-30`)).json()) as {
      days: { day: string; conversion: Record<string, number | null> }[]; total: { counts: Record<string, number> };
    };
    expect(view.days.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(view.days[0]!.conversion.signup).toBe(0.2);
    expect(view.total.counts.visit).toBe(150);
    expect((await call("PATCH", `/api/ops/gtm/campaigns/${id}`, { status: "ended", endsOn: "2026-09-30" })).status).toBe(200);
  });

  it("拒绝逐人 / 自由文本：邮箱、IP、活动名称、负数、未知活动都进不来", async () => {
    const id = "cmp_rejecttests01";
    await call("POST", "/api/ops/gtm/campaigns", { id, channel: "organic", status: "running", startsOn: "2026-09-01" });
    const base = { campaignId: id, day: "2026-09-03", counts: counts([1, 1, 1, 1, 1]) };
    for (const bad of [
      { days: [{ ...base, email: "x@example.com" }] },
      { days: [{ ...base, counts: { ...base.counts, ip: 1 } }] },
      { days: [{ ...base, campaignId: "Spring launch for ACME" }] },
      { days: [{ ...base, counts: { ...base.counts, visit: -1 } }] },
    ]) expect((await call("POST", "/api/ops/gtm/funnel", bad)).status).toBe(400);
    expect((await call("POST", "/api/ops/gtm/funnel", { days: [{ ...base, campaignId: "cmp_doesnotexist0" }] })).status).toBe(422);
    expect((await call("POST", "/api/ops/gtm/campaigns", { id: "cmp_named0000001", channel: "event", status: "planned", startsOn: "2026-10-01", name: "ACME 客户答谢会" })).status).toBe(400);
  });

  it("落盘的每一条记录都过 strict schema（没有 schema 之外的东西；空集不算绿）", async () => {
    const e = env as Env;
    const stub = e.GTM.get(e.GTM.idFromName("global"));
    const stored = await runInDurableObject(stub, async (_i, state) => [...(await state.storage.list()).entries()]);
    expect(stored.length).toBeGreaterThan(0);
    for (const [key, value] of stored) {
      const shape = key.startsWith("cmp:") ? GtmStoredShapes.shape.campaign : GtmStoredShapes.shape.funnelDay;
      expect(shape.safeParse(value).success, key).toBe(true);
    }
  });

  it("转化率读时派生，上一步为 0 不编造", () => {
    expect(conversionRates(counts([0, 0, 0, 0, 0])).signup).toBeNull();
  });
});
