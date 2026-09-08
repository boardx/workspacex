/**
 * debug recorder 端到端（issue #3082）：真 Nest 应用 + 真 Postgres + 真 Redis。
 * 证明的是那条完整链路：一个被 guard 拒掉的请求 → 中间件记 `http.request` → 批量落库 →
 * 平台超管按响应头里的 `x-trace-id` 从 `GET /system/debug/traces/:traceId` 读回来；
 * 非平台运营准入拿 403；`/status` 能看到记录器的计数。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";
import { DEBUG_TRACE_PORT, type DebugTracePort } from "../../src/application/ports/debug-trace.port";
import { DebugRecorder } from "../../src/application/diagnostics/debug-recorder";

process.env.KERNEL_QUIET = "1";

const ORG = "org-i3082-debug";
const PROJECT = "proj-i3082-debug";
const ADMIN = "u-i3082-superuser";
const ADMIN_EMAIL = "superuser@i3082.test";
const MEMBER = "u-i3082-member";
const MEMBER_EMAIL = "member@i3082.test";
const PASSWORD = "correct-horse-battery-staple";

let BASE: string;
let app: NestExpressApplication;
let trace: DebugTracePort;
const ORIGINAL_SUPERUSERS = process.env.PLATFORM_SUPERUSER_EMAILS;

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  process.env.PLATFORM_SUPERUSER_EMAILS = ADMIN_EMAIL;
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  trace = app.get<DebugTracePort>(DEBUG_TRACE_PORT);
}, 120_000);

afterAll(async () => {
  if (ORIGINAL_SUPERUSERS === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = ORIGINAL_SUPERUSERS;
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([ADMIN, MEMBER], [ADMIN_EMAIL, MEMBER_EMAIL]);
  await asOwner((c) => c.query("DELETE FROM debug_events"));
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ADMIN, "consultant", fx.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: ADMIN, email: ADMIN_EMAIL, password: PASSWORD });
  await seedCredential({ userId: MEMBER, email: MEMBER_EMAIL, password: PASSWORD });
});

async function loginAs(email: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`);
  return ((await res.json()) as { sessionToken: string }).sessionToken;
}

describe("debug recorder over HTTP", () => {
  it("a guard-rejected request is recorded, persisted, and readable by traceId by a platform superuser", async () => {
    // 1. 一个未登录请求：guard 拒掉 → 401。中间件仍然记它（这正是 middleware 而非 interceptor 的理由）。
    const rejected = await fetch(`${BASE}/system/debug/status`);
    expect(rejected.status).toBe(401);
    const traceId = rejected.headers.get("x-trace-id");
    expect(traceId).toBeTruthy();

    // 2. 缓冲 → 落库。生产里由 interval / batchSize 驱动，这里手动。
    await trace.flush();
    expect(trace.stats()).toMatchObject({ flushFailures: 0 });
    expect(trace.stats().flushed).toBeGreaterThan(0);

    // 3. 平台超管按 traceId 读回：同一条链路里就是那条 401 的 http.request。
    const token = await loginAs(ADMIN_EMAIL);
    const res = await fetch(`${BASE}/system/debug/traces/${traceId}`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { traceId: string; items: { kind: string; level: string; msg: string; data: { status: number } }[] };
    expect(body.traceId).toBe(traceId);
    const http = body.items.find((e) => e.kind === "http.request");
    expect(http).toBeDefined();
    expect(http).toMatchObject({ level: "warn", msg: expect.stringContaining("GET /system/debug/status -> 401") });
    expect(http!.data.status).toBe(401);

    // 4. 列表过滤 + 状态口。
    const list = await fetch(`${BASE}/system/debug/events?level=warn&kind=http&limit=10`, { headers: { authorization: `Bearer ${token}` } });
    expect(list.status).toBe(200);
    const page = (await list.json()) as { items: { traceId: string }[]; hasMore: boolean };
    expect(page.items.some((e) => e.traceId === traceId)).toBe(true);

    const status = await fetch(`${BASE}/system/debug/status`, { headers: { authorization: `Bearer ${token}` } });
    expect(status.status).toBe(200);
    const s = (await status.json()) as { enabled: boolean; flushed: number; inFlightRequests: { path: string }[] };
    expect(s.enabled).toBe(true);
    expect(s.flushed).toBeGreaterThan(0);
    // 自己这条请求还在飞行中——status 是在响应前算的。
    expect(s.inFlightRequests.some((r) => r.path === "/system/debug/status")).toBe(true);
  });

  it("an ordinary org member is refused (403) -- the table has no tenant scope, so org roles cannot open it", async () => {
    const token = await loginAs(MEMBER_EMAIL);
    for (const path of ["/system/debug/events", "/system/debug/traces/x", "/system/debug/status"]) {
      const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status, path).toBe(403);
    }
  });

  it("the recorder wired by kernel.module is a DebugRecorder with the request middleware attached (memory source works before any flush)", async () => {
    expect(trace).toBeInstanceOf(DebugRecorder);
    const probe = await fetch(`${BASE}/system/debug/events`);
    const traceId = probe.headers.get("x-trace-id")!;
    const token = await loginAs(ADMIN_EMAIL);
    const res = await fetch(`${BASE}/system/debug/events?source=memory&traceId=${traceId}`, { headers: { authorization: `Bearer ${token}` } });
    const page = (await res.json()) as { items: { id: string; kind: string }[] };
    expect(page.items.map((e) => e.kind)).toEqual(["http.request"]);
    expect(page.items[0]!.id.startsWith("mem-")).toBe(true);
  });
});
