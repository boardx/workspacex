import { toOrgId } from "../src/domain/org-id";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { appConfig } from "../src/infrastructure/db/pg-config";
import { createStorageBackends } from "../src/infrastructure/storage/create-object-store";
import { maintainPhysicalDeletion } from "../src/infrastructure/files/physical-deletion-maintenance";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--org") throw new Error("expected --org identifier");
  const orgId = toOrgId(args[1]);
  // The operator supplies the runtime DB identity and selected storage credentials.
  // Eligibility, current legal holds, and object keys are read from tenant-scoped rows.
  const { purge } = await createStorageBackends();
  const db = new PgDatabase(appConfig());
  try {
    const result = await maintainPhysicalDeletion(db, purge, orgId);
    console.log(JSON.stringify(result));
    if (result.status === "busy" || result.outcomes.some((item) => item.outcome === "skipped-purge-failed")) process.exitCode = 1;
  } finally { await db.close(); }
}
main().catch(() => { console.error("Physical deletion maintenance failed; no completion is claimed."); process.exitCode = 1; });
