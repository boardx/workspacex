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
/** #458: the org ADMIN, a second account -- see the fixture for why it is not the same one. */
const adminEmail = required("FULLSTACK_E2E_ADMIN_EMAIL");
const adminPassword = required("FULLSTACK_E2E_ADMIN_PASSWORD");
const adminUserId = required("FULLSTACK_E2E_ADMIN_USER_ID");
/** #458: a non-admin of its own, so no account is shared across parallel spec files. */
const memberEmail = required("FULLSTACK_E2E_MEMBER_EMAIL");
const memberPassword = required("FULLSTACK_E2E_MEMBER_PASSWORD");
const memberUserId = required("FULLSTACK_E2E_MEMBER_USER_ID");

ensureDatabase();
await migrateOnce();
await resetOrgs(orgId);
await asOwner(async (client) => {
  await client.query(
    "DELETE FROM credentials WHERE user_id = ANY($1::text[]) OR email = ANY($2::text[])",
    [[userId, adminUserId, memberUserId], [email, adminEmail, memberEmail]],
  );
});
const fixture = await seedOrg({ orgId, projectId, teamNames: ["fullstack"], groupNames: ["gate"] });
await asApp(orgId, (client) => client.query(
  "UPDATE projects SET name = $1 WHERE id = $2 AND org_id = $3",
  [projectName, projectId, orgId],
));
await addOrgMember(orgId, userId, "consultant", fixture.teams.fullstack ?? null);
await addProjectMember(orgId, projectId, userId, "facilitator", null, true);

await addOrgMember(orgId, adminUserId, "admin", null);
await addOrgMember(orgId, memberUserId, "consultant", fixture.teams.fullstack ?? null);

const hasher = new BcryptPasswordHasher();
const passwordHash = await hasher.hash(password);
const adminPasswordHash = await hasher.hash(adminPassword);
const memberPasswordHash = await hasher.hash(memberPassword);
await asOwner(async (client) => {
  await client.query(
    `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
     VALUES ($1,$2,$3,$4,now()), ($5,$6,$7,$8,now()), ($9,$10,$11,$12,now())`,
    [
      userId, email, "Fullstack E2E", passwordHash,
      adminUserId, adminEmail, "Fullstack E2E admin", adminPasswordHash,
      memberUserId, memberEmail, "Fullstack E2E member", memberPasswordHash,
    ],
  );
});

// ⚠ 刻意**没有**预置任何 capability_listings 行。#458 的浏览器门控要证的正是
// 「界面新建出来的那一条真的落进了 PostgreSQL」——先塞一条进去，
// 那条断言就会在「新建根本没生效」时照样绿。
await addBrowserArtifact({
  orgId, id: artifactId, projectId, source: "upload", title: sentinelFile,
  ingestionStatus: "READY", creator: { kind: "user", id: userId },
  text: `unique sentinel ${sentinelFile}`, sizeBytes: 387, mime: "text/markdown",
});

process.stdout.write(`[fullstack-fixture] db=${required("WORKSPACEX_DB")} project=${projectId} sentinel=${sentinelFile}\n`);
