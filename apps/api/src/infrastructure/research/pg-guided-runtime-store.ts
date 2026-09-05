import { research as C } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { guard } from "../../application/security/permission-filter";
import { ResearchRuntimeError, type GuidedRuntimeStore, type RuntimeActor, type RuntimeCommand, type ResearchRuntime } from "../../application/research/guided-runtime-ports";

// Recheck authorization under the session lock before any effect or persisted write.
async function authorize(tx: TenantSession, actor: RuntimeActor) {
  const result = await tx.query<{ id: string }>(`SELECT g.id FROM guided_research_sessions g
    WHERE g.org_id=$1 AND g.id=$2 AND (g.owner_user_id=$3 OR EXISTS (
      SELECT 1 FROM guided_research_session_collaborators c
      WHERE c.org_id=g.org_id AND c.session_id=g.id AND c.user_id=$3)) FOR UPDATE OF g`,
  [actor.orgId, actor.sessionId, actor.userId]);
  if (!result.rows[0]) throw new ResearchRuntimeError("RESEARCH_NOT_FOUND");
  void guard({ kind: "research", id: actor.sessionId }, { kind: "guided-runtime" });
}
interface Row { state: unknown; active_request_id: string | null; requests: Record<string, { hash: string; done: boolean }> }
export class PgGuidedRuntimeStore implements GuidedRuntimeStore {
  constructor(private readonly db: DatabasePort) {}
  async read(actor: RuntimeActor, initial: ResearchRuntime): Promise<ResearchRuntime> {
    return this.db.withTenant(actor.orgId, async (tx) => {
      await authorize(tx, actor);
      await tx.query(`INSERT INTO guided_research_runtime(org_id,session_id,state) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`, [actor.orgId, actor.sessionId, JSON.stringify(initial)]);
      const rows = await tx.query<Row>(`SELECT state FROM guided_research_runtime WHERE org_id=$1 AND session_id=$2`, [actor.orgId, actor.sessionId]);
      return C.GuidedResearchRuntime.parse(rows.rows[0]?.state);
    });
  }
  async claim(actor: RuntimeActor, command: RuntimeCommand, hash: string) {
    return this.db.withTenant(actor.orgId, async (tx) => {
      await authorize(tx, actor);
      const result = await tx.query<Row>(`SELECT state,active_request_id,requests FROM guided_research_runtime WHERE org_id=$1 AND session_id=$2 FOR UPDATE`, [actor.orgId, actor.sessionId]);
      const row = result.rows[0];
      if (!row) throw new ResearchRuntimeError("RESEARCH_NOT_FOUND");
      const state = C.GuidedResearchRuntime.parse(row.state);
      const prior = Object.hasOwn(row.requests, command.requestId) ? row.requests[command.requestId] : undefined;
      if (prior) {
        if (prior.hash !== hash) throw new ResearchRuntimeError("RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH");
        if (prior.done || (state.busy && Date.parse(state.leaseUntil ?? "") > Date.now())) return { state, replay: true };
      }
      if (state.busy && Date.parse(state.leaseUntil ?? "") > Date.now()) throw new ResearchRuntimeError("RESEARCH_WORKFLOW_BUSY");
      if (state.version !== command.expectedVersion) throw new ResearchRuntimeError("RESEARCH_GRAPH_VERSION_CONFLICT");
      if (!state.availableNodes.includes(command.node)) throw new ResearchRuntimeError("RESEARCH_NODE_LOCKED");
      if (state.busy) {
        state.tasks = state.tasks.map((task) => task.status === "running" ? { ...task, status: "failed", errorCode: "RESEARCH_EXECUTION_INTERRUPTED" } : task);
      }
      state.version += 1;
      state.busy = true;
      state.leaseUntil = new Date(Date.now() + 600000).toISOString();
      state.errorCode = null;
      await tx.query(`UPDATE guided_research_runtime SET state=$3::jsonb,active_request_id=$4,
        requests=requests || jsonb_build_object($4::text,$5::jsonb) WHERE org_id=$1 AND session_id=$2`,
      [actor.orgId,actor.sessionId,JSON.stringify(state),command.requestId,JSON.stringify({hash,done:false})]);
      return { state, replay: false };
    });
  }
  async write(actor: RuntimeActor, requestId: string, state: ResearchRuntime, done: boolean) {
    await this.db.withTenant(actor.orgId, async (tx) => {
      await authorize(tx, actor);
      const parsed = C.GuidedResearchRuntime.parse(state);
      const result = await tx.query<{ session_id: string }>(`UPDATE guided_research_runtime
        SET state=$3::jsonb, requests=CASE WHEN $6 THEN jsonb_set(requests,ARRAY[$4::text,'done'],'true'::jsonb) ELSE requests END
        WHERE org_id=$1 AND session_id=$2 AND active_request_id=$4 AND (state->>'version')::int=$5 RETURNING session_id`,
      [actor.orgId, actor.sessionId, JSON.stringify(parsed), requestId, state.version, done]);
      if (!result.rows[0]) throw new ResearchRuntimeError("RESEARCH_GRAPH_VERSION_CONFLICT");
      const stage = state.currentNode === "research" ? "researching" : state.currentNode;
      await tx.query(`UPDATE guided_research_sessions SET stage=$3,resume_stage=$3,progress=$4,source_count=$5,brief=$6::jsonb,status=$7,report_id=$8,updated_at=now()
        WHERE org_id=$1 AND id=$2`, [actor.orgId,actor.sessionId,stage,state.completed ? 100 : ["brief","directions","outline","research","report"].indexOf(state.currentNode)*20,state.sources.filter((source)=>source.decision==="accepted").length,JSON.stringify(state.brief),state.completed ? "completed" : "active",state.report ? `guided-${actor.sessionId}-${state.revision}` : null]);
    });
  }
}
