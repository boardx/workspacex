import type { DatabasePort } from "../../application/ports/database.port";
import type { ObjectStore } from "../../application/artifact/ports";
import type { OrgId } from "../../domain/org-id";
import type { ArtifactContinuationReader, PreparedArtifactContinuation } from "../../application/artifacts-steering/artifact-execution";
import { MAX_INPUT_FILE_BYTES } from "@repo/skill-sandbox/input-files";

export class PgArtifactContinuationReader implements ArtifactContinuationReader {
  constructor(private readonly db: DatabasePort, private readonly objects: ObjectStore) {}
  async prepare(orgId: OrgId, runId: string): Promise<PreparedArtifactContinuation | null> {
    const row = await this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ name: string; version: number; storage_key: string; size_bytes: string }>(`
        SELECT a.name,v.version,v.storage_key,v.size_bytes FROM agent_run_artifact_context c
        JOIN agent_artifacts a ON a.org_id=c.org_id AND a.id=c.artifact_id
        JOIN agent_artifact_versions v ON v.org_id=c.org_id AND v.artifact_id=c.artifact_id AND v.version=c.based_on_version
        WHERE c.org_id=$1 AND c.run_id=$2`, [orgId,runId]);
      return result.rows[0];
    });
    if (!row) return null;
    if (Number(row.size_bytes) > MAX_INPUT_FILE_BYTES) throw new Error("artifact source exceeds sandbox input limit");
    const bytes = await this.objects.get(row.storage_key);
    if (!bytes || bytes.length !== Number(row.size_bytes)) throw new Error("artifact source bytes unavailable");
    const extension = /\.([a-zA-Z0-9]{1,10})$/.exec(row.name)?.[1] ?? "bin";
    const name = `source.${extension}`;
    return { inputFiles: [{ name, contentBase64: Buffer.from(bytes).toString("base64") }],
      instruction: `Continue editing the explicitly selected artifact version ${row.version}. The original file is mounted read-only at process.env.SKILL_SANDBOX_INPUT_DIR + '/${name}'. Read that file as the baseline; do not recreate it from memory or use a newer version. Write the revised file into process.env.SKILL_SANDBOX_OUT_DIR. Original output filename: ${JSON.stringify(row.name)}. Produce one revised primary file.` };
  }
}
