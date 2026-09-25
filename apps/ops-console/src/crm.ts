/**
 * CRM 边缘（backlog D3）：线索只以不透明 leadId + 非个人信息状态存在这里。
 *
 * 路由（index.ts 在 Access 校验之后转发到 DO）：
 *   GET   /crm/leads
 *   POST  /crm/leads                 { leadId, stage, channel, campaignId? }（leadId 由境内源站生成）
 *   GET   /crm/leads/:leadId
 *   PATCH /crm/leads/:leadId         { stage?, campaignId? }
 * 详情页 `GET /api/ops/crm/leads/:leadId/view` 由 index.ts 渲染（见 {@link leadDetailPage}）。
 *
 * ## 详情页「回源」为什么在浏览器里做，而不是 Worker 代取
 *
 * Worker 代取意味着个人信息要穿过 Cloudflare 的边缘节点（可能在境外）——那本身就是一次跨境传输，
 * 而跨境传输「待法务确认」。所以本 Worker **从不请求源站的 CRM 接口**：页面只带 leadId 与源站地址，
 * 由运营人员的浏览器在查看时用自己的源站会话直接调 `GET /system/crm/contacts/:leadId`（no-store），
 * 个人信息从境内源站直达浏览器，边缘既看不到、也存不了。
 */
import { DurableObject } from "cloudflare:workers";
import { CreateLeadRefInput, LeadRef, UpdateLeadRefInput } from "./crm-schema";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bad = (issues: { path: (string | number)[] }[]) => json(400, { error: "INVALID_LEAD_INPUT", fields: issues.map((i) => i.path.join(".")) });

export class CrmLeadLog extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const parts = new URL(request.url).pathname.split("/").filter(Boolean); // ["crm","leads",id?]
    const now = new Date().toISOString();
    if (parts[1] !== "leads") return json(404, { error: "NOT_FOUND" });

    if (parts.length === 2 && request.method === "GET") {
      const map = await this.ctx.storage.list<LeadRef>({ prefix: "lead_" });
      return json(200, { leads: [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    if (parts.length === 2 && request.method === "POST") {
      const input = CreateLeadRefInput.safeParse(await request.json().catch(() => null));
      if (!input.success) return bad(input.error.issues);
      if (await this.ctx.storage.get(input.data.leadId)) return json(409, { error: "LEAD_EXISTS" });
      const record = LeadRef.parse({ ...input.data, createdAt: now, updatedAt: now });
      await this.ctx.storage.put(record.leadId, record);
      return json(201, { lead: record });
    }

    const id = parts[2];
    if (!id || parts.length !== 3) return json(404, { error: "NOT_FOUND" });
    const existing = await this.ctx.storage.get<LeadRef>(id);
    if (!existing) return json(404, { error: "LEAD_NOT_FOUND" });
    if (request.method === "GET") return json(200, { lead: existing });
    if (request.method === "PATCH") {
      const input = UpdateLeadRefInput.safeParse(await request.json().catch(() => null));
      if (!input.success) return bad(input.error.issues);
      const checked = LeadRef.safeParse({ ...existing, ...input.data, updatedAt: now });
      if (!checked.success) return json(422, { error: "CRM_SCHEMA_VIOLATION" });
      await this.ctx.storage.put(id, checked.data);
      return json(200, { lead: checked.data });
    }
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * 详情页 HTML：边缘字段直接渲染；个人信息区由浏览器脚本回源填充（textContent，不拼 HTML）。
 * CSP 把 connect-src 钉死在源站——页面脚本只能连源站，连不回本 Worker。
 */
export function leadDetailPage(lead: LeadRef, originBase: string): Response {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const origin = new URL(originBase).origin;
  const contactUrl = `${originBase.replace(/\/+$/, "")}/system/crm/contacts/${lead.leadId}`;
  const rows = ([["leadId", lead.leadId], ["阶段", lead.stage], ["渠道", lead.channel], ["活动", lead.campaignId ?? "—"], ["更新", lead.updatedAt]] as const)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>线索 ${esc(lead.leadId)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<h1>线索 ${esc(lead.leadId)}</h1>
<table>${rows}</table>
<h2>联系人（境内源站实时读取，不经运营平面）</h2>
<dl id="pi"><dt>状态</dt><dd id="pi-status">加载中…</dd></dl>
<script nonce="${nonce}">
(async () => {
  const box = document.getElementById("pi"), status = document.getElementById("pi-status");
  try {
    const res = await fetch(${JSON.stringify(contactUrl)}, { credentials: "include", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!res.ok) { status.textContent = "源站返回 " + res.status + "（需在源站以平台运营身份登录）"; return; }
    const c = await res.json();
    box.textContent = "";
    for (const [k, label] of [["name","姓名"],["company","公司"],["phone","电话"],["email","邮箱"],["notes","备注"]]) {
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = c[k] ?? "—";
      box.append(dt, dd);
    }
  } catch { status.textContent = "无法连接源站"; }
})();
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src ${origin}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
