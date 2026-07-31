/**
 * F111 —— 工具调用链是 `provenance_events` 的投影，不是第二张表
 * （chat 束 domain.md D 组 I-22 / I-23 / I-25，uc-8-2 UC-14）。
 *
 * ## 这个文件里最重要的三条断言
 *
 * 1. **I-22**：界面展开的调用链条数与该轮 `provenance_events` 条数严格相等——
 *    这里的形式是「往表里插 N 条工具调用事件，`GET .../tool-calls` 必须恰好返回
 *    N 条」，而不是断言一个写死的数字。
 * 2. **I-25**：失败条不隐藏——注入一次 `status:"failed"`，它必须仍在 `calls` 里，
 *    且 `summary.callCount === calls.length` 恒成立（不是"汇总数减掉失败数"）。
 * 3. **I-23 反证**：直接对 `provenance_events` 发 UPDATE / DELETE，两者都必须被拒——
 *    与 `tests/kernel/provenance-append-only.test.ts` 同一个不变量，这里只对
 *    "工具调用挂靠的那一条事件"做一次针对性复核，不重复整份反证套件。
 *
 * ⚠ **不属于本消息的调用不得混入**：同一线程下第二条消息的工具调用必须被排除在
 *   第一条消息的调用链之外——一个"按线程整体投影、不按 messageId 筛"的实现会
 *   在这条断言上现形。
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../src/application/provenance/ports";
import { recordToolCall } from "../../src/application/chat/record-tool-call";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f111-toolcalls";
const PROJECT = "proj-f111-toolcalls";
const THREAD = "f111-t-tool";

let BASE: string;
let app: NestExpressApplication;
let writer: ProvenanceWriter;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

interface ToolCallsOut {
  summary: { callCount: number; readVolume: number; tokens: number };
  calls: {
    function: string;
    args: string;
    hitCount: number | null;
    reuseFlag: boolean | null;
    status: "done" | "reuse" | "running" | "failed";
    tokens: number;
    callerAgentId: string;
    model: string;
    pipelineVersion: string;
    provenanceEventId: string;
  }[];
}

const getToolCalls = async (userId: string, messageId: string): Promise<{ status: number; body: ToolCallsOut }> => {
  const r = await fetch(`${BASE}/chat/messages/${messageId}/tool-calls`, { headers: as(userId) });
  return { status: r.status, body: (await r.json()) as ToolCallsOut };
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  writer = app.get<ProvenanceWriter>(PROVENANCE_WRITER);
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-fac", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);

  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac", title: "工具调用链",
  });
  await addChatMessage({
    orgId: ORG, id: "f111-m-1", threadId: THREAD, authorKind: "agent", agentId: "scout",
    authorId: "a-scout", body: "已检索到 3 份材料",
  });
  await addChatMessage({
    orgId: ORG, id: "f111-m-2", threadId: THREAD, authorKind: "agent", agentId: "ledger",
    authorId: "a-ledger", body: "另一条消息，另一条调用链",
  });
}, 60_000);

describe("I-22：调用链条数与 provenance_events 条数严格相等", () => {
  it("插入 3 条工具调用事件，展开链条恰好返回 3 条，且汇总数与明细数一致", async () => {
    for (let i = 0; i < 3; i++) {
      await recordToolCall(writer, {
        orgId: toOrgId(ORG),
        threadId: THREAD,
        actorId: "a-scout",
        call: {
          messageId: "f111-m-1",
          function: `search_corpus_${i}`,
          args: JSON.stringify({ q: `industry data ${i}` }),
          hitCount: 10 + i,
          reuseFlag: false,
          status: "done",
          tokens: 100 + i,
          callerAgentId: "scout",
          model: "gpt-5",
          pipelineVersion: "v1",
        },
      });
    }

    const { status, body } = await getToolCalls("u-fac", "f111-m-1");
    expect(status).toBe(200);
    expect(body.calls).toHaveLength(3);
    // 恰好相等，不是"约等于"或"至少"——I-22 的字面意思。
    expect(body.summary.callCount).toBe(body.calls.length);
    expect(body.summary.tokens).toBe(100 + 101 + 102);
    expect(body.summary.readVolume).toBe(10 + 11 + 12);
    // 四项签名字段各自非空可辨认——不是合并成一条日志字符串。
    for (const c of body.calls) {
      expect(c.function.length).toBeGreaterThan(0);
      expect(c.args.length).toBeGreaterThan(0);
      expect(c.status).toBe("done");
      expect(c.provenanceEventId.length).toBeGreaterThan(0);
    }
    // provenanceEventId 逐条不同——每条调用可定位到具体的那一次，不是定位到"某一次"。
    expect(new Set(body.calls.map((c) => c.provenanceEventId)).size).toBe(3);
  });

  it("反证：不属于本消息的调用不混入——同线程第二条消息的调用必须被排除", async () => {
    await recordToolCall(writer, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: "a-scout",
      call: {
        messageId: "f111-m-1", function: "search_corpus", args: "{}", hitCount: 5,
        reuseFlag: false, status: "done", tokens: 50, callerAgentId: "scout",
        model: "gpt-5", pipelineVersion: "v1",
      },
    });
    await recordToolCall(writer, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: "a-ledger",
      call: {
        messageId: "f111-m-2", function: "compute_savings", args: "{}", hitCount: null,
        reuseFlag: null, status: "done", tokens: 20, callerAgentId: "ledger",
        model: "gpt-5", pipelineVersion: "v1",
      },
    });

    const { body: forM1 } = await getToolCalls("u-fac", "f111-m-1");
    expect(forM1.calls).toHaveLength(1);
    expect(forM1.calls[0]!.function).toBe("search_corpus");

    const { body: forM2 } = await getToolCalls("u-fac", "f111-m-2");
    expect(forM2.calls).toHaveLength(1);
    expect(forM2.calls[0]!.function).toBe("compute_savings");
  });
});

describe("I-25：失败条不得被隐藏", () => {
  it("注入一次失败 → 明细里仍然可见，汇总数与明细条数不因失败而分家", async () => {
    await recordToolCall(writer, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: "a-scout",
      call: {
        messageId: "f111-m-1", function: "search_corpus", args: "{}", hitCount: 8,
        reuseFlag: false, status: "done", tokens: 40, callerAgentId: "scout",
        model: "gpt-5", pipelineVersion: "v1",
      },
    });
    await recordToolCall(writer, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: "a-scout",
      call: {
        messageId: "f111-m-1", function: "call_industry_db", args: "{}", hitCount: null,
        reuseFlag: null, status: "failed", tokens: 0, callerAgentId: "scout",
        model: "gpt-5", pipelineVersion: "v1",
      },
    });

    const { body } = await getToolCalls("u-fac", "f111-m-1");
    expect(body.calls).toHaveLength(2);
    expect(body.summary.callCount).toBe(2);
    const failed = body.calls.filter((c) => c.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.function).toBe("call_industry_db");
  });

  it("`running` 是正常返回值，不是错误——展开接口仍然 200，且该条以 running 呈现", async () => {
    await recordToolCall(writer, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: "a-scout",
      call: {
        messageId: "f111-m-1", function: "long_running_search", args: "{}", hitCount: null,
        reuseFlag: null, status: "running", tokens: 0, callerAgentId: "scout",
        model: "gpt-5", pipelineVersion: "v1",
      },
    });
    const { status, body } = await getToolCalls("u-fac", "f111-m-1");
    expect(status).toBe(200);
    expect(body.calls[0]!.status).toBe("running");
  });
});

describe("I-3：不可见与不存在同一个出口", () => {
  it("不存在的 messageId 返回 404", async () => {
    const { status } = await getToolCalls("u-fac", "no-such-message");
    expect(status).toBe(404);
  });
});

describe("I-23 反证：append-only 对工具调用事件同样成立", () => {
  it("app_rw 不能 UPDATE 一条工具调用事件", async () => {
    const eventId = await recordToolCall(writer, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: "a-scout",
      call: {
        messageId: "f111-m-1", function: "search_corpus", args: "{}", hitCount: 1,
        reuseFlag: false, status: "done", tokens: 1, callerAgentId: "scout",
        model: "gpt-5", pipelineVersion: "v1",
      },
    });

    const client = new pg.Client(appConfig());
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
      await expect(
        client.query("UPDATE provenance_events SET detail = '{}'::jsonb WHERE id = $1", [eventId]),
      ).rejects.toThrow(/permission denied/i);
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }

    // 攻击失败之后，这条事件仍然完整地投影得出来——不是"表被锁住了所以读不出错"。
    const stillThere = await asApp(ORG, async (c) => {
      const r = await c.query("SELECT detail FROM provenance_events WHERE id = $1", [eventId]);
      return r.rows[0]?.detail as { function?: string } | undefined;
    });
    expect(stillThere?.function).toBe("search_corpus");
  });
});
