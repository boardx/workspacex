import { afterAll, beforeAll, expect, it } from "vitest";
import { addChatMessage, addChatThread } from "./chat-db";
import { asOwner, cleanupSeededOrganizations, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "./db";
import { enableExtraction } from "../knowledge-graph/kg-extraction-fixtures";

const OWN = "org-db-file-cleanup-owned";
const FOREIGN = "org-db-file-cleanup-unregistered";

beforeAll(async () => { ensureDatabase(); await migrateOnce(); await resetOrgs(OWN, FOREIGN); });
afterAll(() => resetOrgs(OWN, FOREIGN));

it("removes owned pending model work without touching an unregistered tenant, and is idempotent", async () => {
  await seedOrg({ orgId: OWN, projectId: `${OWN}-project` });
  // Deliberately not seedOrg: represents a fixture owned by another file.
  await asOwner(c => c.query(
    "INSERT INTO organizations (id,name,kind,owner_user_id,seat_quota) VALUES ($1,$1,'organization',NULL,1000)", [FOREIGN],
  ));
  await enableExtraction(OWN, FOREIGN);
  for (const orgId of [OWN, FOREIGN]) {
    const threadId = `${orgId}-thread`;
    await addChatThread({ orgId, id: threadId, projectId: null, visibilityScope: "private", createdBy: "fixture-owner" });
    await addChatMessage({ orgId, id: `${orgId}-message`, threadId, body: "Queued fixture work", authorId: "fixture-owner" });
  }
  const pending = () => asOwner(c => c.query<{ org_id: string }>(
    "SELECT org_id FROM kg_extraction_queue WHERE org_id = ANY($1::text[]) ORDER BY org_id", [[OWN, FOREIGN]],
  )).then(r => r.rows.map(row => row.org_id));
  expect(await pending()).toEqual([OWN, FOREIGN]);
  const assertOwnedWorkGone = async () => expect(await pending()).toEqual([FOREIGN]);
  // Counterproof: omitting file cleanup makes this exact boundary assertion red.
  await expect(assertOwnedWorkGone()).rejects.toThrow();
  await cleanupSeededOrganizations();
  await assertOwnedWorkGone();
  await cleanupSeededOrganizations();
  expect(await pending()).toEqual([FOREIGN]);
  expect((await asOwner(c => c.query("SELECT id FROM organizations WHERE id=$1", [FOREIGN]))).rowCount).toBe(1);
});
