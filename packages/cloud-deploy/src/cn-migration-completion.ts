/** Fact-only post-migration ledger witness. No SQL execution, mutation permit,
 * restore-fidelity assertion or substitution for ordinary release admission. */
import { generateMigrationPlan, type compareMigrationInventory } from "./cn-migration-plan";
import { validateMigrationSnapshot, migrationSnapshotBindingSchema } from "./cn-migration-snapshot";
import { migrationSourceSchema } from "./cn-migration-source-identity";
import { releaseManifestSchema } from "./release";

type MigrationPlan = ReturnType<typeof compareMigrationInventory>;
export interface MigrationCompletionExpected {
  sourceRevision: string;
  baselineRevision: string;
  attemptId: string;
  release: string;
  originalPlanSha256: string;
  originalPlan: MigrationPlan;
  /** Protected intended production connection identity, using the existing
   * external-source contract. A target chosen by the snapshot cannot override it. */
  productionSource: unknown;
}
function reject(code: string): never { throw new Error(`MIGRATION_COMPLETION_${code}`); }
/** The expected object must originate in the protected release input, not the
 * provider response. The complete provider envelope is validated by the existing
 * snapshot verifier before its FinishedTime field is inspected for freshness. */
export async function verifyMigrationCompletion(
  snapshotInput: unknown, bindingInput: unknown, checkout: string,
  expected: MigrationCompletionExpected, now = new Date(), ttlMs = 3_600_000,
) {
  if (!releaseManifestSchema.shape.sourceRevision.safeParse(expected.sourceRevision).success ||
      !releaseManifestSchema.shape.sourceRevision.safeParse(expected.baselineRevision).success ||
      !releaseManifestSchema.shape.release.safeParse(expected.release).success ||
      typeof expected.attemptId !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(expected.attemptId) ||
      typeof expected.originalPlanSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expected.originalPlanSha256)) reject("RELEASE_BINDING_INVALID");
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 3_600_000) reject("FRESHNESS_WINDOW_INVALID");
  const binding = migrationSnapshotBindingSchema.parse(bindingInput);
  const productionSource = migrationSourceSchema.parse(expected.productionSource);
  if (JSON.stringify(binding.source) !== JSON.stringify(productionSource)) reject("PRODUCTION_TARGET_MISMATCH");
  const snapshot = validateMigrationSnapshot(snapshotInput, binding);
  // This is only one metadata field from a fully validated provider response;
  // ledger decoding/counting/checksums stay exclusively in validateMigrationSnapshot.
  const response = JSON.parse(Buffer.from((snapshotInput as { fullResponseBase64: string }).fullResponseBase64, "base64").toString("utf8"));
  const finishedAt: string = response.Invocation.InvocationResults.InvocationResult[0].FinishedTime;
  for (const timestamp of [snapshot.capturedAt, finishedAt]) {
    const observed = Date.parse(timestamp);
    if (!Number.isFinite(observed) || observed > now.getTime() || now.getTime() - observed >= ttlMs) reject("SNAPSHOT_NOT_FRESH");
  }
  const original = expected.originalPlan;
  if (!original || original.targetSha !== expected.sourceRevision || original.baselineSha !== expected.baselineRevision ||
      original.planSha256 !== expected.originalPlanSha256 || original.drift.length !== 0) reject("ORIGINAL_PLAN_BINDING_INVALID");
  const recomputed = await generateMigrationPlan(checkout, {
    targetSha: expected.sourceRevision, baselineSha: expected.baselineRevision,
    ledger: original.ledger, ...(original.snapshotEvidence ? { snapshotEvidence: original.snapshotEvidence } : {}),
  });
  if (recomputed.planSha256 !== expected.originalPlanSha256) reject("ORIGINAL_PLAN_CHANGED");
  const after = await generateMigrationPlan(checkout, {
    targetSha: expected.sourceRevision, baselineSha: expected.baselineRevision, ledger: snapshot.ledger,
    snapshotEvidence: {
      snapshotSha256: snapshot.snapshotSha256, sourceBindingSha256: snapshot.sourceBindingSha256,
      fullResponseSha256: snapshot.fullResponseSha256, ledgerSha256: snapshot.ledgerSha256,
      independentSqlCount: snapshot.independentSqlCount, capturedAt: snapshot.capturedAt,
    },
  });
  if (after.sourceInventorySha256 !== recomputed.sourceInventorySha256 || after.pending.length !== 0 ||
      after.drift.length !== 0 || after.blockers.length !== 0 || !after.ready) reject("LEDGER_INCOMPLETE_OR_DRIFTED");
  return {
    schemaVersion: 1 as const, scope: "validated-production-migration-completion" as const,
    sourceRevision: expected.sourceRevision, baselineRevision: expected.baselineRevision,
    attemptId: expected.attemptId, release: expected.release, originalPlanSha256: expected.originalPlanSha256,
    completionPlanSha256: after.planSha256, sourceInventorySha256: after.sourceInventorySha256,
    sourceBindingSha256: snapshot.sourceBindingSha256, snapshotSha256: snapshot.snapshotSha256,
    fullResponseSha256: snapshot.fullResponseSha256, ledgerSha256: snapshot.ledgerSha256,
    appliedSqlCount: snapshot.independentSqlCount, pendingCount: 0 as const, driftCount: 0 as const, unknownAppliedCount: 0 as const,
    capturedAt: snapshot.capturedAt, providerFinishedAt: finishedAt,
    expiresAt: new Date(Math.min(Date.parse(snapshot.capturedAt), Date.parse(finishedAt)) + ttlMs).toISOString(),
    productionMutationAuthorized: false as const,
  };
}
