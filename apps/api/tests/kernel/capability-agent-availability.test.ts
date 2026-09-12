import type { GuardedCapability } from "../../src/application/identity/capability-ports";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgCapabilityRepository } from "../../src/infrastructure/identity/pg-capability-repository";
import { PgDefaultAgentRepository } from "../../src/infrastructure/agent/pg-default-agent-repository";
import { PgPublishedAgentReader } from "../../src/infrastructure/chat/pg-chat-message-command-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { decideCapabilityVisibility } from "../../src/domain/identity/capability-listing";
import { projectListingForOrg } from "../../src/domain/identity/local-org";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";

const ORG = toOrgId(`org-agent-availability-${randomUUID()}`);
const missing = `cap-${randomUUID()}`;
let agentId: string;
let db: PgDatabase;
let repo: PgCapabilityRepository;
let reader: PgPublishedAgentReader;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await seedOrg({ orgId: ORG, projectId: `proj-${randomUUID()}` });
  db = new PgDatabase(appConfig());
  repo = new PgCapabilityRepository(db);
  reader = new PgPublishedAgentReader(db);
  agentId = (await new PgDefaultAgentRepository(db).ensure({ orgId: ORG, actorId: "test-admin", now: new Date() })).agentId;
  await asApp(ORG, (c) => c.query(
    `INSERT INTO capability_listings (id,org_id,kind,name,scope,enabled,abbr,duty)
     VALUES ($1,$2,'agent','Saved Agent','org-wide',true,'AG','Assistant')`, [missing, ORG],
  ));
}, 180_000);

afterAll(async () => { await db?.close(); await resetOrgs(ORG); });

async function listing(id: string) {
  const row = await repo.findById(ORG, id);
  expect(row).not.toBeNull();
  return discloseListing(row!);
}

function discloseListing(row: GuardedCapability) {
  const decision = decideCapabilityVisibility({ decisionId: "availability-test", orgRole: "admin", requesterTeamId: null, scope: row.facts.scope, ownerTeamId: row.facts.ownerTeamId });
  const result = discloseDecided(row.listing, decision);
  if (!isDisclosed(result)) throw new Error("fixture was not visible");
  return projectListingForOrg(result.payload, "enterprise");
}

it("keeps an unresolvable saved entry visible, disabled, with an actionable reason and no data rewrite", async () => {
  expect(await reader.resolvePublished(ORG, missing)).toBeNull();
  const entry = await listing(missing);
  expect(entry.enabled).toBe(false);
  expect(entry.disabledReason).toBe("该 Agent 尚无可用的已发布版本，请联系管理员。");
  for (const rows of [await repo.listByKind(ORG, "agent"), await repo.listAll(ORG)]) {
    const saved = rows.find((r) => r.facts.id === missing);
    expect(saved).toBeDefined();
    expect(discloseListing(saved!).enabled).toBe(false);
  }
  const stored = await asApp(ORG, (c) => c.query("SELECT enabled FROM capability_listings WHERE id=$1", [missing]));
  expect(stored.rows[0]?.enabled).toBe(true);
});

it("tracks the same enabled published snapshot as message resolution", async () => {
  expect(await reader.resolvePublished(ORG, agentId)).not.toBeNull();
  expect((await listing(agentId)).enabled).toBe(true);
  await asApp(ORG, (c) => c.query("UPDATE agents SET status='disabled' WHERE id=$1", [agentId]));
  expect(await reader.resolvePublished(ORG, agentId)).toBeNull();
  expect((await listing(agentId)).enabled).toBe(false);
  await asApp(ORG, (c) => c.query("UPDATE agents SET status='enabled',published_version_id=NULL WHERE id=$1", [agentId]));
  expect(await reader.resolvePublished(ORG, agentId)).toBeNull();
  expect((await listing(agentId)).enabled).toBe(false);
});
