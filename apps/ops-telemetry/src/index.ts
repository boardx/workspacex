/**
 * ops-telemetry Worker —— 超级实例 S4 边缘收集与投影（backlog D10）。内部运营平面。
 *
 * 硬安全规则：本面绝不存客户内容、自然人信息、凭据值、计费账本、客户可审计的证据。
 * 落盘的只有 `InstanceTelemetryReport` parse 的输出 + 边缘接收时刻（见 fleet.ts StoredReport）。
 * 本文件**不打任何日志**：上报体、认证头都不进 console。
 *
 * 路由：
 *   POST /v1/report          实例上报（Bearer 安装密钥；sha256(密钥) 必须等于 instanceId）
 *   GET  /fleet              车队只读视图（Access）
 *   GET  /api/fleet          车队投影 JSON（Access）
 *   POST /api/fleet/rebuild  丢弃车队索引，从每实例 DO 的最新上报重建（Access）
 */
import { verifyAccess } from "./access";
import { FleetIndex, InstanceReports } from "./durable-objects";
import { MAX_BODY_BYTES, parseReport, type InstanceSummary, type StoredReport } from "./fleet";
import { FLEET_HTML } from "./view";

export { FleetIndex, InstanceReports };

export interface Env {
  INSTANCE: DurableObjectNamespace<InstanceReports>;
  FLEET: DurableObjectNamespace<FleetIndex>;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const fleetStub = (env: Env) => env.FLEET.get(env.FLEET.idFromName("fleet"));

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "unsupported_media_type" }, 415);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = parseReport(body);
  // 只回问题路径，不回原值——错误响应也不能成为回显客户数据的通道。
  if (!parsed.success) return json({ error: "invalid_report", paths: parsed.error.issues.map((i) => i.path.join(".")) }, 422);

  const auth = request.headers.get("authorization") ?? "";
  const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!secret || !timingSafeEqualHex(await sha256Hex(secret), parsed.data.instanceId)) return json({ error: "unauthorized" }, 401);

  const stored: StoredReport = { receivedAt: Date.now(), report: parsed.data };
  const inst = env.INSTANCE.get(env.INSTANCE.idFromName(parsed.data.instanceId));
  const res = await inst.fetch("https://do/ingest", { method: "POST", body: JSON.stringify(stored) });
  if (res.status !== 200) return json({ error: res.status === 429 ? "rate_limited" : "rejected" }, res.status === 429 ? 429 : 400);
  const { summary } = (await res.json()) as { summary: InstanceSummary };
  await fleetStub(env).fetch("https://do/upsert", { method: "POST", body: JSON.stringify(summary) });
  return new Response(null, { status: 202 });
}

async function rebuild(env: Env): Promise<Response> {
  const fleet = fleetStub(env);
  const ids = (await (await fleet.fetch("https://do/ids")).json()) as string[];
  const records: StoredReport[] = [];
  for (const id of ids) {
    const r = await env.INSTANCE.get(env.INSTANCE.idFromName(id)).fetch("https://do/latest");
    if (r.ok) records.push((await r.json()) as StoredReport);
  }
  const res = await fleet.fetch("https://do/rebuild", { method: "POST", body: JSON.stringify({ records }) });
  return json(await res.json());
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/v1/report") {
      return request.method === "POST" ? handleReport(request, env) : json({ error: "method_not_allowed" }, 405);
    }
    if (pathname === "/fleet" || pathname.startsWith("/api/")) {
      const access = await verifyAccess(request, env);
      if (!access.ok) return json({ error: access.status === 503 ? "access_not_configured" : "unauthorized" }, access.status);
      if (request.method === "GET" && pathname === "/fleet") {
        return new Response(FLEET_HTML, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
          },
        });
      }
      if (request.method === "GET" && pathname === "/api/fleet") {
        return fleetStub(env).fetch(`https://do/projection?now=${Date.now()}`);
      }
      if (request.method === "POST" && pathname === "/api/fleet/rebuild") return rebuild(env);
    }
    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
