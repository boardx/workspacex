import { closeSync, writeFileSync, fsyncSync } from "node:fs";
import { openPrivateReport } from "./cn-migration-rehearsal-safety";
import { generateMigrationPlan } from "./cn-migration-plan";
import { validateMigrationSnapshot, readMigrationSnapshotFile } from "./cn-migration-snapshot";
import type { MigrationPlanInput } from "./cn-migration-plan";

const [checkout, targetSha, baselineSha, ledgerPath, sourceBindingPath, privatePlanPath, evidencePath] = process.argv.slice(2);
if (!checkout || !targetSha || !baselineSha || !ledgerPath || !sourceBindingPath || !privatePlanPath) throw new Error("usage: cn-migration-plan-cli <frozen-checkout> <target-sha> <baseline-sha> <private-snapshot.json> <expected-source-binding.json> <private-plan.json> [legacy-evidence.json]");
let snapshot: ReturnType<typeof validateMigrationSnapshot>;
try {
  snapshot = validateMigrationSnapshot(readMigrationSnapshotFile(ledgerPath), readMigrationSnapshotFile(sourceBindingPath));
} catch (error) {
  process.stderr.write(`${error instanceof Error && /^MIGRATION_SNAPSHOT_[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_SNAPSHOT_INPUT_INVALID"}\n`);
  process.exit(2);
}
let plan: Awaited<ReturnType<typeof generateMigrationPlan>>;
try {
plan = await generateMigrationPlan(checkout, { targetSha, baselineSha, ledger: snapshot.ledger, snapshotEvidence: { snapshotSha256: snapshot.snapshotSha256,
  sourceBindingSha256: snapshot.sourceBindingSha256, fullResponseSha256: snapshot.fullResponseSha256,
  ledgerSha256: snapshot.ledgerSha256, independentSqlCount: snapshot.independentSqlCount, capturedAt: snapshot.capturedAt },
  legacyDriftEvidence: evidencePath ? readMigrationSnapshotFile(evidencePath) as MigrationPlanInput["legacyDriftEvidence"] : undefined });
} catch {
  process.stderr.write("MIGRATION_PLAN_SOURCE_OR_EVIDENCE_INVALID\n");
  process.exit(2);
}
let fd: number | undefined;
try {
  fd = openPrivateReport(privatePlanPath);
  writeFileSync(fd, `${JSON.stringify(plan, null, 2)}\n`);
  fsyncSync(fd);
} catch {
  process.stderr.write("MIGRATION_PLAN_PRIVATE_OUTPUT_INVALID\n");
  process.exitCode = 2;
} finally { if (fd !== undefined) closeSync(fd); }
if (process.exitCode === 2) process.exit(2);
process.stdout.write(`${JSON.stringify({ scope: plan.scope, ready: plan.ready,
  planSha256: plan.planSha256, productionMigrationAuthorized: false })}\n`);
if (!plan.ready) process.exitCode = 1;
