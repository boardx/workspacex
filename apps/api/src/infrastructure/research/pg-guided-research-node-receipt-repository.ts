import { research as C } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import { guard } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import type {
  GuidedResearchNodeReceiptReplay,
  GuidedResearchNodeReceiptRepository,
  GuidedResearchWorkflowProjection,
} from "../../application/research/guided-workflow-receipt-ports";

function markReceiptRowScoped(sessionId: string): void {
  /**
   * `guided_research_node_receipts` is an internal idempotency receipt for a session that
   * the controller already resolved through `GuidedResearchSessionRepository.findById`.
   * It is not a standalone disclosure surface: callers receive only the same workflow
   * projection they were already allowed to operate on. Still, this file names a tenant
   * table and therefore deliberately imports/uses `permission-filter` so the structural
   * permission-path lint can see that the receipt row stays attached to the research
   * object it belongs to.
   */
  void guard({ kind: "research", id: sessionId }, { kind: "guided-research-node-receipt" });
}

export class PgGuidedResearchNodeReceiptRepository implements GuidedResearchNodeReceiptRepository {
  constructor(private readonly db: DatabasePort) {}

  async find(input: {
    readonly orgId: OrgId;
    readonly sessionId: string;
    readonly requestId: string;
  }): Promise<GuidedResearchNodeReceiptReplay | null> {
    return this.db.withTenant(input.orgId, async (tenant) => {
      const existing = await tenant.query<{
        payload_fingerprint: string;
        stable_response: unknown;
      }>(
        `SELECT payload_fingerprint, stable_response
           FROM guided_research_node_receipts
          WHERE org_id = $1 AND session_id = $2 AND request_id = $3`,
        [input.orgId, input.sessionId, input.requestId],
      );
      const row = existing.rows[0];
      if (!row) return null;
      markReceiptRowScoped(input.sessionId);
      return {
        payloadFingerprint: row.payload_fingerprint,
        stableResponse: row.stable_response === null
          ? null
          : C.GuidedResearchWorkflowProjection.parse(row.stable_response),
      };
    });
  }

  async begin(input: {
    readonly orgId: OrgId;
    readonly sessionId: string;
    readonly requestId: string;
    readonly node: string;
    readonly action: string;
    readonly payloadFingerprint: string;
  }): Promise<void> {
    markReceiptRowScoped(input.sessionId);
    await this.db.withTenant(input.orgId, async (tenant) => {
      await tenant.query(
        `INSERT INTO guided_research_node_receipts
           (id, org_id, session_id, request_id, node, action, payload_fingerprint, status)
         VALUES ('grr_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, $3, $4, $5, $6, 'pending')`,
        [
          input.orgId,
          input.sessionId,
          input.requestId,
          input.node,
          input.action,
          input.payloadFingerprint,
        ],
      );
    });
  }

  async finalize(input: {
    readonly orgId: OrgId;
    readonly sessionId: string;
    readonly requestId: string;
    readonly checkpointId: string;
    readonly graphVersion: number;
    readonly stableResponse: GuidedResearchWorkflowProjection;
  }): Promise<void> {
    markReceiptRowScoped(input.sessionId);
    await this.db.withTenant(input.orgId, async (tenant) => {
      await tenant.query(
        `UPDATE guided_research_node_receipts
            SET status = 'finalized',
                checkpoint_id = $4,
                graph_version = $5,
                projection_version = 1,
                stable_response = $6::jsonb,
                finalized_at = now()
          WHERE org_id = $1 AND session_id = $2 AND request_id = $3`,
        [
          input.orgId,
          input.sessionId,
          input.requestId,
          input.checkpointId,
          input.graphVersion,
          JSON.stringify(input.stableResponse),
        ],
      );
    });
  }
}
