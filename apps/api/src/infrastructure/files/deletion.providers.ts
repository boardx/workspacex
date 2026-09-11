import type { Provider } from "@nestjs/common";
import { files as C } from "@repo/contracts";
import { DATABASE_PORT, type DatabasePort } from "../../application/ports/database.port";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY, type IdentityRepository, type DecisionIdFactory } from "../../application/identity/ports";
import { DELETION_HTTP_DEPS, type DeletionHttpDeps } from "../../application/files/deletion-http-deps";
import { PgDeleteImpactRepository, PgLegalHoldGate, PgCascadeInvalidationRepository, PgDeletionTaskRepository } from "./pg-deletion-repository";
import { PgDeletionReceiptRepository } from "./pg-physical-delete-repository";
import { PgRetentionPolicyRepository } from "./pg-retention-policy-repository";
import { resolveRetentionParams } from "../../domain/files/retention-policy";
import { PgProvenanceRepository } from "../provenance/pg-provenance-repository";
import { UuidIdFactory } from "../artifact/uuid-id-factory";
import { guard } from "../../application/security/permission-filter";

export function createDeletionHttpDeps(db: DatabasePort, repo: IdentityRepository, ids: DecisionIdFactory): DeletionHttpDeps {
  const retention = new PgRetentionPolicyRepository(db);
  return { repo, ids, transaction: (orgId, work) => db.withTenant(orgId, work),
    impact: new PgDeleteImpactRepository(db), legalHold: new PgLegalHoldGate(db),
    cascades: new PgCascadeInvalidationRepository(db), tasks: new PgDeletionTaskRepository(db),
    receipts: new PgDeletionReceiptRepository(db), provenance: new PgProvenanceRepository(db),
    idFactory: new UuidIdFactory(), now: () => new Date(),
    trashGraceDays: async (orgId, projectId) => resolveRetentionParams(C.DEFAULT_RETENTION_PARAMS,
      projectId === null ? null : await retention.getOverride(orgId, projectId)).trashGraceDays,
    taskProject: (orgId, taskId) => db.withTenant(orgId, async session => {
      const result = await session.query<{ project_id: string | null; artifact_id: string }>(
        `SELECT a.project_id, t.artifact_id FROM deletion_tasks t JOIN artifacts a ON a.org_id=t.org_id AND a.id=t.artifact_id
         WHERE t.org_id=$1 AND t.id=$2`, [orgId, taskId]);
      return result.rows[0] ? { projectId: result.rows[0].project_id, artifactId: result.rows[0].artifact_id,
        task: guard({ kind: "artifact", id: result.rows[0].artifact_id }, { taskId }) } : null;
    }),
  };
}
export const deletionProviders: Provider[] = [{ provide: DELETION_HTTP_DEPS,
  useFactory: createDeletionHttpDeps, inject: [DATABASE_PORT, IDENTITY_REPOSITORY, DECISION_ID_FACTORY] }];
