import { readFileSync } from "node:fs";
import { generateMigrationPlan } from "./cn-migration-plan";
import { validateMigrationSnapshot, readMigrationSnapshotFile } from "./cn-migration-snapshot";
import type { MigrationPlanInput } from "./cn-migration-plan";

const [checkout, targetSha, baselineSha, ledgerPath, sourceBindingPath, evidencePath] = process.argv.slice(2);
if (!checkout || !targetSha || !baselineSha || !ledgerPath || !sourceBindingPath) throw new Error("usage: cn-migration-plan-cli <frozen-checkout> <target-sha> <baseline-sha> <private-snapshot.json> <expected-source-binding.json> [legacy-evidence.json]");
let snapshot: ReturnType<typeof validateMigrationSnapshot>;
try {
  snapshot = validateMigrationSnapshot(readMigrationSnapshotFile(ledgerPath), readMigrationSnapshotFile(sourceBindingPath));
} catch (error) {
  process.stderr.write(`${error instanceof Error && /^MIGRATION_SNAPSHOT_[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_SNAPSHOT_INPUT_INVALID"}\n`);
  process.exit(2);
}
const plan = await generateMigrationPlan(checkout, { targetSha, baselineSha, ledger: snapshot.ledger, snapshotEvidence: { snapshotSha256: snapshot.snapshotSha256,
  sourceBindingSha256: snapshot.sourceBindingSha256, fullResponseSha256: snapshot.fullResponseSha256,
  ledgerSha256: snapshot.ledgerSha256, independentSqlCount: snapshot.independentSqlCount, capturedAt: snapshot.capturedAt },
  legacyDriftEvidence: evidencePath ? JSON.parse(readFileSync(evidencePath, "utf8")) as MigrationPlanInput["legacyDriftEvidence"] : undefined });
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
if (!plan.ready) process.exitCode = 1;
