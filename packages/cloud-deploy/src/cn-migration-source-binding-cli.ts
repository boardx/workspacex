/** Root-owned production inputs are prepared independently, not copied from a ledger snapshot. */
import { closeSync,fsyncSync,writeFileSync } from "node:fs";
import { deriveMigrationSourceIdentity } from "./cn-migration-source-identity";
import { readMigrationSnapshotFile,migrationSnapshotBindingSchema } from "./cn-migration-snapshot";
import { openPrivateReport } from "./cn-migration-rehearsal-safety";
const [lane,evidencePath,auditPath,dispatchPath,output]=process.argv.slice(2);
let fd:number|undefined;
try {
 if((lane!=="sql-server-address"&&lane!=="aliyun-private-endpoint")||!evidencePath||!auditPath||!dispatchPath||!output)throw Error();
 const derived=deriveMigrationSourceIdentity(readMigrationSnapshotFile(evidencePath),readMigrationSnapshotFile(auditPath),lane);
 const cloud=migrationSnapshotBindingSchema.shape.cloud.parse(readMigrationSnapshotFile(dispatchPath));
 const binding=migrationSnapshotBindingSchema.parse({schemaVersion:2,...derived,cloud});
 fd=openPrivateReport(output);writeFileSync(fd,JSON.stringify(binding));fsyncSync(fd);
 process.stdout.write("MIGRATION_SNAPSHOT_PRIVATE_BINDING_READY\n");
} catch(error) {
 const message=error instanceof Error&&/^MIGRATION_SNAPSHOT_[A-Z_]+$/.test(error.message)?error.message:"MIGRATION_SNAPSHOT_PRIVATE_BINDING_INVALID";
 process.stderr.write(`${message}\n`);process.exitCode=2;
} finally{if(fd!==undefined)closeSync(fd);}
