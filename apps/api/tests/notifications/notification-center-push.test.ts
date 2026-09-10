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
const publisher = () => {
  const published: PublishNotificationInput[] = [];
  const superseded: { viewer: unknown; input: unknown }[] = [];
  return {
    published, superseded,
    publish: async (input: PublishNotificationInput) => { published.push(input); },
    supersede: async (viewer: unknown, input: unknown) => { superseded.push({ viewer, input }); },
  };
};
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
    expect(sink.published).toEqual([{ orgId: ORG, userId: "alice", kind: "task", title: "季度报告 · 已完成", body: "任务已完成，点开查看结果。", threadId: "thread-1", sourceKey: "run:run-1:succeeded", actionable: false }]);
  });
  /**
   * issue #3311：「等待你授权工具」是**待办**，「已完成」是**收据**——点击语义不同，
   * 所以类别必须由服务端随通知一起给出（前端不许拿标题字符串反推）。
   */
  it("marks awaiting_* notices actionable so the client can tell 待办 from 收据", async () => {
    const inner = innerBus(); const { db } = fakeDb([{ author_id: "alice", thread_id: "thread-1", title: "你好" }]); const sink = publisher();
    const bus = new NotifyingRunEventBus(inner, db, sink, () => {});
    bus.publish(ORG, "run-1", (seq) => ({ type: "status_change", runId: "run-1", seq, status: "awaiting_tool_permission", pausedBy: null, emittedAt: "now" }));
    await flush();
    expect(sink.published[0]).toMatchObject({ title: "你好 · 等待你授权工具", actionable: true, threadId: "thread-1" });
    expect(sink.published[0]?.body).toBe("任务等待你授权工具，点开去处理。");
  });
  /**
   * issue #3311：待办通知点开不再顺手标已读（事情还没办）。那它由谁收掉？——由这条 run
   * 往前走一步时收掉。没有这一步，修好的"点开不消费"就会变成"角标永远挂着 1"。
   */
  it("reads the run's stale actionable notices when the run moves on (收据 not touched)", async () => {
    const inner = innerBus(); const { db, queries } = fakeDb([{ author_id: "alice", thread_id: "thread-1", title: "你好" }]); const sink = publisher();
    const bus = new NotifyingRunEventBus(inner, db, sink, () => {});
    bus.publish(ORG, "run-1", (seq) => ({ type: "status_change", runId: "run-1", seq, status: "succeeded", pausedBy: null, emittedAt: "now" }));
    await flush();
    expect(sink.superseded, "run 往前走一步必须收掉自己那条待办").toHaveLength(1);
    // 收件人是这条 run 的发起人本人（不是"全org清一遍"），范围是这条 run，且放过刚推的这一条。
    expect(sink.superseded[0]).toEqual({
      viewer: { orgId: ORG, userId: "alice" },
      input: { sourceKeyPrefix: "run:run-1:%", exceptSourceKey: "run:run-1:succeeded" },
    });
    expect(sink.published).toHaveLength(1);
    expect(queries).toHaveLength(1); // 事件总线里仍然只有那一条 run 查询（边界门钉住的事实）。
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
    await center.supersede({ orgId: ORG, userId: "alice" }, { sourceKeyPrefix: "run:r:%", exceptSourceKey: "run:r:succeeded" });
    await center.list({ orgId: ORG, userId: "alice" });
    await center.markRead({ orgId: ORG, userId: "alice" }, { ids: ["00000000-0000-4000-8000-000000000001"] });
    await center.markRead({ orgId: ORG, userId: "alice" }, {});
    expect(queries[0]?.tenant).toBe(ORG); expect(queries[0]?.sql).toContain("ON CONFLICT DO NOTHING");
    expect(queries[1]?.tenant).toBeNull(); expect(queries[1]?.params[0]).toBeNull();
    // supersede 也走同一条收件人/租户绑定，且只碰待办行。
    expect(queries[2]?.sql).toContain("AND source_key LIKE $3 AND source_key<>$4 AND actionable AND read_at IS NULL");
    expect(queries[2]?.params).toEqual(["alice", ORG, "run:r:%", "run:r:succeeded"]);
    for (const q of queries.slice(2)) { expect(q.sql).toContain("WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2)"); expect(q.params.slice(0, 2)).toEqual(["alice", ORG]); }
    expect(queries[5]?.params[2]).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(queries[6]?.params[2]).toBeNull();
  });
});
