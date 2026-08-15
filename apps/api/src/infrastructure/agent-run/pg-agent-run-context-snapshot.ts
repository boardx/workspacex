/**
 * `AgentRunContextSnapshotPort` 的 PostgreSQL 实现（F157，08-chat/uc-8-7 R3②）。
 *
 * 一 run 一行、写入一次——`record` 用 `ON CONFLICT (run_id) DO NOTHING`，防御性幂等
 * （见该表迁移与端口文档：claim 已经是 exactly-once，这里不是这条不变量的唯一来源）。
 */
import type { OrgId } from "../../domain/org-id";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  AgentRunContextSnapshot, AgentRunContextSnapshotInput, AgentRunContextSnapshotPort,
  L3RetrievalScope,
} from "../../application/agent-run/context-snapshot";

interface SnapshotRow {
  l1_message_count: number;
  l2_status: string;
  l2_covered_through_id: string | null;
  l3_status: string;
  l3_hit_count: number;
  l3_sources: unknown;
  l3_retrieval_scope: string | null;
  estimated_tokens: number;
  created_at: Date | string;
}

function toRetrievalScope(raw: string | null): L3RetrievalScope | null {
  return raw === "own-attachment" || raw === "project-retrieval" ? raw : null;
}

function toSources(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

export class PgAgentRunContextSnapshot implements AgentRunContextSnapshotPort {
  constructor(private readonly db: DatabasePort) {}

  async record(orgId: OrgId, snapshot: AgentRunContextSnapshotInput): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO agent_run_context_snapshots
           (run_id, org_id, l1_message_count, l2_status, l2_covered_through_id,
            l3_status, l3_hit_count, l3_sources, l3_retrieval_scope, estimated_tokens)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (run_id) DO NOTHING`,
        [
          snapshot.runId, orgId, snapshot.l1MessageCount, snapshot.l2Status,
          snapshot.l2CoveredThroughId, snapshot.l3Status, snapshot.l3HitCount,
          JSON.stringify(snapshot.l3Sources), snapshot.l3RetrievalScope, snapshot.estimatedTokens,
        ],
      );
    });
  }

  async findByRunId(orgId: OrgId, runId: string): Promise<AgentRunContextSnapshot | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<SnapshotRow>(
        `SELECT l1_message_count, l2_status, l2_covered_through_id, l3_status,
                l3_hit_count, l3_sources, l3_retrieval_scope, estimated_tokens, created_at
           FROM agent_run_context_snapshots
          WHERE org_id=$1 AND run_id=$2`,
        [orgId, runId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        runId,
        l1MessageCount: row.l1_message_count,
        l2Status: row.l2_status === "degraded" ? "degraded" : "ok",
        l2CoveredThroughId: row.l2_covered_through_id,
        l3Status: row.l3_status === "degraded" || row.l3_status === "not_configured"
          ? row.l3_status
          : "ok",
        l3HitCount: row.l3_hit_count,
        l3Sources: toSources(row.l3_sources),
        l3RetrievalScope: toRetrievalScope(row.l3_retrieval_scope),
        estimatedTokens: row.estimated_tokens,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }
}
