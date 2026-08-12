import type { DigitalExpertContextApi } from "../../application/interview/digital-interview-ports";
import type { IdentityRepository } from "../../application/identity/ports";
import type { DatabasePort } from "../../application/ports/database.port";
import { IdentityModelConstraint } from "../context-pack/identity-model-constraint";
import { PgContextPackStore } from "../context-pack/pg-context-pack-store";

/** Production adapter: reuse Context Pack's permission-aware API, never its storage schema. */
export class ContextApiDigitalExpertMaterialReader implements DigitalExpertContextApi {
  constructor(private readonly db: DatabasePort, private readonly identities: IdentityRepository) {}

  async read(input: Parameters<DigitalExpertContextApi["read"]>[0]) {
    const store = new PgContextPackStore(
      this.db,
      input.orgId,
      new IdentityModelConstraint(this.identities),
      input.actorId,
    );
    const pack = await store.pack(input.runId);
    if (!pack) return null;
    return {
      packId: pack.packId,
      runId: pack.runId,
      items: pack.items.map(({ segmentId, content, artifactVersionId, permissionDecisionId }) => ({
        segmentId, content, artifactVersionId, permissionDecisionId,
      })),
    };
  }
}
