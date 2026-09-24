/**
 * Phase 18 F08 —— 召回结果的可解释性与「不静默降级」（uc-18-2 R3 / R4-E1 / E2，context-pack delta D-I1 / D-I2），
 * 以及它真的进了对话模型的输入（真库 + 真 executeQueuedRuns）。
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import type { KnowledgeRecallPort } from "../../src/application/knowledge-graph/ports";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { RECALL_DEGRADED_NOTICE, buildKnowledgeContextMessage } from "../../src/domain/knowledge-graph/recall";
import { toOrgId } from "../../src/domain/org-id";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { addChatMessage } from "../support/chat-db";
import { asApp } from "../support/db";
import { seedRecallOrg } from "../knowledge-graph/kg-recall-fixtures";

const ORG = "org-kg-f08-reasons";
const T1 = "thr-kg-f08-r1";
const AGENT = "agent-kg-f08";
let db: PgDatabase;
let port: PgKnowledgeRecall;
const noLog = () => undefined;
const recall = (query: string, p: KnowledgeRecallPort = port) =>
  recallThreadKnowledge(p, { orgId: toOrgId(ORG), userId: "u-owner", threadId: T1, query }, noLog);
const graphDown: () => KnowledgeRecallPort = () => ({
  recordTurn: async () => undefined,
  candidates: (...a) => port.candidates(...a),
  graphNeighbors: async () => { throw new Error("KG_GRAPH_UNAVAILABLE: simulated"); },
});

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  await seedRecallOrg(db, ORG, [T1]);
  port = new PgKnowledgeRecall(db);
});
afterAll(async () => { await db.close(); });

describe("F08: 每条带理由，缺席的通道显式记录", () => {
  it("每条都有 retrievalReasons 与 channels；两路都中的标「lead」；有 graphPath ⇒ channels 含 graph（D-I2）", async () => {
    const r = await recall("v2 是谁定的？");
    expect(r.items.length).toBeGreaterThan(0);
    for (const i of r.items) {
      expect(i.retrievalReasons.length).toBeGreaterThan(0);
      expect(i.channels.length).toBeGreaterThan(0);
      if (i.graphPath !== null) expect(i.channels).toContain("graph");
      if (i.channels.length > 1) expect(i.retrievalReasons).toContain("lead");
    }
  });

  it("向量路本阶段没有嵌入：available = false 且 hitCount = 0，而不是悄悄略过（D-I1）", async () => {
    const r = await recall("v2 是谁定的？");
    expect(r.plan.find((p) => p.channel === "vector")).toEqual({ channel: "vector", weight: 0, hitCount: 0, available: false });
    for (const p of r.plan) if (!p.available) expect(p.hitCount).toBe(0);
  });

  it("AGE 不可用：图路记为不可用，给模型的材料里带上「可能不完整」那句原话（R4-E1）", async () => {
    const r = await recall("v2 是谁定的？", graphDown());
    expect(r.plan.find((p) => p.channel === "graph")?.available).toBe(false);
    expect(buildKnowledgeContextMessage(r)).toContain(RECALL_DEGRADED_NOTICE);
    const ok = buildKnowledgeContextMessage(await recall("v2 是谁定的？"))!;
    expect(ok).not.toContain(RECALL_DEGRADED_NOTICE);
    expect(ok).toContain("[AI 记下的] 张三决定下周一上线 v2");
  });

  it("没有相关记忆 ⇒ 不往上下文塞任何东西", async () => {
    expect(buildKnowledgeContextMessage(await recall("今天天气怎么样"))).toBeNull();
  });
});

describe("F08: 记忆真的进了模型的输入（executeQueuedRuns）", () => {
  it("问「v2 是谁定的」时，模型收到的 history 里有一条【记忆】材料；召回失败时 run 照常成功", async () => {
    const instructions = "You are a helpful assistant.";
    await asApp(ORG, async (c) => {
      await c.query(`INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
                     VALUES ($1,$2,$1,'F08','enabled','u-owner',now(),now())`, [AGENT, ORG]);
      await c.query(`INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
                       model_provider,model_id,tool_policy,creator_id,created_at,published_at)
                     VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],'p','m','[]'::jsonb,'u-owner',now(),now())`,
        [`${AGENT}-v1`, ORG, AGENT, createHash("sha256").update(instructions).digest("hex"), instructions]);
    });
    const runOnce = async (runId: string, knowledge: KnowledgeRecallPort) => {
      const qid = `q-${runId}`;
      await addChatMessage({ orgId: ORG, id: qid, threadId: T1, body: "v2 是谁定的？", authorId: "u-owner" });
      await asApp(ORG, (c) => c.query(
        `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids, model_provider, model_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'p','m','queued')`, [runId, ORG, T1, qid, AGENT, `${AGENT}-v1`]));
      const calls: ModelCallInput[] = [];
      let tick = 0;
      const deps: ExecuteAgentRunDeps = {
        runs: new PgAgentRunRepository(db),
        model: { complete: async (input) => { calls.push(input); return { text: "是张三定的。" }; } },
        knowledge,
        clock: { now: () => new Date(Date.now() + tick++).toISOString(), newStepId: () => `step-${runId}-${tick}` },
        log: () => {},
      };
      await executeQueuedRuns(deps, { orgId: toOrgId(ORG) });
      expect(await writeBackPendingRuns(deps, { orgId: toOrgId(ORG) })).toBe(1);
      return calls.at(-1)!;
    };
    const call = await runOnce("run-kg-f08-1", port);
    const memory = (call.history ?? []).find((m) => m.content.startsWith("【记忆】"));
    expect(memory?.content).toContain("张三决定下周一上线 v2");

    const broken: KnowledgeRecallPort = { recordTurn: async () => undefined, candidates: async () => { throw new Error("db down"); }, graphNeighbors: async () => [] };
    const call2 = await runOnce("run-kg-f08-2", broken);
    expect((call2.history ?? []).some((m) => m.content.startsWith("【记忆】"))).toBe(false);
  });
});
