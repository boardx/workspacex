/** 全局通知中心的两个推送口（run 状态、邮件）：用假 DB / 假总线 / 假邮件传输验证"谁收到、带什么、去重键是什么"。 */
import { describe, expect, it, vi } from "vitest";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { RunEventBusPort } from "../../src/application/agent-run/run-event-bus";
import type { PublishNotificationInput } from "../../src/application/notifications/notification-center";
import { NotifyingRunEventBus } from "../../src/infrastructure/notifications/notifying-run-event-bus";
import { NotifyingMailTransport } from "../../src/infrastructure/notifications/notifying-mail-transport";
import { PgNotificationCenter } from "../../src/infrastructure/notifications/pg-notification-center";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-notify");
function fakeDb(rows: Record<string, unknown>[] = []) {
  const queries: { sql: string; params: readonly unknown[]; tenant: string | null }[] = [];
  let tenant: string | null = null;
  const session: TenantSession = { query: async (sql, params = []) => { queries.push({ sql, params, tenant }); return { rows: rows as never[], rowCount: rows.length } as never; } };
  const db: DatabasePort = {
    withTenant: async (orgId, fn) => { tenant = orgId; try { return await fn(session); } finally { tenant = null; } },
    withoutTenant: async (fn) => fn(session),
  } as DatabasePort;
  return { db, queries };
}
const publisher = () => { const published: PublishNotificationInput[] = []; return { published, publish: async (input: PublishNotificationInput) => { published.push(input); } }; };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("NotifyingRunEventBus", () => {
  const innerBus = (): RunEventBusPort & { events: unknown[] } => {
    const events: unknown[] = [];
    return { events, publish: (_org, _run, build) => { events.push(build(7)); }, subscribe: () => () => {} };
  };
  it("forwards every event and pushes a task notice to the run's human author on terminal states", async () => {
    const inner = innerBus(); const { db, queries } = fakeDb([{ author_id: "alice", thread_id: "thread-1", title: "季度报告" }]); const sink = publisher();
    const bus = new NotifyingRunEventBus(inner, db, sink, () => {});
    bus.publish(ORG, "run-1", (seq) => ({ type: "status_change", runId: "run-1", seq, status: "succeeded", pausedBy: null, emittedAt: "now" }));
    await flush();
    expect(inner.events).toHaveLength(1);
    expect(queries[0]?.tenant).toBe(ORG);
    expect(queries[0]?.params).toEqual([ORG, "run-1"]);
    expect(sink.published).toEqual([{ orgId: ORG, userId: "alice", kind: "task", title: "季度报告 · 已完成", body: "任务已完成，点开查看结果。", threadId: "thread-1", sourceKey: "run:run-1:succeeded" }]);
  });
  it("stays silent for in-progress states and for non-status events", async () => {
    const inner = innerBus(); const { db, queries } = fakeDb([{ author_id: "alice", thread_id: "t", title: "x" }]); const sink = publisher();
    const bus = new NotifyingRunEventBus(inner, db, sink, () => {});
    bus.publish(ORG, "run-1", (seq) => ({ type: "status_change", runId: "run-1", seq, status: "running", pausedBy: null, emittedAt: "now" }));
    bus.publish(ORG, "run-1", (seq) => ({ type: "checkpoint_saved", runId: "run-1", seq, checkpointId: "c", emittedAt: "now" } as never));
    await flush();
    expect(inner.events).toHaveLength(2);
    expect(queries).toHaveLength(0);
    expect(sink.published).toEqual([]);
  });
  it("never lets a notification failure reach the publisher", async () => {
    const inner = innerBus(); const log = vi.fn();
    const db = { withTenant: async () => { throw new Error("db down"); }, withoutTenant: async () => { throw new Error("db down"); } } as unknown as DatabasePort;
    const bus = new NotifyingRunEventBus(inner, db, publisher(), log);
    expect(() => bus.publish(ORG, "run-1", (seq) => ({ type: "status_change", runId: "run-1", seq, status: "failed", pausedBy: null, emittedAt: "now" }))).not.toThrow();
    await flush();
    expect(inner.events).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("run status notification failed", expect.objectContaining({ runId: "run-1", status: "failed" }));
  });
});

describe("NotifyingMailTransport", () => {
  it("pushes an email notice (subject only, no body) to a registered recipient across orgs", async () => {
    const inner = { send: vi.fn(async () => ({ providerMessageId: "msg-9" })) };
    const credentials = { findByEmail: vi.fn(async (email: string) => email === "alice@example.com" ? { userId: "alice" } as never : null) };
    const sink = publisher();
    const transport = new NotifyingMailTransport(inner, credentials, sink, () => {});
    await transport.send({ to: "Alice@Example.com", subject: "重置密码", text: "secret-token-in-body" });
    expect(credentials.findByEmail).toHaveBeenCalledWith("alice@example.com");
    expect(sink.published).toEqual([{ orgId: null, userId: "alice", kind: "email", title: "邮件：重置密码", body: "已向 Alice@Example.com 发送一封邮件。", sourceKey: "mail:msg-9" }]);
    expect(JSON.stringify(sink.published)).not.toContain("secret-token");
  });
  it("skips unknown recipients and still returns the transport result", async () => {
    const inner = { send: vi.fn(async () => ({})) }; const sink = publisher();
    const transport = new NotifyingMailTransport(inner, { findByEmail: async () => null }, sink, () => {});
    await expect(transport.send({ to: "nobody@example.com", subject: "s", text: "t" })).resolves.toEqual({});
    expect(sink.published).toEqual([]);
  });
});

describe("PgNotificationCenter", () => {
  it("scopes reads and acks to the viewer and inserts idempotently", async () => {
    const { db, queries } = fakeDb([]);
    const center = new PgNotificationCenter(db);
    await center.publish({ orgId: ORG, userId: "alice", kind: "task", title: "t", body: "b", threadId: "th", sourceKey: "k" });
    await center.publish({ orgId: null, userId: "alice", kind: "email", title: "t", body: "b" });
    await center.list({ orgId: ORG, userId: "alice" });
    await center.markRead({ orgId: ORG, userId: "alice" }, { ids: ["00000000-0000-4000-8000-000000000001"] });
    await center.markRead({ orgId: ORG, userId: "alice" }, {});
    expect(queries[0]?.tenant).toBe(ORG); expect(queries[0]?.sql).toContain("ON CONFLICT DO NOTHING");
    expect(queries[1]?.tenant).toBeNull(); expect(queries[1]?.params[0]).toBeNull();
    for (const q of queries.slice(2)) { expect(q.sql).toContain("WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2)"); expect(q.params.slice(0, 2)).toEqual(["alice", ORG]); }
    expect(queries[4]?.params[2]).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(queries[5]?.params[2]).toBeNull();
  });
});
