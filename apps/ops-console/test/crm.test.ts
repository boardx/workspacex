/**
 * D3 —— CRM 边缘：只存不透明 leadId + 非个人信息状态；详情页回源在浏览器里做。
 *
 * 三道断言：
 *   ① schema 门：LeadRef（及输入）的字段名没有一个长成个人信息的样子（遍历到字段才算数）；
 *   ② 行为门：带姓名 / 邮箱等字段的写入被拒；
 *   ③ 不落盘门：打开详情页期间，Worker **没有发出任何网络请求**（fetch 被换成「一旦调用就返回
 *      个人信息」的桩），且查看之后 DO 存储里每条记录都严格等于 LeadRef 形状、不含任何桩里的个人信息。
 */
import { env, runInDurableObject } from "cloudflare:test";
import type { ZodTypeAny } from "zod";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { handle, type Env } from "../src/index";
import { CreateLeadRefInput, LeadRef, UpdateLeadRefInput } from "../src/crm-schema";
import { accessFixture } from "./access-fixture";

const ORIGIN = "https://origin.example.cn";
const fx = accessFixture();
beforeAll(fx.init);
const cfgEnv = (origin = ORIGIN): Env => ({ ...(env as Env), ACCESS_TEAM_DOMAIN: fx.TEAM, ACCESS_AUD: fx.AUD, ORIGIN_CRM_BASE: origin });
async function call(method: string, path: string, body?: unknown, e = cfgEnv()) {
  const headers: Record<string, string> = { "content-type": "application/json", "cf-access-jwt-assertion": await fx.good() };
  return handle(new Request(`https://ops.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), e, fx.deps());
}

const PI_WORDS = ["name", "company", "phone", "mobile", "email", "mail", "notes", "note", "address", "contact", "person",
  "wechat", "title", "ip", "birthday", "id_card", "idcard", "comment", "remark", "text", "description"];
function keys(schema: ZodTypeAny, out: string[] = []): string[] {
  const def = schema._def as { typeName: string; innerType?: ZodTypeAny; schema?: ZodTypeAny; type?: ZodTypeAny; shape?: () => Record<string, ZodTypeAny> };
  if (def.innerType) return keys(def.innerType, out);
  if (def.typeName === "ZodEffects" && def.schema) return keys(def.schema, out);
  if (def.typeName === "ZodArray" && def.type) return keys(def.type, out);
  if (def.typeName === "ZodObject" && def.shape) for (const [k, child] of Object.entries(def.shape())) { out.push(k); keys(child, out); }
  return out;
}
const split = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_-]+/);

describe("① 边缘 CRM schema 无个人信息形状字段", () => {
  for (const [label, schema] of [["LeadRef", LeadRef], ["CreateLeadRefInput", CreateLeadRefInput], ["UpdateLeadRefInput", UpdateLeadRefInput]] as const) {
    it(label, () => {
      const all = keys(schema);
      expect(all.length, "空集不是全绿").toBeGreaterThan(0);
      expect(all.filter((k) => split(k).some((w) => PI_WORDS.includes(w)) || PI_WORDS.includes(k.toLowerCase()))).toEqual([]);
    });
  }
  it("门能红：一个带 contactEmail 的 schema 会被判出来", () => {
    const bad = LeadRef.extend({ contactEmail: LeadRef.shape.createdAt });
    expect(keys(bad).filter((k) => split(k).some((w) => PI_WORDS.includes(w)))).toEqual(["contactEmail"]);
  });
});

const leadId = "lead_00112233445566aa";
const PI = { leadId, name: "张三", company: "某某科技", phone: "+86 138 0000 0000", email: "zhangsan@example.cn", notes: "下周回访" };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("② 写入只接受不透明 id 与状态", () => {
  it("登记线索、改阶段", async () => {
    expect((await call("POST", "/api/ops/crm/leads", { leadId, stage: "new", channel: "event" })).status).toBe(201);
    expect((await call("POST", "/api/ops/crm/leads", { leadId, stage: "new", channel: "event" })).status).toBe(409);
    const upd = await call("PATCH", `/api/ops/crm/leads/${leadId}`, { stage: "qualified" });
    expect(((await upd.json()) as { lead: { stage: string } }).lead.stage).toBe("qualified");
  });
  it("拒绝个人信息字段与非不透明 id", async () => {
    for (const bad of [
      { leadId: "lead_aaaaaaaaaaaaaaaa", stage: "new", channel: "event", name: "张三" },
      { leadId: "lead_aaaaaaaaaaaaaaaa", stage: "new", channel: "event", email: "a@b.cn" },
      { leadId: "zhangsan@example.cn", stage: "new", channel: "event" },
    ]) expect((await call("POST", "/api/ops/crm/leads", bad)).status).toBe(400);
    expect((await call("PATCH", `/api/ops/crm/leads/${leadId}`, { notes: "x" })).status).toBe(400);
  });
});

describe("③ 详情页：浏览器回源，边缘不代取、不落盘", () => {
  it("源站未配置 → 503（fail-closed）", async () => {
    expect((await call("GET", `/api/ops/crm/leads/${leadId}/view`, undefined, cfgEnv(""))).status).toBe(503);
  });

  it("查看详情期间 Worker 零网络请求；页面把回源钉在源站且 no-store；查看后存储只有 LeadRef", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify(PI), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const res = await call("GET", `/api/ops/crm/leads/${leadId}/view`);
    expect(res.status).toBe(200);
    expect(calls, "边缘 Worker 不许自己去源站取个人信息").toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain(`connect-src ${ORIGIN};`);
    const html = await res.text();
    expect(html).toContain(`${ORIGIN}/system/crm/contacts/${leadId}`);
    for (const v of [PI.name, PI.company, PI.phone, PI.email, PI.notes]) expect(html).not.toContain(v);

    const e = env as Env;
    const stored = await runInDurableObject(e.CRM.get(e.CRM.idFromName("global")), async (_i, state) => [...(await state.storage.list()).entries()]);
    expect(stored.length, "空集不是全绿").toBeGreaterThan(0);
    const dump = JSON.stringify(stored);
    for (const v of [PI.name, PI.company, PI.phone, PI.email, PI.notes]) expect(dump).not.toContain(v);
    for (const [, value] of stored) expect(LeadRef.safeParse(value).success).toBe(true);
  });

  it("未知线索 → 404", async () => {
    expect((await call("GET", "/api/ops/crm/leads/lead_ffffffffffffffff/view")).status).toBe(404);
  });
});
