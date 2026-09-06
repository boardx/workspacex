import { lockArtifactVersions } from "./lock-artifact-versions";
import type { TenantSession } from "../../application/ports/database.port";
import type { RunOutputFile } from "../../application/agent-run/ports";
import type { OrgId } from "../../domain/org-id";

/** Called INSIDE the existing assistant-message/attachment writeback transaction.
 * This registers version metadata only; attachment storage_ref remains byte authority. */
export async function registerRunArtifacts(s: TenantSession, input: {
  readonly orgId: OrgId; readonly runId: string; readonly threadId: string;
  readonly messageId: string; readonly files: readonly RunOutputFile[];
}): Promise<void> {
  const { orgId, runId, threadId, messageId, files } = input;
  const context = (await s.query<{ artifact_id: string; based_on_version: number; name: string }>(`
    SELECT c.artifact_id,c.based_on_version,a.name FROM agent_run_artifact_context c
    JOIN agent_artifacts a ON a.org_id=c.org_id AND a.id=c.artifact_id AND a.thread_id=$3
    WHERE c.org_id=$1 AND c.run_id=$2`, [orgId,runId,threadId])).rows[0];
  const primary = context ? (files.length === 1 ? files[0] : files.find(file => file.name === context.name)) : undefined;
  if (context && !primary) throw new Error("artifact continuation did not produce an unambiguous revised file");
  if (!files.length) return;
  const stepId = (await s.query<{ id: string }>(`SELECT id FROM agent_run_steps WHERE org_id=$1 AND run_id=$2 ORDER BY seq DESC LIMIT 1`, [orgId,runId])).rows[0]?.id;
  if (!stepId) throw new Error("artifact output has no producing run step");
  for (const file of files) {
    const attachment = (await s.query<{ id: string }>(`SELECT id FROM chat_message_attachments
      WHERE org_id=$1 AND thread_id=$2 AND message_id=$3 AND storage_ref=$4 ORDER BY created_at,id LIMIT 1`,
    [orgId,threadId,messageId,file.objectKey])).rows[0];
    if (!attachment) throw new Error("artifact output attachment missing from writeback transaction");
    const artifactId = context && file === primary ? context.artifact_id : `agent-artifact-${attachment.id}`;
    await lockArtifactVersions(s,orgId,artifactId);
    const exists = (await s.query(`SELECT id FROM agent_artifact_versions WHERE org_id=$1 AND attachment_id=$2`, [orgId,attachment.id])).rows.length > 0;
    if (exists) continue;
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    const kind = extension && ["pdf","docx","png"].includes(extension) ? extension : "other";
    await s.query(`INSERT INTO agent_artifacts(id,org_id,thread_id,name,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [artifactId,orgId,threadId,file.name,kind]);
    const version = Number((await s.query<{ version: number }>(`SELECT COALESCE(MAX(version),0)+1 AS version
      FROM agent_artifact_versions WHERE org_id=$1 AND artifact_id=$2`, [orgId,artifactId])).rows[0]!.version);
    await s.query(`INSERT INTO agent_artifact_versions(id,org_id,artifact_id,version,produced_by_run_id,produced_by_step_id,
      change_note,storage_key,size_bytes,attachment_id,based_on_version)
      SELECT $1,$2,$3,$4,$5,$6,m.body,$7,$8,$9,$10 FROM agent_runs r
      JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id WHERE r.org_id=$2 AND r.id=$5`,
    [`${artifactId}-v${version}`,orgId,artifactId,version,runId,stepId,file.objectKey,file.sizeBytes,attachment.id,
      context && file === primary ? context.based_on_version : null]);
  }
}
