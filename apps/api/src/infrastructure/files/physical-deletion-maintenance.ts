import type { DatabasePort } from "../../application/ports/database.port";
import type { PhysicalPurgePort } from "../../application/files/physical-delete-ports";
import { runPhysicalDeletion } from "../../application/files/run-physical-deletion";
import { toOrgId } from "../../domain/org-id";
import { PgPhysicalDeleteTaskRepository, PgDeletionReceiptRepository } from "./pg-physical-delete-repository";
import { PgDeleteImpactRepository, PgLegalHoldGate } from "./pg-deletion-repository";
import { PgProvenanceRepository } from "../provenance/pg-provenance-repository";
import { UuidIdFactory } from "../artifact/uuid-id-factory";
import { deletionLockKey } from "./deletion-lock";

/** Explicit tenant maintenance; never enumerates tenants or accepts arbitrary object keys. */
export async function maintainPhysicalDeletion(db: DatabasePort, purge: PhysicalPurgePort, tenant: string) {
  const orgId = toOrgId(tenant);
  return db.withTenant(orgId, async (session) => {
    // Transaction-scoped serialization prevents two maintenance processes racing receipts.
    // PgDatabase reuses this tenant transaction in every repository below.
    const lock = await session.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired", [deletionLockKey(orgId)],
    );
    if (!lock.rows[0]?.acquired) return { status: "busy" as const, outcomes: [] };
    const outcomes = await runPhysicalDeletion({
      tasks: new PgPhysicalDeleteTaskRepository(db), legalHold: new PgLegalHoldGate(db), purge,
      receipts: new PgDeletionReceiptRepository(db), impact: new PgDeleteImpactRepository(db),
      ids: new UuidIdFactory(), provenance: new PgProvenanceRepository(db),
      now: () => new Date(), executor: "system",
    }, orgId);
    return { status: "completed" as const, outcomes };
  });
}
