import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { trackSeededOrganization } from "./fixture-ownership";
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

it("retries a real PostgreSQL rollback and closes both failed and successful cleanup clients", async () => {
  await seedOrg({ orgId: OWN, projectId: `${OWN}-project` });
  // Inject the exact SQLSTATE in PostgreSQL, not a database substitute. Sequence
  // increments survive rollback, so only the first real DELETE is aborted.
  await asOwner(c => c.query(`
    CREATE SEQUENCE fixture_cleanup_deadlock_attempt;
    CREATE FUNCTION fixture_cleanup_deadlock_once() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.id = '${OWN}' AND nextval('fixture_cleanup_deadlock_attempt') = 1 THEN
        RAISE EXCEPTION 'injected deadlock rollback' USING ERRCODE = '40P01';
      END IF;
      RETURN OLD;
    END;
    $$;
    CREATE TRIGGER fixture_cleanup_deadlock_once BEFORE DELETE ON organizations
      FOR EACH ROW EXECUTE FUNCTION fixture_cleanup_deadlock_once();
  `));
  const remove = vi.fn(() => resetOrgs(OWN));
  trackSeededOrganization(OWN, remove);
  const close = vi.spyOn(pg.Client.prototype, "end");
  try {
    await cleanupSeededOrganizations();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    close.mockRestore();
    const remaining = await asOwner(c => c.query("SELECT id FROM organizations WHERE id=$1", [OWN]));
    expect(remaining.rows).toEqual([]);
    expect((await asOwner(c => c.query("SELECT id FROM organizations WHERE id=$1", [FOREIGN]))).rows).toHaveLength(1);
    await cleanupSeededOrganizations();
    expect(remove).toHaveBeenCalledTimes(2);
  } finally {
    close.mockRestore();
    await asOwner(c => c.query(`
      DROP TRIGGER fixture_cleanup_deadlock_once ON organizations;
      DROP FUNCTION fixture_cleanup_deadlock_once();
      DROP SEQUENCE fixture_cleanup_deadlock_attempt;
    `));
  }
});
