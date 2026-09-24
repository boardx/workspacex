import type { DatabasePort } from "../../application/ports/database.port";
import type { GuidedInternalSourceAccessPort, RuntimeActor } from "../../application/research/guided-runtime-ports";
import type { DecisionIdFactory, IdentityRepository } from "../../application/identity/ports";
import { disclose, guard } from "../../application/security/permission-filter";

/** Resolves requested artifacts only after the authoritative ACL propagation path discloses them. */
export class PgGuidedInternalSourceAccess implements GuidedInternalSourceAccessPort {
  constructor(private readonly db: DatabasePort, private readonly identities: IdentityRepository, private readonly decisions: DecisionIdFactory) {}

  async authorizedSourceIds(actor: RuntimeActor, requestedSourceIds: readonly string[]): Promise<readonly string[]> {
    if (!requestedSourceIds.length) return [];
    return this.db.withTenant(actor.orgId, async (session) => {
      const result = await session.query<{ id: string; project_id: string | null }>(
        `SELECT a.id, a.project_id FROM artifacts a WHERE a.org_id = $1 AND a.id = ANY($2::text[])`,
        [actor.orgId, requestedSourceIds],
      );
      const rowsByProject = new Map<string | null, Array<{ id: string; project_id: string | null }>>();
      for (const row of result.rows) rowsByProject.set(row.project_id, [...(rowsByProject.get(row.project_id) ?? []), row]);
      const allowed = new Set<string>();
      for (const [projectId, rows] of rowsByProject) {
        const disclosure = await disclose({ repo: this.identities, ids: this.decisions }, {
          userId: actor.userId,
          orgId: actor.orgId,
          ...(projectId ? { projectId } : {}),
          action: "read.published",
          path: "retrieval",
          items: rows.map((row) => guard({ kind: "artifact", id: row.id }, row.id)),
        });
        for (const item of disclosure.visible) allowed.add(item.payload);
      }
      return requestedSourceIds.filter((id, index) => allowed.has(id) && requestedSourceIds.indexOf(id) === index);
    });
  }
}
