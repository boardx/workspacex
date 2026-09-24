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
      const result = await session.query<{ id: string }>(
        `SELECT a.id FROM artifacts a WHERE a.org_id = $1 AND a.id = ANY($2::text[])`,
        [actor.orgId, requestedSourceIds],
      );
      const disclosure = await disclose({ repo: this.identities, ids: this.decisions }, {
        userId: actor.userId,
        orgId: actor.orgId,
        action: "read",
        path: "retrieval",
        items: result.rows.map((row) => guard({ kind: "artifact", id: row.id }, row.id)),
      });
      return disclosure.visible.map((item) => item.payload);
    });
  }
}
