/**
 * Phase 18 F13 —— 回答下方的记忆引用（uc-18-2 R8 / uc-18-4 R3-6），真实数据库 + 真 AGE。
 *
 * 执行器召回后记下这一轮用到了哪些记忆；getTurnMemory 按查看者重新读出来：
 *   - 个人空间的那条标 scope=personal、带最早说出来的日期（界面：「来自你 {日期} 的对话」）；
 *   - 经图路找到的带可读的关系路径（「客户 A —关于→ …」）；
 *   - 共享（项目）会话里不召回个人记忆（F12 R5），所以引用里也只有会话记忆；读接口另按查看者复核：
 *     即便记录里混进了个人空间的 id，别的成员也看不到；
 *   - 记忆之后被忘掉 ⇒ 不再出现在引用里；图路不可用 ⇒ recallDegraded；
 *   - 记录写失败 ⇒ 回答照常带记忆（不拖累对话）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KnowledgeRecallPort } from "../../src/application/knowledge-graph/ports";
import { getTurnMemory } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { knowledgeMemoryFor } from "../../src/application/knowledge-graph/recall-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { addChatMessage } from "../support/chat-db";
import { asOwner } from "../support/db";
import { DEMAND, seedL1Org, type L1Org } from "./kg-l1-fixtures";

const ORG = "org-kg-f13-cite";
const ORG_ID = toOrgId(ORG);
const Q = "客户 A 有什么要求？";
let db: PgDatabase;
let port: PgKnowledgeRecall;
let fx: L1Org;
const logs: string[] = [];
const log = (m: string) => { logs.push(m); };

/** 模拟一轮：发起人提问 → 执行器召回并记录 → 回答写回（chat_messages.agent_run_id 指向这个 run）。 */
async function turn(threadId: string, runId: string, userId = "u-owner", p: KnowledgeRecallPort = port) {
  const memory = await knowledgeMemoryFor(p, { orgId: ORG_ID, userId, threadId, query: Q, runId }, log);
  const answerId = `ans-${runId}`;
  await addChatMessage({ orgId: ORG, id: answerId, threadId, body: "（回答）", authorId: "agent-1", authorKind: "agent", agentId: "agent-1" });
  await asOwner((c) => c.query("UPDATE chat_messages SET agent_run_id = $1 WHERE id = $2", [runId, answerId]));
  return { memory, answerId };
}
const sqlRows = <T>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as T[]);
const read = (threadId: string, messageId: string, userId = "u-owner") =>
  getTurnMemory(fx.readDeps, { userId, orgId: ORG_ID, threadId, messageId });

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  fx = await seedL1Org(db, ORG);
  port = new PgKnowledgeRecall(db);
});
afterAll(async () => { await db.close(); });

describe("F13: 回答下方的记忆引用", () => {
  it("新会话里用到了个人空间的那条：scope=personal、你确认过、带日期，经图路找到的带可读关系路径", async () => {
    const { memory, answerId } = await turn(fx.B, "run-f13-b");
    expect(memory).toContain(DEMAND);
    const out = await read(fx.B, answerId);
    expect(out.recallDegraded).toBe(false);
    expect(out.recalled).toHaveLength(1);
    const [m] = out.recalled;
    expect(m).toMatchObject({ claimId: fx.personalClaimId, statement: DEMAND, scope: "personal", triState: "confirmed", channels: ["fts", "graph"] });
    expect(m!.saidAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(m!.retrievalReasons).toEqual(["recall", "lead"]);
    expect(m!.graphPath).toEqual([{ from: "客户 A", relation: "about", to: DEMAND }]);
  });

  it("共享会话：不召回个人记忆，提问人和成员都只看到会话记忆；记录里即便混进个人 id，成员也看不到", async () => {
    const { answerId } = await turn(fx.S, "run-f13-s");
    const owner = await read(fx.S, answerId, "u-owner");
    expect(owner.recalled.map((r) => r.scope)).toEqual(["chat_session"]);
    const member = await read(fx.S, answerId, "u-member");
    expect(member.recalled.map((r) => r.statement)).toEqual(["客户 A 的合同在法务那里"]);
    // 读侧的第二道：往这条记录里硬塞提问人的个人结论，成员读到的仍只有会话记忆
    await asOwner((c) => c.query(
      `UPDATE kg_turn_recalls SET items = items || jsonb_build_array(jsonb_build_object(
         'claimId', $2::text, 'channels', '["fts"]'::jsonb, 'retrievalReasons', '["fts"]'::jsonb, 'score', 0.01, 'graphPath', NULL))
        WHERE run_id = $1`, ["run-f13-s", fx.personalClaimId]));
    const member2 = await read(fx.S, answerId, "u-member");
    expect(member2.recalled.map((r) => r.scope)).toEqual(["chat_session"]);
    expect(JSON.stringify(member2.recalled)).not.toContain(DEMAND);
    const owner2 = await read(fx.S, answerId, "u-owner");
    expect(owner2.recalled.map((r) => r.statement)).toContain(DEMAND);
  });

  it("记录里混进别的会话的结论 / 图路经过别的会话的实体（图里是全 org 的 id）⇒ 读的时候丢掉，正文与名字一个字都不出", async () => {
    const [other] = await sqlRows<{ id: string; statement: string }>(
      "SELECT id, statement FROM claims WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND revoked_at IS NULL LIMIT 1", [ORG, fx.A]);
    const [otherObj] = await sqlRows<{ id: string; name: string }>(
      "SELECT id, name FROM ontology_objects WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 LIMIT 1", [ORG, fx.A]);
    await asOwner((c) => c.query("UPDATE claims SET statement = 'SECRET-OTHER-THREAD' WHERE id = $1", [other!.id]));
    await asOwner((c) => c.query("UPDATE ontology_objects SET name = 'SECRET-OBJ' WHERE id = $1", [otherObj!.id]));
    const [{ items }] = await sqlRows<{ items: { claimId: string }[] }>("SELECT items FROM kg_turn_recalls WHERE run_id = 'run-f13-s'");
    const own = items[0]!;
    const forged = [
      { ...own, graphPath: [{ src: `object:${otherObj!.id}`, relation: "about", dst: `claim:${own.claimId}` }] },
      { claimId: other!.id, channels: ["fts"], retrievalReasons: ["fts"], score: 0.02, graphPath: [{ src: `object:${otherObj!.id}`, relation: "about", dst: `claim:${other!.id}` }] },
    ];
    await asOwner((c) => c.query("UPDATE kg_turn_recalls SET items = $2::jsonb WHERE run_id = $1", ["run-f13-s", JSON.stringify(forged)]));
    try {
      for (const viewer of ["u-member", "u-owner"]) {
        const out = await read(fx.S, "ans-run-f13-s", viewer);
        expect(out.recalled.map((r) => r.claimId)).toEqual([own.claimId]);
        expect(out.recalled[0]!.graphPath).toBeNull();
        expect(JSON.stringify(out.recalled)).not.toMatch(/SECRET/);
      }
    } finally {
      await asOwner((c) => c.query("UPDATE kg_turn_recalls SET items = $2::jsonb WHERE run_id = $1", ["run-f13-s", JSON.stringify(items)]));
      await asOwner((c) => c.query("UPDATE claims SET statement = $2 WHERE id = $1", [other!.id, other!.statement]));
      await asOwner((c) => c.query("UPDATE ontology_objects SET name = $2 WHERE id = $1", [otherObj!.id, otherObj!.name]));
    }
  });

  it("同一个 run 重试：记录被覆盖成最后一次（不是保留第一次）", async () => {
    await turn(fx.B, "run-f13-retry");
    expect((await read(fx.B, "ans-run-f13-retry")).recallDegraded).toBe(false);
    const graphDown: KnowledgeRecallPort = {
      candidates: (...a) => port.candidates(...a),
      graphNeighbors: async () => { throw new Error("KG_GRAPH_UNAVAILABLE"); },
      recordTurn: (...a) => port.recordTurn(...a),
    };
    await knowledgeMemoryFor(graphDown, { orgId: ORG_ID, userId: "u-owner", threadId: fx.B, query: Q, runId: "run-f13-retry" }, log);
    expect((await read(fx.B, "ans-run-f13-retry")).recallDegraded).toBe(true);
  });

  it("按记录里的名次返回（不重排）", async () => {
    const [{ items }] = await sqlRows<{ items: { claimId: string }[] }>("SELECT items FROM kg_turn_recalls WHERE run_id = 'run-f13-b'");
    const [second] = await sqlRows<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = 'u-owner' AND revoked_at IS NULL AND id <> $2 LIMIT 1", [ORG, items[0]!.claimId]);
    if (second === undefined) {
      // 夹具里个人空间只有一条时，用同一条的两份记录验证顺序不被打乱是无意义的——改为造一条本人个人结论
      await asOwner((c) => c.query(
        `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by, scope_kind, scope_id, valid_from)
         VALUES ('clm-f13-order', $1, '第二条个人记忆', 'accepted', to_tsvector('simple', '第二条个人记忆'), 'fact', 1, 'human', 'u-owner', 'personal', 'u-owner', now())`, [ORG]));
    }
    const secondId = second?.id ?? "clm-f13-order";
    const reordered = [{ ...items[0]!, claimId: secondId, graphPath: null }, items[0]!];
    await asOwner((c) => c.query("UPDATE kg_turn_recalls SET items = $2::jsonb WHERE run_id = $1", ["run-f13-b", JSON.stringify(reordered)]));
    try {
      expect((await read(fx.B, "ans-run-f13-b")).recalled.map((r) => r.claimId)).toEqual([secondId, items[0]!.claimId]);
    } finally {
      await asOwner((c) => c.query("UPDATE kg_turn_recalls SET items = $2::jsonb WHERE run_id = $1", ["run-f13-b", JSON.stringify(items)]));
    }
  });

  it("没有召回记录的回答（没用到记忆）：recalled 为空、不降级", async () => {
    await addChatMessage({ orgId: ORG, id: "ans-plain", threadId: fx.B, body: "（普通回答）", authorId: "agent-1", authorKind: "agent", agentId: "agent-1" });
    expect(await read(fx.B, "ans-plain")).toMatchObject({ recalled: [], recallDegraded: false });
  });

  it("图路不可用：回答照样带字面召回的记忆，recallDegraded = true", async () => {
    const graphDown: KnowledgeRecallPort = {
      candidates: (...a) => port.candidates(...a),
      graphNeighbors: async () => { throw new Error("KG_GRAPH_UNAVAILABLE"); },
      recordTurn: (...a) => port.recordTurn(...a),
    };
    const { memory, answerId } = await turn(fx.B, "run-f13-down", "u-owner", graphDown);
    expect(memory).toContain("这次没能查全你的记忆");
    const out = await read(fx.B, answerId);
    expect(out.recallDegraded).toBe(true);
    expect(out.recalled.map((r) => r.channels)).toEqual([["fts"]]);
  });

  it("记录写失败不拖累对话：记忆照常交给模型，只记一条日志", async () => {
    const failing: KnowledgeRecallPort = {
      candidates: (...a) => port.candidates(...a),
      graphNeighbors: (...a) => port.graphNeighbors(...a),
      recordTurn: async () => { throw new Error("disk full"); },
    };
    const memory = await knowledgeMemoryFor(failing, { orgId: ORG_ID, userId: "u-owner", threadId: fx.B, query: Q, runId: "run-f13-fail" }, log);
    expect(memory).toContain(DEMAND);
    expect(logs).toContain("knowledge recall could not be recorded for this turn");
  });

  it("失效只看 revoked_at 也要生效：revoked_at 有值、状态没改的结论同样不再引用", async () => {
    await asOwner((c) => c.query("UPDATE claims SET revoked_at = now() WHERE id = $1", [fx.personalClaimId]));
    try {
      expect((await read(fx.B, "ans-run-f13-b")).recalled.map((r) => r.claimId)).not.toContain(fx.personalClaimId);
    } finally {
      await asOwner((c) => c.query("UPDATE claims SET revoked_at = NULL WHERE id = $1", [fx.personalClaimId]));
    }
  });

  it("那条记忆后来被忘掉 ⇒ 之前那条回答下方也不再引用它", async () => {
    await asOwner((c) => c.query(
      "UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_revoked' WHERE id = $1", [fx.personalClaimId]));
    expect((await read(fx.B, "ans-run-f13-b")).recalled).toEqual([]);
  });
});
