/** Entry point for migration. Connects as the OWNER to run DDL. */
import { migrationConfig } from "./pg-config";
import { migrate } from "./migrator";

try {
  const force = process.argv.includes("--force");
  const r = await migrate(migrationConfig(), { force });
  console.log(`applied ${r.applied.length} migration(s)${force ? " (force: replayed ignoring version table)" : ""}, skipped ${r.skipped.length}`);
  for (const n of r.applied) console.log(`  + ${n}`);
} catch {
  // SQL and connection errors can carry credentials or application data. Provision logs
  // expose the failed stage; detailed diagnostics belong in the protected DB service.
  console.error(JSON.stringify({ ok: false, reason: "migration_failed" }));
  process.exitCode = 1;
}
