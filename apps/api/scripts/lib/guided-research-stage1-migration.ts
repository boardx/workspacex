/**
 * WF07 —— 引导式研究 Stage 1 迁移的核对报告（02-workflow-runtime.md E12）。
 *
 * 搬运本身在迁移 20260929070000 里逐线程做；本函数只读：列出旧 schema `langgraph_interview`
 * （checkpoint_ns = 'guided-research:v1'）里存在、但新 schema `langgraph_workflow`
 * （checkpoint_ns = GUIDED_RESEARCH_GRAPH_REF）里缺失或最新 checkpoint 不一致的会话。
 * 这些会话保持只读可查看（旧行不删），报告清单期望为空。
 * 另核对（WF07 review）：checkpoint 最新 id 对上但 blobs / writes 行数少于旧 schema 的线程记为
 * `blobs_or_writes_missing`；旧 receipt 在 workflow_receipts 里找不到对应 request_key 的列入
 * `unmigratedReceipts`（迁移不再丢任何 receipt，清单期望为空）。
 */
import type pg from "pg";
import { GUIDED_RESEARCH_GRAPH_REF } from "../../src/application/research/guided-research-workflow-graph";
import { WORKFLOW_CHECKPOINT_SCHEMA } from "../../src/infrastructure/workflow/workflow-checkpointer-factory";

export const LEGACY_GUIDED_RESEARCH_CHECKPOINT_NS = "guided-research:v1";

export interface UnmigratedGuidedResearchSession {
  readonly sessionId: string;
  readonly reason: "checkpoint_missing" | "checkpoint_mismatch" | "blobs_or_writes_missing";
}

export interface UnmigratedGuidedResearchReceipt {
  readonly orgId: string;
  readonly sessionId: string;
  readonly requestId: string;
}

export interface GuidedResearchMigrationReport {
  readonly legacySessions: number;
  readonly migratedSessions: number;
  readonly unmigrated: readonly UnmigratedGuidedResearchSession[];
  readonly unmigratedReceipts: readonly UnmigratedGuidedResearchReceipt[];
}

type Queryable = Pick<pg.Pool | pg.Client, "query">;

export async function reportGuidedResearchMigration(db: Queryable): Promise<GuidedResearchMigrationReport> {
  const W = WORKFLOW_CHECKPOINT_SCHEMA;
  const { rows } = await db.query<{
    thread_id: string; old_latest: string; new_latest: string | null;
    old_blobs: number; new_blobs: number; old_writes: number; new_writes: number;
  }>(
    `WITH old AS (
       SELECT thread_id, max(checkpoint_id) AS latest FROM langgraph_interview.checkpoints
        WHERE checkpoint_ns = $1 GROUP BY thread_id
     ), fresh AS (
       SELECT thread_id, max(checkpoint_id) AS latest FROM ${W}.checkpoints
        WHERE checkpoint_ns = $2 GROUP BY thread_id
     )
     SELECT old.thread_id, old.latest AS old_latest, fresh.latest AS new_latest,
            (SELECT count(*)::int FROM langgraph_interview.checkpoint_blobs b
              WHERE b.thread_id = old.thread_id AND b.checkpoint_ns = $1) AS old_blobs,
            (SELECT count(*)::int FROM ${W}.checkpoint_blobs b
              WHERE b.thread_id = old.thread_id AND b.checkpoint_ns = $2) AS new_blobs,
            (SELECT count(*)::int FROM langgraph_interview.checkpoint_writes w
              WHERE w.thread_id = old.thread_id AND w.checkpoint_ns = $1) AS old_writes,
            (SELECT count(*)::int FROM ${W}.checkpoint_writes w
              WHERE w.thread_id = old.thread_id AND w.checkpoint_ns = $2) AS new_writes
       FROM old LEFT JOIN fresh USING (thread_id) ORDER BY old.thread_id`,
    [LEGACY_GUIDED_RESEARCH_CHECKPOINT_NS, GUIDED_RESEARCH_GRAPH_REF],
  );
  const unmigrated = rows.flatMap((r): UnmigratedGuidedResearchSession[] =>
    r.new_latest === null
      ? [{ sessionId: r.thread_id, reason: "checkpoint_missing" }]
      : r.new_latest < r.old_latest
        ? [{ sessionId: r.thread_id, reason: "checkpoint_mismatch" }]
        : r.new_blobs < r.old_blobs || r.new_writes < r.old_writes
          ? [{ sessionId: r.thread_id, reason: "blobs_or_writes_missing" }]
          : [],
  );
  const receipts = await db.query<{ org_id: string; session_id: string; request_id: string }>(
    `SELECT g.org_id, g.session_id, g.request_id FROM guided_research_node_receipts g
      WHERE NOT EXISTS (
        SELECT 1 FROM workflow_receipts r
         WHERE r.org_id = g.org_id AND r.scope = 'command'
           AND r.request_key = 'guided-research:' || g.session_id || ':' || g.request_id)
      ORDER BY g.org_id, g.session_id, g.request_id`,
  );
  return {
    legacySessions: rows.length,
    migratedSessions: rows.length - unmigrated.length,
    unmigrated,
    unmigratedReceipts: receipts.rows.map((r) => ({ orgId: r.org_id, sessionId: r.session_id, requestId: r.request_id })),
  };
}
