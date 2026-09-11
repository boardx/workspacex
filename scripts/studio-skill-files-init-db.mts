/** Test-only migration entry point; reject before any DB setup or seed import. */
import { withStudioIsolation } from "./studio-skill-files-guards.mts";
await withStudioIsolation(async () => {
  const { ensureDatabase, migrateOnce } = await import("../apps/api/tests/support/db.ts");
  await ensureDatabase();
  await migrateOnce();
});
process.exit(0);
