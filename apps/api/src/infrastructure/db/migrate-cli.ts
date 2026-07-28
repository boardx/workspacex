/** Entry point for `pnpm --filter api run migrate`. Connects as the OWNER to run DDL. */
import { migrationConfig } from "./pg-config";
import { migrate } from "./migrator";

const force = process.argv.includes("--force");
const r = await migrate(migrationConfig(), { force });
console.log(
  `applied ${r.applied.length} migration(s)${force ? " (force: replayed ignoring version table)" : ""}, skipped ${r.skipped.length}`,
);
for (const n of r.applied) console.log(`  + ${n}`);
