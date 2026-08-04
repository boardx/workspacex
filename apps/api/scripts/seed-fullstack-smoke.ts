/** Controlled PG fixture for #387's login -> projects -> overview -> Files browser gate. */
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import {
  addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../tests/support/db";
import { addBrowserArtifact } from "../tests/support/files-db";

if (process.env.FULLSTACK_E2E_FIXTURE !== "1") throw new Error("FULLSTACK_E2E_FIXTURE=1 is required");
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const email = required("FULLSTACK_E2E_EMAIL");
const password = required("FULLSTACK_E2E_PASSWORD");
const orgId = required("FULLSTACK_E2E_ORG_ID");
const userId = required("FULLSTACK_E2E_USER_ID");
const projectId = required("FULLSTACK_E2E_PROJECT_ID");
const projectName = required("FULLSTACK_E2E_PROJECT_NAME");
const artifactId = required("FULLSTACK_E2E_ARTIFACT_ID");
const sentinelFile = required("FULLSTACK_E2E_SENTINEL_FILE");

ensureDatabase();
await migrateOnce();
await resetOrgs(orgId);
await asOwner(async (client) => {
  await client.query("DELETE FROM credentials WHERE user_id = $1 OR email = $2", [userId, email]);
});
const fixture = await seedOrg({ orgId, projectId, teamNames: ["fullstack"], groupNames: ["gate"] });
await asApp(orgId, (client) => client.query(
  "UPDATE projects SET name = $1 WHERE id = $2 AND org_id = $3",
  [projectName, projectId, orgId],
));
await addOrgMember(orgId, userId, "consultant", fixture.teams.fullstack ?? null);
await addProjectMember(orgId, projectId, userId, "facilitator", null, true);

const passwordHash = await new BcryptPasswordHasher().hash(password);
await asOwner(async (client) => {
  await client.query(
    `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
     VALUES ($1,$2,$3,$4,now())`,
    [userId, email, "Fullstack E2E", passwordHash],
  );
});
await addBrowserArtifact({
  orgId, id: artifactId, projectId, source: "upload", title: sentinelFile,
  ingestionStatus: "READY", creator: { kind: "user", id: userId },
  text: `unique sentinel ${sentinelFile}`, sizeBytes: 387, mime: "text/markdown",
});

process.stdout.write(`[fullstack-fixture] db=${required("WORKSPACEX_DB")} project=${projectId} sentinel=${sentinelFile}\n`);
