import { createHash } from "node:crypto";
import type { ArtifactRunLauncher } from "../../application/artifacts-steering/ports";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { acceptHumanMessage, MessageIdempotencyConflictError } from "../../application/chat/message-roundtrip";
import type { AcceptMessagePlanRunCreatorDeps } from "../plan-control/accept-message-plan-run-creator";

export class AcceptMessageArtifactRunLauncher implements ArtifactRunLauncher {
  constructor(private readonly deps: AcceptMessagePlanRunCreatorDeps & { readonly db: DatabasePort }) {}
  async launch(orgId: OrgId, input: Parameters<ArtifactRunLauncher["launch"]>[1]): Promise<{ runId: string }> {
    const agentId = await this.deps.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ agent_id: string }>(`SELECT agent_id FROM agent_runs WHERE org_id=$1 AND id=$2 AND thread_id=$3`,
        [orgId,input.basedOnVersion.producedByRunId,input.threadId]);
      return result.rows[0]?.agent_id;
    });
    if (!agentId) throw new Error("artifact source run is unavailable");
    // Namespaced deterministic UUID; a browser request UUID is reused on retries.
    // Older clients without one get deterministic deduplication for the same edit.
    const digest = createHash("sha256").update(JSON.stringify(["artifact-continuation",orgId,input.userId,
      input.clientRequestId ?? [input.artifactId,input.basedOnVersion.version,input.instruction]])).digest("hex");
    const clientMessageId = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
    const accepted = await acceptHumanMessage(this.deps, { orgId,userId: input.userId,threadId: input.threadId,
      clientMessageId,text: input.instruction,agentId,
      artifactContinuation: { artifactId: input.artifactId,basedOnVersion: input.basedOnVersion.version } });
    // This also protects a replay with the same request id but a different base.
    const matches = await this.deps.db.withTenant(orgId, async (s) => {
      const result = await s.query(`SELECT run_id FROM agent_run_artifact_context WHERE org_id=$1 AND run_id=$2 AND artifact_id=$3 AND based_on_version=$4`,
        [orgId,accepted.agentRunId,input.artifactId,input.basedOnVersion.version]);
      return result.rows.length === 1;
    });
    if (!matches) throw new MessageIdempotencyConflictError();
    this.deps.executor.kick(orgId);
    return { runId: accepted.agentRunId };
  }
}
