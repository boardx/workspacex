import type { PublicInterjection } from "@repo/contracts/interjection-status";
import { AgentRunNotRunningError } from "../../application/agent-run/interject-run";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { InterjectionStore, PendingInterjection, StagedKernelInterjection } from "../../application/agent-run/interjection-store";
import { classifyInterjection } from "../../application/agent-run/interjection-handling";

interface Row { interjection_id: string; text: string; received_at: Date | string; classification: StagedKernelInterjection["classification"] | null }
function project(row: Row): StagedKernelInterjection {
  return { interjectionId: row.interjection_id, text: row.text,
    receivedAt: new Date(row.received_at).toISOString(), classification: row.classification ?? classifyInterjection(row.text) };
}

/** Production queue: at-least-once delivery, checkpoint-message-id deduplication. */
export class PgInterjectionStore implements InterjectionStore {
  constructor(private readonly db: DatabasePort) {}

  async listPublic(orgId:OrgId,runId:string):Promise<readonly PublicInterjection[]> {
    return this.db.withTenant(orgId,async s=>(await s.query<{interjection_id:string;text:string;status:PublicInterjection["status"];received_at:Date;applied_at:Date|null}>(
      `SELECT i.interjection_id,i.text,i.received_at,i.applied_at,
        CASE WHEN i.status='applied' THEN 'applied' WHEN r.status IN('succeeded','failed','cancelled') THEN 'not_applied' ELSE 'received' END AS status
       FROM agent_run_interjections i JOIN agent_runs r ON r.org_id=i.org_id AND r.id=i.run_id
       WHERE i.org_id=$1 AND i.run_id=$2 ORDER BY i.sequence`,[orgId,runId])).rows.map(row=>({interjectionId:row.interjection_id,text:row.text,status:row.status,receivedAt:row.received_at.toISOString(),appliedAt:row.applied_at?.toISOString()??null})));
  }

  async requestPause(orgId: OrgId, runId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ id: string }>(`UPDATE agent_runs SET pause_requested_at=COALESCE(pause_requested_at,now())
        WHERE org_id=$1 AND id=$2 AND status='running' AND paused_at IS NULL RETURNING id`, [orgId, runId]);
      return result.rows.length === 1;
    });
  }

  async isCancelRequested(orgId: OrgId, runId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<{ requested: boolean }>("SELECT cancel_requested_at IS NOT NULL AS requested FROM agent_runs WHERE org_id=$1 AND id=$2", [orgId, runId]);
      return rows[0]?.requested ?? false;
    });
  }

  async isPauseRequested(orgId: OrgId, runId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ requested: boolean }>(`SELECT pause_requested_at IS NOT NULL AS requested
        FROM agent_runs WHERE org_id=$1 AND id=$2`, [orgId, runId]);
      return result.rows[0]?.requested ?? false;
    });
  }

  async submit(orgId: OrgId, runId: string, value: PendingInterjection): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      const active=await s.query(`SELECT id FROM agent_runs WHERE org_id=$1 AND id=$2 AND status='running' FOR UPDATE`,[orgId,runId]);
      if(!active.rows.length) throw new AgentRunNotRunningError("not_running");
      await s.query(`INSERT INTO agent_run_interjections(org_id,run_id,interjection_id,text,received_at)
        SELECT $1,$2,$3,$4,$5 WHERE EXISTS (SELECT 1 FROM agent_runs WHERE org_id=$1 AND id=$2)
        ON CONFLICT (org_id,run_id,interjection_id) DO NOTHING`,
      [orgId, runId, value.interjectionId, value.text, value.receivedAt]);
    });
  }

  async pollForKernel(orgId: OrgId, runId: string, acknowledgedIds: readonly string[]): Promise<readonly StagedKernelInterjection[]> {
    return this.db.withTenant(orgId, async (s) => {
      // Serialize poll/ACK calls for this logical run. No destructive take or lease
      // expiry is needed: repeated delivery has the same stable kernel message id.
      await s.query(`SELECT id FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE`, [orgId, runId]);
      await s.query(`UPDATE agent_run_interjections SET status='applied', applied_at=now()
        WHERE org_id=$1 AND run_id=$2 AND status='staged' AND interjection_id=ANY($3::text[])`,
      [orgId, runId, acknowledgedIds]);
      const { rows } = await s.query<Row>(`SELECT interjection_id,text,received_at,classification
        FROM agent_run_interjections WHERE org_id=$1 AND run_id=$2 AND status<>'applied'
        ORDER BY sequence LIMIT 100 FOR UPDATE`, [orgId, runId]);
      const values = rows.map(project);
      for (const value of values) {
        await s.query(`UPDATE agent_run_interjections SET status='staged', classification=$4
          WHERE org_id=$1 AND run_id=$2 AND interjection_id=$3`,
        [orgId, runId, value.interjectionId, value.classification]);
      }
      return values;
    });
  }

  // Legacy gateway compatibility. Delivery is retained; only live kernel ACK can
  // call it applied. Production should use pollForKernel rather than these methods.
  async takePending(orgId: OrgId, runId: string): Promise<PendingInterjection | null> {
    return this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<Row>(`SELECT interjection_id,text,received_at,classification FROM agent_run_interjections
        WHERE org_id=$1 AND run_id=$2 AND status='queued' ORDER BY sequence LIMIT 1 FOR UPDATE`, [orgId, runId]);
      const row = rows[0];
      if (!row) return null;
      await s.query(`UPDATE agent_run_interjections SET status='staged',classification=$4
        WHERE org_id=$1 AND run_id=$2 AND interjection_id=$3`, [orgId, runId, row.interjection_id, classifyInterjection(row.text)]);
      return project(row);
    });
  }
  async stageForKernel(orgId: OrgId, runId: string, value: StagedKernelInterjection): Promise<void> {
    await this.db.withTenant(orgId, async (s) => { await s.query(`UPDATE agent_run_interjections SET status='staged',classification=$4
      WHERE org_id=$1 AND run_id=$2 AND interjection_id=$3 AND status<>'applied'`, [orgId, runId, value.interjectionId, value.classification]); });
  }
  async takeStagedForKernel(orgId: OrgId, runId: string): Promise<StagedKernelInterjection | null> {
    return this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<Row>(`SELECT interjection_id,text,received_at,classification FROM agent_run_interjections
        WHERE org_id=$1 AND run_id=$2 AND status='staged' ORDER BY sequence LIMIT 1`, [orgId, runId]);
      return rows[0] ? project(rows[0]) : null;
    });
  }
}
