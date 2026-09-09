/** Test-only migration entry point; the standard isolation wrapper supplies its DB. */
import { ensureDatabase, migrateOnce } from "../apps/api/tests/support/db.ts";
await ensureDatabase();
await migrateOnce();
process.exit(0);
