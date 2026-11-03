import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDatabase, migrateOnce, seedOrg, asApp } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgSkillStarterImportRepository } from "../../src/infrastructure/skill/pg-skill-starter-import-repository";
import { PgAgentStarterImportRepository } from "../../src/infrastructure/agent/pg-agent-starter-import-repository";
import { PgOfficialAgentRolePackImportRepository } from "../../src/infrastructure/agent/pg-official-agent-role-pack-import-repository";
import { PgEntityLocalizationRepository } from "../../src/infrastructure/localization/pg-entity-localization-repository";
import { decideCapabilityVisibility } from "../../src/domain/identity/capability-listing";
import type { LocalizationVisibilityFacts } from "../../src/application/localization/entity-localization";
import { skillV2, agentV2, officialV1, officialV2, sha, sourceFile } from "./portable-pack-fixture";
let db: PgDatabase;
let org: Awaited<ReturnType<typeof seedOrg>>;
let orgId: string;
const authorize = (facts: LocalizationVisibilityFacts) => decideCapabilityVisibility({ decisionId: "portable-import", orgRole: "admin", requesterTeamId: null, ...facts });
const input = (pack: { packDigest: string }, key: string = randomUUID()) => ({ orgId: orgId as never, actorId: "translator", idempotencyKey: key, payloadDigest: sha(pack.packDigest), localizationAuthorize: authorize, pack });
const localizations = () => new PgEntityLocalizationRepository(db);
const target = (kind: "skill" | "agent", entityId: string) => ({ orgId: orgId as never, actorId: "translator", kind, entityId, locale: "en" as const, authorize });
function next<T extends { packDigest: string; packVersion: string }>(pack: T): T {
  const { packDigest: _digest, ...unsigned } = { ...pack, packVersion: "2.1.0" };
  return { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) } as T;
}
beforeAll(async () => { ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig()); });
afterAll(async () => { await db?.close(); });
beforeEach(async () => { orgId = `portable-${randomUUID()}`; org = await seedOrg({ orgId, projectId: `${orgId}-project` }); });

describe("atomic portable localization imports", () => {
  it("reuses an identical local cross-pack Skill without rebinding its source language", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
    const imports = new PgSkillStarterImportRepository(db), first = await imports.persistVerified(input(skillV2()) as never);
    if (first.kind !== "created") throw Error("fixture import failed");
    const second = skillV2(); second.packId = "shared-second";
    second.skills[0]!.localization.sourceLocale = "en";
    const { packDigest: _digest, ...unsigned } = second; second.packDigest = sha(JSON.stringify(unsigned));
    expect(await imports.persistVerified(input(second) as never)).toMatchObject({ kind: "created", result: { skillIds: first.result.skillIds, versionIds: first.result.versionIds } });
    expect((await localizations().get(target("skill", first.result.skillIds[0]!)))?.source.locale).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("preserves a manual clear tombstone on subsequent metadata refresh", async () => {
    const imports = new PgSkillStarterImportRepository(db), first = await imports.persistVerified(input(skillV2()) as never);
    if (first.kind !== "created") throw Error("fixture import failed");
    const request = target("skill", first.result.skillIds[0]!), view = (await localizations().get(request))!;
    await localizations().clear({ ...request, body: { sourceRevision: view.source.revision, expectedTranslationRevision: view.translation!.revision } });
    expect((await imports.persistVerified(input(next(skillV2("Revived package copy"))) as never)).kind).toBe("created");
    expect((await localizations().get(request))?.translation).toMatchObject({ status: "draft", fields: { name: null } });
  });
  it("imports a translated Skill in the same transaction as unchanged original files", async () => {
    const pack = skillV2();
    const outcome = await new PgSkillStarterImportRepository(db).persistVerified(input(pack) as never);
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw Error("fixture import failed");
    const id = outcome.result.skillIds[0]!;
    expect((await localizations().get(target("skill", id)))?.translation).toMatchObject({ status: "reviewed", fields: { name: "Translated name" } });
    await asApp(orgId, async c => {
      expect((await c.query("SELECT name FROM skills WHERE id=$1", [id])).rows[0].name).toBe(pack.skills[0]!.name);
      expect((await c.query("SELECT content FROM skill_version_files WHERE version_id=$1", [outcome.result.versionIds[0]])).rows[0].content.toString()).toBe(sourceFile);
    });
  });
  it("refreshes only display metadata, preserving manual translations and published IDs", async () => {
    const imports = new PgSkillStarterImportRepository(db), pack = skillV2();
    const first = await imports.persistVerified(input(pack) as never);
    if (first.kind !== "created") throw Error("fixture import failed");
    const request = target("skill", first.result.skillIds[0]!);
    const view = (await localizations().get(request))!;
    await localizations().put({ ...request, body: { sourceRevision: view.source.revision, expectedTranslationRevision: view.translation?.revision ?? null, status: "reviewed", fields: { name: "Manual translation" } } });
    const updated = await imports.persistVerified(input(next(skillV2("New package copy"))) as never);
    expect(updated).toMatchObject({ kind: "created", result: { skillIds: first.result.skillIds, versionIds: first.result.versionIds } });
    expect((await localizations().get(request))?.translation?.fields.name).toBe("Manual translation");
    const replayInput = input(next(skillV2("New package copy")), "repeat");
    await imports.persistVerified(replayInput as never);
    expect((await imports.persistVerified(replayInput as never)).kind).toBe("replayed");
  });
  it("does not reactivate a disabled Skill while refreshing display metadata", async () => {
    const imports = new PgSkillStarterImportRepository(db), first = await imports.persistVerified(input(skillV2()) as never);
    if (first.kind !== "created") throw Error("fixture import failed");
    const id = first.result.skillIds[0]!;
    await asApp(orgId, c => c.query("UPDATE skills SET status='disabled',updated_at=clock_timestamp() WHERE id=$1", [id]));
    expect((await imports.persistVerified(input(next(skillV2("Updated copy"))) as never)).kind).toBe("created");
    await asApp(orgId, async c => expect((await c.query("SELECT status FROM skills WHERE id=$1", [id])).rows[0].status).toBe("disabled"));
  });
  it("rejects changed originals and cross-team refreshes without overwriting anything", async () => {
    const imports = new PgSkillStarterImportRepository(db), first = await imports.persistVerified(input(skillV2()) as never);
    if (first.kind !== "created") throw Error("fixture import failed");
    const id = first.result.skillIds[0]!;
    await asApp(orgId, c => c.query("UPDATE skills SET name='My original',updated_at=clock_timestamp() WHERE id=$1", [id]));
    expect((await imports.persistVerified(input(next(skillV2())) as never)).kind).toBe("name-conflict");
    await asApp(orgId, c => c.query("UPDATE skills SET name=$2 WHERE id=$1", [id, skillV2().skills[0]!.name]));
    await asApp(orgId, c => c.query("UPDATE capability_listings SET scope='team-only',owner_team_id=$2 WHERE id=$1", [id, org.teams.platform]));
    expect((await imports.persistVerified(input(next(skillV2())) as never)).kind).toBe("name-conflict");
  });
  it("rolls back a whole new pack if localization authorization fails after entity creation", async () => {
    const pack = skillV2();
    pack.skills.push({ ...pack.skills[0]!, stableName: "portable-second", name: "Second source" });
    const { packDigest: _digest, ...unsigned } = pack; pack.packDigest = sha(JSON.stringify(unsigned));
    let checks = 0;
    const outcome = await new PgSkillStarterImportRepository(db).persistVerified({ ...input(pack), localizationAuthorize: (facts: LocalizationVisibilityFacts) => {
      checks++; return decideCapabilityVisibility({ decisionId: "portable-atomic", orgRole: checks === 1 ? "admin" : null, requesterTeamId: null, ...facts });
    } } as never);
    expect(outcome.kind).toBe("name-conflict");
    await asApp(orgId, async c => {
      expect((await c.query("SELECT id FROM skills WHERE stable_name=ANY($1::text[])", [["portable-skill", "portable-second"]])).rows).toEqual([]);
      expect((await c.query("SELECT id FROM starter_pack_imports WHERE pack_id=$1", [pack.packId])).rows).toEqual([]);
    });
  });
  it("imports ordinary Agent copy while retaining instruction bytes and frozen source fields", async () => {
    const pack = agentV2();
    const result = await new PgAgentStarterImportRepository(db).persistVerified(input(pack) as never);
    if (result.kind !== "created") throw Error("fixture import failed");
    expect((await localizations().get(target("agent", result.result.agentIds[0]!)))?.translation?.fields.name).toBe("Translated name");
    await asApp(orgId, async c => expect((await c.query("SELECT instructions,instruction_digest FROM agent_versions WHERE id=$1", [result.result.versionIds[0]])).rows[0])
      .toMatchObject({ instructions: pack.agents[0]!.instructions, instruction_digest: pack.agents[0]!.instructionDigest }));
  });
  it("adds metadata to unchanged v1 official roles without replacing their published versions", async () => {
    const imports = new PgOfficialAgentRolePackImportRepository(db);
    const first = await imports.persistVerified(input(officialV1()) as never);
    if (first.kind !== "created") throw Error("fixture import failed");
    const refreshed = await imports.persistVerified(input(officialV2()) as never);
    expect(refreshed).toMatchObject({ kind: "created", result: { agentIds: first.result.agentIds, versionIds: first.result.versionIds } });
    expect((await localizations().get(target("agent", first.result.agentIds[0]!)))?.translation?.fields.name).toBe("Translated name");
  });
});
