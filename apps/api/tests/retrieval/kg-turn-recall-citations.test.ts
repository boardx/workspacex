/**
 * Phase 18 F13 —— 回答下方的记忆引用（uc-18-2 R8 / uc-18-4 R3-6），真实数据库 + 真 AGE。
 *
 * 执行器召回后记下这一轮用到了哪些记忆；getTurnMemory 按查看者重新读出来：
 *   - 个人空间的那条标 scope=personal、带最早说出来的日期（界面：「来自你 {日期} 的对话」）；
 *   - 经图路找到的带可读的关系路径（「客户 A —关于→ …」）；
 *   - 共享会话里，别的成员看同一条回答只看到会话本身的记忆，看不到提问人的个人记忆；
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

  it("共享会话：提问人看到会话记忆 + 自己的个人记忆；别的成员看同一条回答只看到会话记忆", async () => {
    const { answerId } = await turn(fx.S, "run-f13-s");
    const owner = await read(fx.S, answerId, "u-owner");
    expect(new Set(owner.recalled.map((r) => r.scope))).toEqual(new Set(["chat_session", "personal"]));
    const member = await read(fx.S, answerId, "u-member");
    expect(member.recalled.map((r) => r.scope)).toEqual(["chat_session"]);
    expect(member.recalled.map((r) => r.statement)).toEqual(["客户 A 的合同在法务那里"]);
    // 关系路径的端点里也不能出现提问人的个人实体名（成员那边只剩会话的）
    expect(JSON.stringify(member.recalled)).not.toContain(DEMAND);
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

  it("那条记忆后来被忘掉 ⇒ 之前那条回答下方也不再引用它", async () => {
    await asOwner((c) => c.query(
      "UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_revoked' WHERE id = $1", [fx.personalClaimId]));
    expect((await read(fx.B, "ans-run-f13-b")).recalled).toEqual([]);
  });
});
