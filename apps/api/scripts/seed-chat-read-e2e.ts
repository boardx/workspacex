/**
 * Controlled database fixture for issue #405's browser read-path verification.
 *
 * This is deliberately not a product fallback. It runs only when CHAT_E2E_FIXTURE=1,
 * writes a dedicated tenant, and the browser still reads every value through the real
 * login, identity and Chat HTTP controllers.
 */
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  resetOrgs,
  seedOrg,
} from "../tests/support/db";
import { addChatMessage, addChatThread } from "../tests/support/chat-db";

if (process.env.CHAT_E2E_FIXTURE !== "1") {
  throw new Error("CHAT_E2E_FIXTURE=1 is required");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const password = required("CHAT_E2E_PASSWORD");
const ORG_ID = required("CHAT_E2E_ORG_ID");
const USER_ID = required("CHAT_E2E_USER_ID");
const PROJECT_ID = required("CHAT_E2E_PROJECT_ID");
const THREAD_ID = required("CHAT_E2E_THREAD_ID");
const EMAIL = required("CHAT_E2E_EMAIL");
const AGENT_ID = required("CHAT_E2E_AGENT_ID");

await resetOrgs(ORG_ID);
await asOwner(async (client) => {
  await client.query("DELETE FROM credentials WHERE user_id = $1 OR email = $2", [USER_ID, EMAIL]);
});

await seedOrg({ orgId: ORG_ID, projectId: PROJECT_ID, groupNames: ["readers"] });
await addOrgMember(ORG_ID, USER_ID, "lead", null);
await addProjectMember(ORG_ID, PROJECT_ID, USER_ID, "facilitator", null);

const passwordHash = await new BcryptPasswordHasher().hash(password);
await asOwner(async (client) => {
  await client.query(
    `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
     VALUES ($1,$2,$3,$4,now())`,
    [USER_ID, EMAIL, "Chat Read E2E", passwordHash],
  );
});

await addChatThread({
  orgId: ORG_ID,
  id: THREAD_ID,
  projectId: PROJECT_ID,
  visibilityScope: "plenary",
  createdBy: USER_ID,
  phase: "research",
  title: "Controlled fixture thread",
});

for (let index = 1; index <= 21; index += 1) {
  const suffix = String(index).padStart(2, "0");
  await addChatMessage({
    orgId: ORG_ID,
    id: `message-chat-read-e2e-${suffix}`,
    threadId: THREAD_ID,
    authorId: index % 2 === 0 ? AGENT_ID : USER_ID,
    authorKind: index % 2 === 0 ? "agent" : "human",
    agentId: index % 2 === 0 ? AGENT_ID : null,
    body: `Controlled fixture message ${suffix}`,
  });
}

await asApp(ORG_ID, async (client) => {
  await client.query(
    "INSERT INTO org_agents (org_id, agent_id, abbr, name, duty) VALUES ($1,$2,$3,$4,$5)",
    [ORG_ID, AGENT_ID, "CR", "Controlled Read Agent", "Read-only E2E roster fixture"],
  );
  await client.query(
    "INSERT INTO chat_thread_agents (thread_id, org_id, agent_id, presence) VALUES ($1,$2,$3,'present')",
    [THREAD_ID, ORG_ID, AGENT_ID],
  );
});

process.stdout.write(
  `[chat-read-e2e-fixture] seeded org=${ORG_ID} project=${PROJECT_ID} thread=${THREAD_ID} messages=21 roster=1\n`,
);
