import type { DatabasePort } from "../../application/ports/database.port";
import type { GuidedInternalSourceAccessPort, RuntimeActor } from "../../application/research/guided-runtime-ports";
import { guard } from "../../application/security/permission-filter";

/** Authorizes only artifacts the actor created or can reach through project membership. */
export class PgGuidedInternalSourceAccess implements GuidedInternalSourceAccessPort {
  constructor(private readonly db: DatabasePort) {}

  async authorizedSourceIds(actor: RuntimeActor, requestedSourceIds: readonly string[]): Promise<readonly string[]> {
    if (!requestedSourceIds.length) return [];
    return this.db.withTenant(actor.orgId, async (session) => {
      const result = await session.query<{ id: string }>(
        `SELECT a.id FROM artifacts a
          WHERE a.org_id = $1 AND a.id = ANY($2::text[])
            AND (a.created_by = $3 OR (a.project_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM project_memberships pm
               WHERE pm.org_id = a.org_id AND pm.project_id = a.project_id AND pm.user_id = $3
            )))`,
        [actor.orgId, requestedSourceIds, actor.userId],
      );
      // The caller already supplied these opaque IDs; only the guarded ref is returned.
      // Artifact content remains inaccessible until the normal disclosure path authorizes it.
      return result.rows.map((row) => guard({ kind: "artifact", id: row.id }, { authorized: true }).ref.id);
    });
  }
}
