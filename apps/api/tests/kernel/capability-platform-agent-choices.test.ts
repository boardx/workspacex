import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { backfillPlatformOrg } from "../../scripts/backfill-platform-org";
import { PgCapabilityRepository } from "../../src/infrastructure/identity/pg-capability-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PLATFORM_ORG_ID, toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId(`org-agent-choice-${randomUUID()}`);
const localAgent = `agent-${randomUUID()}`;
const platformAgent = `agent-${randomUUID()}`;
const platformSkill = `skill-${randomUUID()}`;
let db: PgDatabase;
let repo: PgCapabilityRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await backfillPlatformOrg();
  await seedOrg({ orgId: ORG, projectId: `proj-${randomUUID()}` });
  for (const [id, org, kind] of [
    [localAgent, ORG, "agent"],
    [platformAgent, PLATFORM_ORG_ID, "agent"],
    [platformSkill, PLATFORM_ORG_ID, "skill"],
  ]) {
    await asApp(org!, (c) => c.query(
      `INSERT INTO capability_listings (id,org_id,kind,name,scope,enabled,abbr,duty)
       VALUES ($1,$2,$3,'Ready choice','org-wide',true,$4,$5)`,
      [id, org, kind, kind === "agent" ? "AG" : null, kind === "agent" ? "Assistant" : null],
    ));
  }
  db = new PgDatabase(appConfig());
  repo = new PgCapabilityRepository(db);
}, 180_000);

afterAll(async () => {
  await db?.close();
  await asOwner((c) => c.query("DELETE FROM capability_listings WHERE id = ANY($1::text[])", [[platformAgent, platformSkill]]));
  await resetOrgs(ORG);
});

it("agent choices retain the organization's entry without importing platform Agents", async () => {
  const ids = (await repo.listByKind(ORG, "agent")).map((row) => row.facts.id);
  expect(ids).toContain(localAgent);
  expect(ids).not.toContain(platformAgent);
});

it("the combined directory still includes shared Skills but excludes platform Agents", async () => {
  const ids = (await repo.listAll(ORG)).map((row) => row.facts.id);
  expect(ids).toContain(localAgent);
  expect(ids).toContain(platformSkill);
  expect(ids).not.toContain(platformAgent);
  expect((await repo.listByKind(ORG, "skill")).map((row) => row.facts.id)).toContain(platformSkill);
});

it("direct lookup follows the same scope and a platform Agent remains visible to its own organization", async () => {
  expect(await repo.findById(ORG, platformAgent)).toBeNull();
  expect((await repo.findById(ORG, localAgent))?.facts.id).toBe(localAgent);
  expect((await repo.findById(ORG, platformSkill))?.facts.id).toBe(platformSkill);
  expect((await repo.findById(toOrgId(PLATFORM_ORG_ID), platformAgent))?.facts.id).toBe(platformAgent);
});
