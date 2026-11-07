import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, seedOrg, resetOrgs, asApp, asOwner } from "../support/db";
import { wave2Runtime } from "@repo/contracts";
import { SUPPORTED_LOCALES } from "@repo/contracts/locale";
import { ENTITY_LOCALIZATION_TEXT_LIMIT } from "@repo/contracts/entity-localization";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgEntityLocalizationRepository } from "../../src/infrastructure/localization/pg-entity-localization-repository";
import { decideCapabilityVisibility } from "../../src/domain/identity/capability-listing";
import type { LocalizationVisibilityFacts } from "../../src/application/localization/entity-localization";
import { insertAgentVersionFromDraft } from "../../src/infrastructure/agent/agent-version-insert";
import { PgSkillStarterImportRepository } from "../../src/infrastructure/skill/pg-skill-starter-import-repository";
import { verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { toOrgId } from "../../src/domain/org-id";

let db: PgDatabase;
let repository: PgEntityLocalizationRepository;
let org: string;
let other: string;
let entityId: string;
let ownerTeamId: string;
const authorize = (facts: LocalizationVisibilityFacts) => decideCapabilityVisibility({ decisionId: "localization-pg", orgRole: "admin", requesterTeamId: null, ...facts });
const request = () => ({ orgId: org, actorId: "translator", kind: "skill" as const, entityId, locale: "en" as const, authorize });
async function initialWrite() {
  const view = await repository.get(request());
  if (!view) throw Error("fixture source missing");
  return { ...request(), body: { sourceRevision: view.source.revision, expectedTranslationRevision: null, status: "reviewed" as const, fields: { name: "Discovery" } } };
}
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  db = new PgDatabase(appConfig()); repository = new PgEntityLocalizationRepository(db);
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  const suffix = randomUUID(); org = `loc-a-${suffix}`; other = `loc-b-${suffix}`; entityId = `loc-skill-${suffix}`;
  const fixture = await seedOrg({ orgId: org, projectId: `loc-project-a-${suffix}` });
  ownerTeamId = fixture.teams.energy!;
  await seedOrg({ orgId: other, projectId: `loc-project-b-${suffix}` });
  await asApp(org, c => c.query(`INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
    VALUES ($1,$2,'test-localization','探索','enabled','translator',now(),now())`, [entityId, org]));
});
describe("durable display translations under tenant RLS", () => {
  it.each(["skill", "agent"] as const)("keeps %s database text constraints aligned with the shared authoring budget", async kind => {
    const id = kind === "skill" ? entityId : `loc-budget-agent-${randomUUID()}`;
    if (kind === "agent") await asApp(org, c => c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at,instructions)
      VALUES ($1,$2,'localization-budget','Source','enabled','translator',now(),now(),'original')`, [id, org]));
    const table = kind === "skill" ? "skill_localizations" : "agent_localizations";
    const foreignKey = kind === "skill" ? "skill_id" : "agent_id";
    const atLimit = "x".repeat(ENTITY_LOCALIZATION_TEXT_LIMIT);
    await asApp(org, c => c.query(`INSERT INTO ${table}(org_id,${foreignKey},locale,source_revision,translation_revision,status,updated_by,name,summary,duty,role_label,avatar_alt)
      VALUES ($1,$2,'en','contract-budget',1,'draft','translator',$3,$3,$3,$3,$3)`, [org, id, atLimit]));
    for (const column of ["name", "summary", "duty", "role_label", "avatar_alt"]) {
      await expect(asApp(org, c => c.query(`UPDATE ${table} SET ${column}=$3 WHERE org_id=$1 AND ${foreignKey}=$2`,
        [org, id, `${atLimit}x`]))).rejects.toMatchObject({ code: "23514" });
    }
  });
  it("preserves a published null avatar when the draft acquires unpublished alt text", async () => {
    const agentId = `loc-avatar-${randomUUID()}`, versionId = `loc-avatar-version-${randomUUID()}`;
    await asApp(org, async c => {
      await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at,instructions)
        VALUES($1,$2,'avatar-null','Published agent','enabled','translator',now(),now(),'original instructions')`, [agentId, org]);
      await insertAgentVersionFromDraft(c, { orgId: org, agentId, versionId, semanticLabel: "1.0.0", instructions: "original instructions",
        instructionDigest: createHash("sha256").update("original instructions").digest("hex"), skillVersionIds: [],
        modelProvider: "configured", modelId: "configured-model", toolPolicy: [], creatorId: "translator", at: new Date().toISOString() });
      await c.query("UPDATE agents SET published_version_id=$3,avatar=$4::jsonb WHERE org_id=$1 AND id=$2",
        [org, agentId, versionId, JSON.stringify({ kind: "illustration", key: "person-1", alt: "Unpublished private draft avatar" })]);
    });
    const target = { ...request(), kind: "agent" as const, entityId: agentId };
    expect((await repository.get(target))?.source.fields.avatarAlt).toBeNull();
    const display = (await repository.displays(org, "agent", [agentId], "en")).get(agentId);
    expect(display?.fields.avatarAlt.value).toBeNull();
    expect(JSON.stringify(display)).not.toContain("Unpublished private draft avatar");
  });
  it("retains valid original descriptions beyond the translation authoring budget", async () => {
    const summary = "s".repeat(5000), bytes = Buffer.from("# Original source instructions\n");
    const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
    const unsigned = wave2Runtime.UnsignedSkillStarterPack.parse({ schemaVersion: 1, packId: "long-source-description", packVersion: "1.0.0", skills: [{
      stableName: "long-source-description", name: "Original description", semanticVersion: "1.0.0", manifest: { description: summary },
      files: [{ path: "SKILL.md", mediaType: "text/markdown", contentBase64: bytes.toString("base64"), digest: sha(bytes) }],
    }] });
    const pack = verifySkillStarterPack({ ...unsigned, packDigest: sha(JSON.stringify(unsigned)) }, unsigned);
    const imported = await new PgSkillStarterImportRepository(db).persistVerified({ orgId: toOrgId(org), actorId: "translator", idempotencyKey: randomUUID(), payloadDigest: sha(pack.packDigest), pack });
    if (imported.kind !== "created") throw Error("source import failed");
    const id = imported.result.skillIds[0]!;
    expect((await repository.get({ ...request(), entityId: id }))?.source.fields.summary).toBe(summary);
    expect((await repository.displays(org, "skill", [id, entityId], "en")).get(id)?.fields.summary.value).toBe(summary);
  });
  it("persists a reviewed translation and projects it without rewriting original content", async () => {
    expect((await repository.put(await initialWrite())).kind).toBe("ok");
    expect((await repository.displays(org, "skill", [entityId], "en")).get(entityId)?.fields.name.value).toBe("Discovery");
    await asApp(org, async c => {
      expect((await c.query("SELECT name FROM skills WHERE id=$1", [entityId])).rows[0].name).toBe("探索");
    });
    const read = await repository.get(request());
    expect(read?.translation?.revision).toBe(1);
    expect(read?.source.locale).toBeNull();
  });
  it("rejects concurrent writers using the same CAS coordinate", async () => {
    const input = await initialWrite();
    const outcomes = await Promise.all([repository.put(input), repository.put(input)]);
    expect(outcomes.map(o => o.kind).sort()).toEqual(["ok", "translation-changed"]);
  });
  it("hides old translations and rejects a write after the source changes", async () => {
    const input = await initialWrite(); await repository.put(input);
    await asApp(org, c => c.query("UPDATE skills SET name='新探索',updated_at=clock_timestamp() WHERE id=$1", [entityId]));
    expect((await repository.put({ ...input, body: { ...input.body, expectedTranslationRevision: 1 } })).kind).toBe("source-changed");
    expect((await repository.displays(org, "skill", [entityId], "en")).get(entityId)?.fields.name.value).toBe("新探索");
  });
  it("clears display text with a tombstone revision so old writers cannot resurrect it", async () => {
    const input = await initialWrite(); await repository.put(input);
    const cleared = await repository.clear({ ...request(), body: { sourceRevision: input.body.sourceRevision, expectedTranslationRevision: 1 } });
    expect(cleared.kind).toBe("ok");
    expect((await repository.displays(org, "skill", [entityId], "en")).get(entityId)?.fields.name.value).toBe("探索");
    expect((await repository.put({ ...input, body: { ...input.body, expectedTranslationRevision: 1 } })).kind).toBe("translation-changed");
  });
  it("keeps foreign entities and translations unreadable, including direct SQL", async () => {
    await repository.put(await initialWrite());
    expect(await repository.get({ ...request(), orgId: other })).toBeNull();
    expect((await repository.displays(other, "skill", [entityId], "en")).size).toBe(0);
    await asApp(other, async c => expect((await c.query("SELECT * FROM skill_localizations WHERE skill_id=$1", [entityId])).rows).toEqual([]));
    await expect(asApp(other, c => c.query(`INSERT INTO skill_localizations(org_id,skill_id,locale,source_revision,translation_revision,status,updated_by)
      VALUES ($1,$2,'en','v',1,'draft','translator')`, [other, entityId]))).rejects.toMatchObject({ code: "23503" });
  });
  it("freezes writes in a disabled org while preserving source reads", async () => {
    const input = await initialWrite();
    await asOwner(c => c.query("UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '90 days' WHERE id=$1", [org]));
    expect(await repository.get(request())).not.toBeNull();
    await expect(repository.put(input)).rejects.toBeDefined();
  });
  it("supports the same storage boundary for Agent text while retaining instructions", async () => {
    const agentId = `loc-agent-${randomUUID()}`;
    await asApp(org, c => c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at,instructions)
      VALUES ($1,$2,'test-agent-localization','研究员','enabled','translator',now(),now(),'original fixed instructions')`, [agentId, org]));
    const target = { ...request(), kind: "agent" as const, entityId: agentId };
    const view = await repository.get(target);
    if (!view) throw Error("agent source missing");
    expect((await repository.put({ ...target, body: { sourceRevision: view.source.revision, expectedTranslationRevision: null, status: "reviewed", fields: { name: "Researcher" } } })).kind).toBe("ok");
    expect((await repository.displays(org, "agent", [agentId], "en")).get(agentId)?.fields.name.value).toBe("Researcher");
    await asApp(org, async c => expect((await c.query("SELECT instructions FROM agents WHERE id=$1", [agentId])).rows[0].instructions).toBe("original fixed instructions"));
  });
  it("changes source language metadata using CAS and expires prior translations", async () => {
    const input = await initialWrite(); await repository.put(input);
    const update = { orgId: org, actorId: "translator", kind: "skill" as const, entityId, authorize, body: { expectedSourceRevision: input.body.sourceRevision, locale: "zh-CN" as const } };
    const result = await repository.setSourceLocale(update);
    expect(result.kind).toBe("ok");
    expect((await repository.get(request()))?.source.locale).toBe("zh-CN");
    expect((await repository.setSourceLocale(update)).kind).toBe("source-changed");
    expect((await repository.displays(org, "skill", [entityId], "en")).get(entityId)?.fields.name.value).toBe("探索");
  });
  it("does not treat an org admin as a cross-team superuser", async () => {
    const input = await initialWrite();
    await asApp(org, c => c.query(`INSERT INTO capability_listings(id,org_id,kind,name,scope,owner_team_id,enabled,endpoint)
      VALUES($1,$2,'skill','Private translation source','team-only',$3,true,NULL)`, [entityId, org, ownerTeamId]));
    expect(await repository.get(request())).toBeNull();
    expect((await repository.put(input)).kind).toBe("not-found");
  });
  it("keeps database locale constraints aligned with the shared contract", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      await asApp(org, c => c.query(`INSERT INTO skill_localizations(org_id,skill_id,locale,source_revision,translation_revision,status,updated_by)
        VALUES ($1,$2,$3,'contract-locale',1,'draft','translator')`, [org, entityId, locale]));
    }
    await expect(asApp(org, c => c.query(`INSERT INTO skill_localizations(org_id,skill_id,locale,source_revision,translation_revision,status,updated_by)
      VALUES ($1,$2,'en-US','contract-locale',1,'draft','translator')`, [org, entityId]))).rejects.toMatchObject({ code: "23514" });
  });
  it("cascades localizations when their organization is removed", async () => {
    await repository.put(await initialWrite());
    await resetOrgs(org);
    await asOwner(async c => expect((await c.query("SELECT * FROM skill_localizations WHERE org_id=$1", [org])).rows).toEqual([]));
  });
});
