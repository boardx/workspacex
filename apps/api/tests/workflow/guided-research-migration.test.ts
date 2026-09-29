/**
 * WF07 —— 引导式研究迁到通用 Workflow Runtime（02-workflow-runtime.md R3-12 / E12；ADR-118 第 8 条 Stage 1）。
 *
 * ① 静态门：research 基础设施不再引用 langgraph_interview / interview/workflow；旧 saver 文件已删除；
 *    `guided-research:1` 在代码图注册表里注册且节点集合一致。
 * ② 真实 PostgreSQL：旧运行时写在 langgraph_interview 的会话 checkpoint 与 guided_research_node_receipts
 *    receipt，经迁移 20260929070000 搬到 langgraph_workflow / workflow_receipts 后，新运行时能续跑并按
 *    旧 receipt 重放；迁移报告未迁清单为 0；搬不动（新 schema 缺线程）的会话会被列出而不是静默丢弃。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { research as C } from "@repo/contracts";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GuidedResearchWorkflowService } from "../../src/application/research/guided-workflow-service";
import {
  GUIDED_RESEARCH_GRAPH_NODE_IDS,
  GUIDED_RESEARCH_GRAPH_REF,
} from "../../src/application/research/guided-research-workflow-graph";
import type { GuidedResearchNodeReceiptRepository } from "../../src/application/research/guided-workflow-receipt-ports";
import type { GuidedResearchSession } from "../../src/application/research/guided-session-ports";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { toOrgId } from "../../src/domain/org-id";
import { PgGuidedResearchWorkflowReceipts } from "../../src/infrastructure/research/pg-guided-research-workflow-receipts";
import { NamespacedCheckpointSaver } from "../../src/infrastructure/workflow/namespaced-checkpoint-saver";
import {
  LEGACY_GUIDED_RESEARCH_CHECKPOINT_NS,
  reportGuidedResearchMigration,
} from "../../scripts/lib/guided-research-stage1-migration";
import { defaultCommandWorkflowGraphs, defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { WORKFLOW_CHECKPOINT_SCHEMA, createWorkflowCheckpointerFactory } from "../../src/infrastructure/workflow/workflow-checkpointer-factory";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const API = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = join(API, "migrations/20260929070000_wf07_guided_research_workflow_runtime.sql");
const ORG = "org-wf07-migrate";
const OWNER = "u-wf07-owner";
const MOVED = "grs-wf07-moved";
const STUCK = "grs-wf07-stuck";
const THREADS = [MOVED, STUCK];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function session(sessionId: string): GuidedResearchSession {
  return C.GuidedResearchSession.parse({
    sessionId,
    title: "欧洲储能进入研究",
    tags: ["储能"],
    brief: { topic: "欧洲储能市场进入策略", goal: "确定首批进入国家", timeRange: "2025-2028", region: "欧洲", focus: "市场" },
    stage: "directions",
    resumeStage: "directions",
    status: "active",
    progress: 0,
    sourceCount: 0,
    reportId: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  });
}

/** 旧运行时的 receipt 只在内存里（我们只需要它写 checkpoint）。 */
const noReceipts: GuidedResearchNodeReceiptRepository = {
  find: async () => null,
  begin: async () => null,
  finalize: async () => undefined,
};

const saveBrief = (sessionId: string, requestId: string, expectedGraphVersion: number) => C.GuidedResearchNodeCommand.parse({
  sessionId,
  node: "brief",
  action: "save",
  requestId,
  expectedGraphVersion,
  nodeState: {
    name: "欧洲储能进入研究", tags: ["储能"], topic: "欧洲储能市场进入策略", objective: "确定首批进入国家",
    timeRange: "2025-2028", geography: "欧洲", focus: "迁移前保存的焦点",
  },
});

async function deleteThreads(schema: string): Promise<void> {
  await asOwner(async (c) => {
    for (const t of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) {
      await c.query(`DELETE FROM ${schema}.${t} WHERE thread_id = ANY($1)`, [THREADS]);
    }
  });
}

describe("WF07 guided research migrated onto the workflow runtime", () => {
  it("research infrastructure no longer references langgraph_interview or the interview workflow runtime", () => {
    expect(existsSync(join(API, "src/infrastructure/research/langgraph-guided-research-runtime.ts"))).toBe(false);
    for (const f of walk(join(API, "src/infrastructure/research"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/langgraph_interview|interview\/workflow/);
    }
    for (const f of [...walk(join(API, "src/application/research")), ...walk(join(API, "src/infrastructure/workflow"))]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/langgraph-digital-interview-runtime/);
    }
    const kernel = readFileSync(join(API, "src/kernel.module.ts"), "utf8");
    expect(kernel).not.toMatch(/createGuidedResearchCheckpointer|PgGuidedResearchNodeReceiptRepository/);
  });

  it("registers guided-research@1 in the code graph registry with its node set", () => {
    expect(GUIDED_RESEARCH_GRAPH_REF).toBe("guided-research:1");
    const registry = new WorkflowGraphRegistry(defaultWorkflowGraphs(), defaultCommandWorkflowGraphs());
    expect(registry.nodeIdsOf("guided-research:1")).toEqual(GUIDED_RESEARCH_GRAPH_NODE_IDS);
    expect(registry.has("guided-research:1")).toBe(true);
    // 命令驱动图由引导式研究用例自己推进，线性驱动不接手
    expect(registry.get("guided-research:1")).toBeNull();
    expect(() => new WorkflowGraphRegistry([], [...defaultCommandWorkflowGraphs(), ...defaultCommandWorkflowGraphs()])).toThrow(/twice/);
  });

  describe("against PostgreSQL", () => {
    let pool: pg.Pool;
    let db: PgDatabase;
    let legacyPool: pg.Pool;

    beforeAll(async () => {
      ensureDatabase();
      await migrateOnce();
      pool = new pg.Pool({ ...appConfig(), max: 3 });
      legacyPool = new pg.Pool({ ...appConfig(), max: 2 });
      db = new PgDatabase(appConfig());
      await deleteThreads("langgraph_interview");
      await deleteThreads(WORKFLOW_CHECKPOINT_SCHEMA);
      await resetOrgs(ORG);
      await seedOrg({ orgId: ORG, projectId: "proj-wf07" });
      await asOwner(async (c) => {
        for (const id of THREADS) {
          await c.query(
            `INSERT INTO guided_research_sessions (id, org_id, owner_user_id, idempotency_key, title, brief, stage, resume_stage)
             VALUES ($1, $2, $3, $1, '欧洲储能进入研究', '{}'::jsonb, 'directions', 'directions')`,
            [id, ORG, OWNER],
          );
        }
      });
    }, 60_000);

    afterAll(async () => {
      await deleteThreads("langgraph_interview");
      await deleteThreads(WORKFLOW_CHECKPOINT_SCHEMA);
      await resetOrgs(ORG);
      await pool?.end();
      await legacyPool?.end();
      await db?.close();
    });

    it("moves legacy checkpoints and receipts, resumes on the new runtime, and reports 0 unmigrated sessions", async () => {
      // —— 旧运行时：langgraph_interview + checkpoint_ns=guided-research:v1 ——
      const legacySaver = new NamespacedCheckpointSaver(
        new PostgresSaver(legacyPool, undefined, { schema: "langgraph_interview" }),
        LEGACY_GUIDED_RESEARCH_CHECKPOINT_NS,
      );
      const legacy = new GuidedResearchWorkflowService(noReceipts, legacySaver);
      const orgId = toOrgId(ORG);
      const saved = await legacy.execute({ orgId, session: session(MOVED), command: saveBrief(MOVED, "req-wf07-legacy-1", 0) });
      expect(saved.graphVersion).toBe(1);
      await legacy.getWorkflow(session(STUCK));
      const pendingCommand = saveBrief(MOVED, "req-wf07-legacy-pending", 1);
      await asOwner(async (c) => {
        await c.query(
          `INSERT INTO guided_research_node_receipts
             (id, org_id, session_id, request_id, node, action, payload_fingerprint, status, checkpoint_id, graph_version,
              projection_version, stable_response, finalized_at)
           VALUES ('grr-wf07-1', $1, $2, 'req-wf07-legacy-1', 'brief', 'save', 'fp-legacy-1', 'finalized', 'cp-1', 1, 1, $3::jsonb, now()),
                  ('grr-wf07-2', $1, $2, 'req-wf07-legacy-pending', 'brief', 'save', 'fp-legacy-2', 'pending', NULL, NULL, NULL, NULL, NULL)`,
          [ORG, MOVED, JSON.stringify(saved)],
        );
      });

      // —— 迁移（可重放：跑两次结果一致） ——
      const sql = readFileSync(MIGRATION, "utf8");
      await asOwner((c) => c.query(sql));
      await asOwner((c) => c.query(sql));

      const moved = await asOwner((c) => c.query<{ thread_id: string; n: string }>(
        `SELECT thread_id, count(*) AS n FROM ${WORKFLOW_CHECKPOINT_SCHEMA}.checkpoints
          WHERE checkpoint_ns = $1 AND thread_id = ANY($2) GROUP BY thread_id ORDER BY thread_id`,
        [GUIDED_RESEARCH_GRAPH_REF, THREADS],
      ));
      expect(moved.rows.map((r) => r.thread_id)).toEqual([MOVED, STUCK]);
      const receipts = await asOwner((c) => c.query<{ request_key: string; status: string; fingerprint: string }>(
        `SELECT request_key, status, fingerprint FROM workflow_receipts WHERE org_id = $1 AND scope = 'command' ORDER BY request_key`,
        [ORG],
      ));
      expect(receipts.rows).toEqual([
        { request_key: `guided-research:${MOVED}:req-wf07-legacy-1`, status: "finalized", fingerprint: "fp-legacy-1" },
        { request_key: `guided-research:${MOVED}:req-wf07-legacy-pending`, status: "begun", fingerprint: "fp-legacy-2" },
      ]);

      const report = await asOwner((c) => reportGuidedResearchMigration(c));
      expect(report.unmigrated.filter((u) => THREADS.includes(u.sessionId))).toEqual([]);

      // —— 新运行时：checkpointer 工厂 + workflow_receipts ——
      const saver = createWorkflowCheckpointerFactory(pool).saverFor(GUIDED_RESEARCH_GRAPH_REF);
      const runtime = new GuidedResearchWorkflowService(new PgGuidedResearchWorkflowReceipts(db), saver);
      // 迁过来的 checkpoint 直接续上（不是重新起图：graphVersion 仍是 1、保存的焦点还在）
      const resumed = await runtime.getWorkflow(session(MOVED));
      expect(resumed).toEqual(saved);
      // 旧 finalized receipt 在新表里重放：返回原稳定响应，不推进图
      const receiptReplay = new PgGuidedResearchWorkflowReceipts(db);
      expect((await receiptReplay.find({ orgId, sessionId: MOVED, requestId: "req-wf07-legacy-1" }))?.stableResponse).toEqual(saved);
      // 旧 pending receipt 仍是 in-flight：重发同 requestId 被拒而不是二次执行
      await expect(runtime.execute({ orgId, session: session(MOVED), command: pendingCommand }))
        .rejects.toMatchObject({ reasonCode: "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH" });
      // 新命令写进 langgraph_workflow，不再碰 langgraph_interview
      const legacyBefore = await asOwner((c) => c.query(
        "SELECT count(*)::int AS n FROM langgraph_interview.checkpoints WHERE thread_id = $1", [MOVED],
      ));
      const next = await runtime.execute({ orgId, session: session(MOVED), command: saveBrief(MOVED, "req-wf07-new-1", 1) });
      expect(next.graphVersion).toBe(2);
      const legacyAfter = await asOwner((c) => c.query(
        "SELECT count(*)::int AS n FROM langgraph_interview.checkpoints WHERE thread_id = $1", [MOVED],
      ));
      expect(legacyAfter.rows[0].n).toBe(legacyBefore.rows[0].n);
      const newReceipt = await asOwner((c) => c.query(
        "SELECT status FROM workflow_receipts WHERE org_id = $1 AND request_key = $2",
        [ORG, `guided-research:${MOVED}:req-wf07-new-1`],
      ));
      expect(newReceipt.rows).toEqual([{ status: "finalized" }]);
      const oldTable = await asOwner((c) => c.query(
        "SELECT count(*)::int AS n FROM guided_research_node_receipts WHERE request_id = 'req-wf07-new-1'",
      ));
      expect(oldTable.rows[0].n).toBe(0);
    });

    it("lists a session whose checkpoint could not be moved instead of silently dropping it (E12)", async () => {
      await asOwner((c) => c.query(
        `DELETE FROM ${WORKFLOW_CHECKPOINT_SCHEMA}.checkpoints WHERE thread_id = $1 AND checkpoint_ns = $2`,
        [STUCK, GUIDED_RESEARCH_GRAPH_REF],
      ));
      const report = await asOwner((c) => reportGuidedResearchMigration(c));
      expect(report.unmigrated.filter((u) => THREADS.includes(u.sessionId))).toEqual([
        { sessionId: STUCK, reason: "checkpoint_missing" },
      ]);
      // 旧数据仍在，只读可查看
      const legacy = await asOwner((c) => c.query(
        "SELECT count(*)::int AS n FROM langgraph_interview.checkpoints WHERE thread_id = $1 AND checkpoint_ns = $2",
        [STUCK, LEGACY_GUIDED_RESEARCH_CHECKPOINT_NS],
      ));
      expect(legacy.rows[0].n).toBeGreaterThan(0);
    });
  });
});
