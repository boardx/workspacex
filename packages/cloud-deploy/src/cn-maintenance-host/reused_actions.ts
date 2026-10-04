import { validatePreparedCnRelease, verifyPreparedReleaseManifest, activatePreparedCnRelease, type ActivationActions } from '../cn-fast-safe-release';
import { generateMigrationPlan, type MigrationPlanInput } from '../cn-migration-plan';
import { verifyMigrationCompletion, type MigrationCompletionExpected } from '../cn-migration-completion';
import { migrationSourceSchema } from '../cn-migration-source-identity';
import type { MaintenanceIdentity } from '../cn-maintenance-release';

/** Actual low-level API reuse. This is not a production factory: protected input
 * readers and live database/traffic transports still require exact root bindings. */
export function offlinePreparedAction(receipt: unknown, manifestBytes: Buffer, verifyOfflineArtifacts: () => Promise<void>) {
  return async (identity: MaintenanceIdentity) => {
    const prepared = validatePreparedCnRelease(receipt);
    const manifest = verifyPreparedReleaseManifest(receipt, manifestBytes);
    if (prepared.sourceRevision !== identity.sourceRevision || manifest.sourceRevision !== identity.sourceRevision) throw new Error('OFFLINE_APPLICATION_IDENTITY_MISMATCH');
    await verifyOfflineArtifacts(); // Actual local image/config/package readback; no pull/install/build.
  };
}
export interface ExactMigrationInputs {
  checkout: string;
  plan: MigrationPlanInput;
  expectedCompletion: MigrationCompletionExpected;
}
export interface ExactMigrationTransport {
  /** Calls existing migrator.migrate(cfg,{dir,lockTimeoutMs}), never force or provision. */
  migrate(): Promise<{ readonly applied: readonly string[]; readonly skipped: readonly string[] }>;
  readFreshCompletion(): Promise<{ snapshot: unknown; binding: unknown }>;
  verifyLiveWriterBarrier(): Promise<void>;
}
export function exactMigrationAction(input: ExactMigrationInputs, transport: ExactMigrationTransport) {
  return async (identity: MaintenanceIdentity) => {
    if (input.plan.targetSha !== identity.sourceRevision || input.plan.baselineSha !== identity.baselineRevision || input.expectedCompletion.originalPlanSha256 !== identity.migrationPlanSha256 || input.expectedCompletion.attemptId !== identity.attemptId || input.expectedCompletion.sourceRevision !== identity.sourceRevision || input.expectedCompletion.baselineRevision !== identity.baselineRevision) throw new Error('EXACT_MIGRATION_BINDING_MISMATCH');
    if (!migrationSourceSchema.safeParse(input.expectedCompletion.productionSource).success) throw new Error('EXACT_MIGRATION_PRODUCTION_SOURCE_INVALID');
    const recomputed = await generateMigrationPlan(input.checkout, input.plan);
    // Maintenance may explicitly review contract/destructive pending SQL, but
    // drift/unknown source/ordering must never be waived by a generic ready flag.
    const permitted = new Set(['pending_contract', 'pending_destructive']);
    if (recomputed.planSha256 !== identity.migrationPlanSha256 || recomputed.drift.length || recomputed.blockers.some(code => !permitted.has(code))) throw new Error('EXACT_MIGRATION_PLAN_CHANGED_OR_UNSAFE');
    if (!input.expectedCompletion.originalPlan || JSON.stringify(input.expectedCompletion.originalPlan) !== JSON.stringify(recomputed)) throw new Error('EXACT_MIGRATION_ORIGINAL_PLAN_CHANGED');
    await transport.verifyLiveWriterBarrier();
    const result = await transport.migrate();
    if (JSON.stringify(result.applied) !== JSON.stringify(recomputed.pending.map(x => x.name)) || JSON.stringify(result.skipped) !== JSON.stringify(recomputed.ledger.map(x => x.name))) throw new Error('EXACT_MIGRATION_APPLIED_SET_MISMATCH');
    await transport.verifyLiveWriterBarrier();
    const after = await transport.readFreshCompletion();
    await verifyMigrationCompletion(after.snapshot, after.binding, input.checkout, input.expectedCompletion);
  };
}
export function preparedActivationAction(receipt: unknown, actions: ActivationActions) {
  return async (identity: MaintenanceIdentity) => {
    const prepared = validatePreparedCnRelease(receipt);
    if (prepared.sourceRevision !== identity.sourceRevision) throw new Error('ACTIVATION_IDENTITY_MISMATCH');
    const report = await activatePreparedCnRelease(receipt, actions);
    if (report.status !== 'passed') throw new Error('MAINTENANCE_ACTIVATION_NOT_ACCEPTED');
  };
}
