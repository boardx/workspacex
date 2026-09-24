/**
 * 事故面板存储：单例 Durable Object。每条记录落盘前都过 IncidentRecord（strict）——
 * schema 之外的字段进不来，这是「不存客户内容」在运行时的最后一道。
 */
import { DurableObject } from "cloudflare:workers";
import { CreateIncidentInput, IncidentRecord, UpdateIncidentInput } from "./incident-schema";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `inc_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class IncidentLog extends DurableObject {
  private async all(): Promise<IncidentRecord[]> {
    const map = await this.ctx.storage.list<IncidentRecord>({ prefix: "inc_" });
    return [...map.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  private async save(record: IncidentRecord): Promise<Response | null> {
    const checked = IncidentRecord.safeParse(record);
    if (!checked.success) return json(422, { error: "INCIDENT_SCHEMA_VIOLATION" });
    await this.ctx.storage.put(checked.data.id, checked.data);
    return null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["incidents", id?, "resolve"?]
    const now = new Date().toISOString();

    if (request.method === "GET" && parts.length === 1) return json(200, { incidents: await this.all() });

    if (request.method === "POST" && parts.length === 1) {
      const input = CreateIncidentInput.safeParse(await request.json().catch(() => null));
      if (!input.success) return json(400, { error: "INVALID_INCIDENT_INPUT", fields: input.error.issues.map((i) => i.path.join(".")) });
      const record: IncidentRecord = {
        id: newId(), ...input.data, status: "investigating", openedAt: now,
        timeline: [{ at: now, status: "investigating", severity: input.data.severity }],
      };
      return (await this.save(record)) ?? json(201, { incident: record });
    }

    const id = parts[1];
    if (!id) return json(404, { error: "NOT_FOUND" });
    const existing = await this.ctx.storage.get<IncidentRecord>(id);
    if (!existing) return json(404, { error: "INCIDENT_NOT_FOUND" });
    if (request.method === "GET" && parts.length === 2) return json(200, { incident: existing });
    if (existing.status === "resolved") return json(409, { error: "INCIDENT_ALREADY_RESOLVED" });

    let next: IncidentRecord;
    if (request.method === "PATCH" && parts.length === 2) {
      const input = UpdateIncidentInput.safeParse(await request.json().catch(() => null));
      if (!input.success) return json(400, { error: "INVALID_INCIDENT_INPUT", fields: input.error.issues.map((i) => i.path.join(".")) });
      next = { ...existing, ...input.data };
    } else if (request.method === "POST" && parts[2] === "resolve" && parts.length === 3) {
      next = { ...existing, status: "resolved", resolvedAt: now };
    } else {
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }
    if (next.status !== existing.status || next.severity !== existing.severity) {
      next.timeline = [...existing.timeline, { at: now, status: next.status, severity: next.severity }];
    }
    return (await this.save(next)) ?? json(200, { incident: next });
  }
}
