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
const AGENT_VERSION_ID = `${AGENT_ID}-version-1`;
/**
 * #467：只进**组织 agent 目录**、不进本线程编制的第二个 agent。
 * 「把一个 agent 加进会话」这条用例需要一个当前不在编制里、但服务端认可的 agent；
 * 拿已在编制里的 `AGENT_ID` 去做，什么都不做的实现也会绿。
 */
const CATALOG_ONLY_AGENT_ID = required("CHAT_E2E_CATALOG_ONLY_AGENT_ID");

await resetOrgs(ORG_ID);
await asOwner(async (client) => {
  await client.query("DELETE FROM credentials WHERE user_id = $1 OR email = $2", [USER_ID, EMAIL]);
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS chat_wave2_fixture;
    CREATE TABLE IF NOT EXISTS chat_wave2_fixture.agents (
      id text PRIMARY KEY,
      org_id text NOT NULL,
      status text NOT NULL,
      published_version_id text NULL
    );
    CREATE TABLE IF NOT EXISTS chat_wave2_fixture.agent_versions (
      id text PRIMARY KEY,
      org_id text NOT NULL,
      agent_id text NOT NULL REFERENCES chat_wave2_fixture.agents(id) ON DELETE CASCADE,
      skill_version_ids jsonb NOT NULL,
      model_provider text NOT NULL,
      model_id text NOT NULL,
      published_at timestamptz NULL
    );
    DO $$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['agents', 'agent_versions'] LOOP
        EXECUTE format('ALTER TABLE chat_wave2_fixture.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE chat_wave2_fixture.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON chat_wave2_fixture.%I', t || '_tenant', t);
        EXECUTE format(
          'CREATE POLICY %I ON chat_wave2_fixture.%I USING (org_id = current_setting(''app.current_org'', true)) WITH CHECK (org_id = current_setting(''app.current_org'', true))',
          t || '_tenant', t
        );
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON chat_wave2_fixture.%I TO app_rw', t);
      END LOOP;
      GRANT USAGE ON SCHEMA chat_wave2_fixture TO app_rw;
    END $$;
  `);
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

for (let index = 1; index <= 51; index += 1) {
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
  await client.query("DELETE FROM chat_wave2_fixture.agent_versions WHERE org_id=$1", [ORG_ID]);
  await client.query("DELETE FROM chat_wave2_fixture.agents WHERE org_id=$1", [ORG_ID]);
  await client.query(
    `INSERT INTO chat_wave2_fixture.agents (id,org_id,status,published_version_id)
     VALUES ($1,$2,'enabled',$3)`,
    [AGENT_ID, ORG_ID, AGENT_VERSION_ID],
  );
  await client.query(
    `INSERT INTO chat_wave2_fixture.agent_versions
       (id,org_id,agent_id,skill_version_ids,model_provider,model_id,published_at)
     VALUES ($1,$2,$3,'[]'::jsonb,'dashscope','qwen-plus',now())`,
    [AGENT_VERSION_ID, ORG_ID, AGENT_ID],
  );
  await client.query(
    "INSERT INTO org_agents (org_id, agent_id, abbr, name, duty) VALUES ($1,$2,$3,$4,$5)",
    [ORG_ID, AGENT_ID, "CR", "Controlled Read Agent", "Read-only E2E roster fixture"],
  );
  // #467：进目录但**不**进 `chat_thread_agents`——它是「加进来」那条用例的素材。
  await client.query(
    "INSERT INTO org_agents (org_id, agent_id, abbr, name, duty) VALUES ($1,$2,$3,$4,$5)",
    [ORG_ID, CATALOG_ONLY_AGENT_ID, "CO", "Catalog Only Agent", "Roster mount E2E fixture"],
  );
  await client.query(
    "INSERT INTO chat_thread_agents (thread_id, org_id, agent_id, presence) VALUES ($1,$2,$3,'present')",
    [THREAD_ID, ORG_ID, AGENT_ID],
  );
});

process.stdout.write(
  `[chat-read-e2e-fixture] seeded org=${ORG_ID} project=${PROJECT_ID} thread=${THREAD_ID} messages=51 roster=1 publishedAgent=1 catalogOnlyAgent=1\n`,
);
