import type { InsightContextApi } from "../../application/interview/insight-ports";
import type { IdentityRepository } from "../../application/identity/ports";
import type { DatabasePort } from "../../application/ports/database.port";
import { IdentityModelConstraint } from "../context-pack/identity-model-constraint";
import { PgContextPackStore } from "../context-pack/pg-context-pack-store";

/**
 * 生产适配器：复用 Context Pack 既有的授权 API，不复用它的存储模式——与
 * `ContextApiDigitalExpertMaterialReader`（F03）同一形状，同一理由（见该文件文件头）。
 */
export class ContextApiInsightMaterialReader implements InsightContextApi {
  constructor(private readonly db: DatabasePort, private readonly identities: IdentityRepository) {}

  async read(input: Parameters<InsightContextApi["read"]>[0]) {
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
      items: pack.items.map(({ segmentId, content }) => ({ segmentId, content })),
    };
  }
}
