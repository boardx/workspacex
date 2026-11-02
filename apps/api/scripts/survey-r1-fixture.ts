/** #6118: only the disposable fullstack database, never a runtime provisioning route. */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertIsolatedDatabase } from "../../../.harness/scripts/lib/test-isolation";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { seedCredential } from "../tests/support/auth";
import { addOrgMember, asOwner, ensureDatabase, resetOrgs, seedOrg } from "../tests/support/db";
const Input = z.object({ id: z.string().uuid(), password: z.string().min(12).optional() }).strict();
async function main() {
  assertIsolatedDatabase({ resolvedDatabase: migrationConfig().database ?? "", env: process.env });
  if (!process.env.WORKSPACEX_ISOLATION_ID) throw Error("isolated_fullstack_required");
  ensureDatabase();
  const input = Input.parse(JSON.parse(readFileSync(0, "utf8")));
  const userId = `survey-r1-6118-${input.id}`, orgId = `local-${userId}`, email = `${userId}@example.test`;
  if (process.argv[2] === "seed") {
    if (!input.password) throw Error("fixture_password_required");
    await seedCredential({ userId, email, password: input.password, emailVerified: true });
    await seedOrg({ orgId, kind: "personal-local", ownerUserId: userId, projectId: `${orgId}-project` });
    await addOrgMember(orgId, userId, "admin", null);
    console.log(`__SURVEY_R1_FIXTURE__${JSON.stringify({ userId, orgId, email })}`);
  } else if (process.argv[2] === "cleanup") {
    const created = await asOwner(c => c.query<{ org_id: string }>("SELECT org_id FROM organization_creation_requests WHERE user_id=$1", [userId]));
    await resetOrgs([orgId, ...created.rows.map(row => row.org_id)]);
    await asOwner(c => c.query("DELETE FROM credentials WHERE user_id=$1 AND email=$2", [userId, email]));
    console.log("__SURVEY_R1_FIXTURE__{}");
  } else throw Error("unknown_fixture_command");
}
main().catch(() => { console.error("Isolated Survey R1 fixture failed."); process.exitCode = 1; });
