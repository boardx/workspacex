import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wave2Runtime } from "@repo/contracts";
import { ensureDatabase, migrateOnce, seedOrg, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAuthoredDisplayUpdateRepository } from "../../src/infrastructure/localization/pg-authored-display-update-repository";
import { PgSkillStarterImportRepository } from "../../src/infrastructure/skill/pg-skill-starter-import-repository";
import { PgOfficialAgentRolePackImportRepository } from "../../src/infrastructure/agent/pg-official-agent-role-pack-import-repository";
import { PgEntityLocalizationRepository } from "../../src/infrastructure/localization/pg-entity-localization-repository";
import { DISPLAY_METADATA_VERSION } from "../../src/domain/localization/authored-display-metadata";
import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";
import { checkWorkSkillManifests } from "../../src/domain/skill/work-skill-import-check";
import { decideCapabilityVisibility } from "../../src/domain/identity/capability-listing";
import type { LocalizationVisibilityFacts } from "../../src/application/localization/entity-localization";
import { toOrgId } from "../../src/domain/org-id";
import { sha } from "./portable-pack-fixture";
let db: PgDatabase, orgId: ReturnType<typeof toOrgId>, teamId: string;
const authorize = (facts: LocalizationVisibilityFacts) => decideCapabilityVisibility({ decisionId: "display-update", orgRole: "admin", requesterTeamId: null, ...facts });
const request = () => ({ orgId, actorId: "author", authorize, expectedOrgId: orgId, expectedMetadataVersion: DISPLAY_METADATA_VERSION, idempotencyKey: randomUUID() });
const updates = () => new PgAuthoredDisplayUpdateRepository(db);
const copies = () => new PgEntityLocalizationRepository(db);
beforeAll(async () => { ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig()); });
afterAll(async () => { await db?.close(); });
beforeEach(async () => { orgId = toOrgId(`display-update-${randomUUID()}`); const seeded = await seedOrg({ orgId, projectId: `${orgId}-project` }); teamId = seeded.teams.platform!; });
async function skills() {
  const raw = JSON.parse(readFileSync(resolve(__dirname,"../../../../skills/starter-packs/work-research/1.0.0.json"),"utf8"));
  const { packDigest: _digest, ...base } = raw;
  const unsigned = wave2Runtime.UnsignedSkillStarterPack.parse({ ...base, packId: "display-update-fixture", skills: raw.skills.filter((entry: { name: string }) => ["S003","S017"].includes(entry.name)) });
  const pack = { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
  const work = checkWorkSkillManifests(pack); if (work.kind !== "ok") throw Error("fixture manifest failed");
  const imported = await new PgSkillStarterImportRepository(db).persistVerified({ orgId, actorId: "author", idempotencyKey: randomUUID(), payloadDigest: sha(pack.packDigest), pack, workManifests: work.manifests });
  if (imported.kind !== "created") throw Error("fixture import failed");
  return Object.fromEntries(pack.skills.map((entry,i) => [entry.name, imported.result.skillIds[i]!])) as Record<"S003"|"S017",string>;
}
async function execution() {
  return asApp(orgId, async c => ({ versions: (await c.query("SELECT id,skill_id,content_digest,manifest FROM skill_versions WHERE org_id=$1 ORDER BY id",[orgId])).rows,
    files: (await c.query("SELECT version_id,path,digest,content FROM skill_version_files WHERE org_id=$1 ORDER BY version_id,path",[orgId])).rows }));
}
describe("explicit authored display updates for installed organizations", () => {
  it("offers and applies display titles with independent versioning and exact replay, without publishing execution", async () => {
    const ids = await skills(), before = await execution();
    expect(await updates().offer({ orgId, authorize })).toMatchObject({ metadataVersion: DISPLAY_METADATA_VERSION, available: true, installedCount: 2 });
    const input = request(), result = await updates().apply(input);
    expect(result).toMatchObject({ metadataVersion: DISPLAY_METADATA_VERSION, updatedEntities: 2, replayed: false });
    expect((await copies().displays(orgId,"skill",[ids.S003],"en")).get(ids.S003)?.fields.name.value).toBe("Enterprise Search");
    expect((await copies().displays(orgId,"skill",[ids.S003],"zh-CN")).get(ids.S003)?.fields.name.value).toBe("企业内部检索");
    expect(await execution()).toEqual(before);
    expect(await updates().apply(input)).toEqual({ ...result, replayed: true });
    expect(await updates().offer({ orgId, authorize })).toMatchObject({ available: false });
    expect(await updates().apply({ ...request(), expectedMetadataVersion: "obsolete" })).toBeNull();
  });
  it("keeps manual translations and clear tombstones intact", async () => {
    const ids = await skills();
    const target = (id: string) => ({ orgId, actorId: "author", kind: "skill" as const, entityId: id, locale: "en" as const, authorize });
    for (const id of Object.values(ids)) {
      const view = (await copies().get(target(id)))!;
      await copies().put({ ...target(id), body: { sourceRevision: view.source.revision, expectedTranslationRevision: null, status: "reviewed", fields: { name: "Manual name" } } });
    }
    const cleared = (await copies().get(target(ids.S017)))!;
    await copies().clear({ ...target(ids.S017), body: { sourceRevision: cleared.source.revision, expectedTranslationRevision: cleared.translation!.revision } });
    await updates().apply(request());
    expect((await copies().get(target(ids.S003)))?.translation?.fields.name).toBe("Manual name");
    expect((await copies().get(target(ids.S017)))?.translation).toMatchObject({ status: "draft", fields: { name: null } });
  });
  it("does not treat one admin's receipt as completion for a different team's private capabilities", async () => {
    const ids = await skills();
    await asApp(orgId,c => c.query("UPDATE capability_listings SET scope='team-only',owner_team_id=$2 WHERE id=$1",[ids.S017,teamId]));
    expect(await updates().offer({ orgId, authorize })).toMatchObject({ installedCount: 1 });
    const firstScope = request();
    await updates().apply(firstScope);
    const teamAuthorize = (facts: LocalizationVisibilityFacts) => decideCapabilityVisibility({ decisionId: "team-admin", orgRole: "admin", requesterTeamId: teamId, ...facts });
    expect(await updates().apply({ ...firstScope,authorize: teamAuthorize })).toBeNull();
    expect(await updates().offer({ orgId, authorize: teamAuthorize })).toMatchObject({ installedCount: 2, available: true });
    const input = { ...request(), actorId: "team-author", authorize: teamAuthorize };
    await updates().apply(input);
    expect((await copies().displays(orgId,"skill",[ids.S017],"en")).get(ids.S017)?.fields.name.value).toBe("Task Extraction");
  });
  it("updates already-installed official roles without changing instructions, model or frozen role fields", async () => {
    const legacy = buildOfficialAgentRolePack(), source = legacy.agents.find(entry => entry.roleRef === "D003")!;
    const unsigned = wave2Runtime.UnsignedOfficialAgentStarterPack.parse({ schemaVersion: 1, packId: "older-official-fixture", packVersion: "1.0.0",
      agents: [{ ...source, instructions: "Older published original instructions", instructionDigest: sha("Older published original instructions"),
        skillVersions: [], authoredSkillBindings: [], role: { ...source.role, workflowAllowlist: [] } }] });
    const pack = { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
    const imported = await new PgOfficialAgentRolePackImportRepository(db).persistVerified({ orgId, actorId: "author", idempotencyKey: randomUUID(), payloadDigest: sha(pack.packDigest), pack });
    if (imported.kind !== "created") throw Error("official fixture failed");
    const snapshot = () => asApp(orgId,c => c.query("SELECT * FROM agent_versions WHERE org_id=$1 ORDER BY id",[orgId]));
    const before = await snapshot();
    expect(await updates().offer({ orgId, authorize })).toMatchObject({ available: true, installedCount: 1 });
    await updates().apply(request());
    expect((await copies().displays(orgId,"agent",imported.result.agentIds,"en")).get(imported.result.agentIds[0]!)?.fields.name.value).toBe("Product Manager");
    expect((await snapshot()).rows).toEqual(before.rows);
  });
});
