import { readFileSync } from "node:fs";
import { generateMigrationPlan } from "./cn-migration-plan";
import type { MigrationPlanInput } from "./cn-migration-plan";

const [checkout, targetSha, baselineSha, ledgerPath, evidencePath] = process.argv.slice(2);
if (!checkout || !targetSha || !baselineSha || !ledgerPath) throw new Error("usage: cn-migration-plan-cli <frozen-checkout> <target-sha> <baseline-sha> <read-only-ledger.json> [legacy-evidence.json]");
const snapshot = JSON.parse(readFileSync(ledgerPath, "utf8")) as { readOnly?: boolean; ledger?: MigrationPlanInput["ledger"] };
if (snapshot.readOnly !== true || !Array.isArray(snapshot.ledger)) throw new Error("read-only ledger snapshot required");
const plan = await generateMigrationPlan(checkout, { targetSha, baselineSha, ledger: snapshot.ledger,
  legacyDriftEvidence: evidencePath ? JSON.parse(readFileSync(evidencePath, "utf8")) as MigrationPlanInput["legacyDriftEvidence"] : undefined });
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
if (!plan.ready) process.exitCode = 1;
