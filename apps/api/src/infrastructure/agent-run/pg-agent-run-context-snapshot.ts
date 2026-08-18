/**
 * `AgentRunContextSnapshotPort` 的 PostgreSQL 实现（F157，08-chat/uc-8-7 R3②；F190 追加
 * 工具调用轨迹三列）。
 *
 * 一 run 一行、写入一次——`record` 用 `ON CONFLICT (run_id) DO NOTHING`，防御性幂等
 * （见该表迁移与端口文档：claim 已经是 exactly-once，这里不是这条不变量的唯一来源）。
 */
import type { OrgId } from "../../domain/org-id";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  AgentRunContextSnapshot, AgentRunContextSnapshotInput, AgentRunContextSnapshotPort,
  ContextLayerStatus, L3RetrievalScope, VisionInputStatus,
} from "../../application/agent-run/context-snapshot";

interface SnapshotRow {
  l1_message_count: number;
  l2_status: string;
  l2_covered_through_id: string | null;
  l3_status: string;
  l3_hit_count: number;
  l3_sources: unknown;
  l3_retrieval_scope: string | null;
  tool_trace_status: string | null;
  tool_trace_run_count: number | null;
  tool_trace_step_count: number | null;
  vision_status: string | null;
  vision_image_count: number | null;
  vision_omitted_count: number | null;
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

/** F190：历史行（迁移前写入）这一列是 `NULL`——那些 run 确实没有工具轨迹这层参与
 *  （`deps.toolTrace` 从未被注入过），读侧按 `"not_configured"` 处理，不编造一个值。 */
function toToolTraceStatus(raw: string | null): ContextLayerStatus {
  return raw === "ok" || raw === "degraded" ? raw : "not_configured";
}

/** P2（#1561）：历史行（迁移前写入）这一列是 `NULL`——那些 run 确实没有图像输入这一层
 *  （落地前 `ModelCallInput` 根本没有图像位），读侧按 `"none"` 处理，不编造一个值。 */
function toVisionStatus(raw: string | null): VisionInputStatus {
  return raw === "ok" || raw === "degraded" || raw === "not_supported" || raw === "not_configured"
    ? raw
    : "none";
}

export class PgAgentRunContextSnapshot implements AgentRunContextSnapshotPort {
  constructor(private readonly db: DatabasePort) {}

  async record(orgId: OrgId, snapshot: AgentRunContextSnapshotInput): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO agent_run_context_snapshots
           (run_id, org_id, l1_message_count, l2_status, l2_covered_through_id,
            l3_status, l3_hit_count, l3_sources, l3_retrieval_scope,
            tool_trace_status, tool_trace_run_count, tool_trace_step_count,
            vision_status, vision_image_count, vision_omitted_count, estimated_tokens)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (run_id) DO NOTHING`,
        [
          snapshot.runId, orgId, snapshot.l1MessageCount, snapshot.l2Status,
          snapshot.l2CoveredThroughId, snapshot.l3Status, snapshot.l3HitCount,
          JSON.stringify(snapshot.l3Sources), snapshot.l3RetrievalScope,
          snapshot.toolTraceStatus, snapshot.toolTraceRunCount, snapshot.toolTraceStepCount,
          snapshot.visionStatus, snapshot.visionImageCount, snapshot.visionOmittedCount,
          snapshot.estimatedTokens,
        ],
      );
    });
  }

  async findByRunId(orgId: OrgId, runId: string): Promise<AgentRunContextSnapshot | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<SnapshotRow>(
        `SELECT l1_message_count, l2_status, l2_covered_through_id, l3_status,
                l3_hit_count, l3_sources, l3_retrieval_scope,
                tool_trace_status, tool_trace_run_count, tool_trace_step_count,
                vision_status, vision_image_count, vision_omitted_count,
                estimated_tokens, created_at
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
        toolTraceStatus: toToolTraceStatus(row.tool_trace_status),
        toolTraceRunCount: row.tool_trace_run_count ?? 0,
        toolTraceStepCount: row.tool_trace_step_count ?? 0,
        visionStatus: toVisionStatus(row.vision_status),
        visionImageCount: row.vision_image_count ?? 0,
        visionOmittedCount: row.vision_omitted_count ?? 0,
        estimatedTokens: row.estimated_tokens,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }
}
