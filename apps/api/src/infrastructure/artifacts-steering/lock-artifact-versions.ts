import type { TenantSession } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";

/** One lock namespace for every writer allocating the next artifact version. */
export async function lockArtifactVersions(session: TenantSession, orgId: OrgId, artifactId: string): Promise<void> {
  await session.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`agent_artifact:${orgId}:${artifactId}`]);
}
