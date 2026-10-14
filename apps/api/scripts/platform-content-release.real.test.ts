/** Dedicated isolated database only; this file is excluded from shared platform fixtures. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, resetOrgs, asOwner, seedOrg } from "../tests/support/db";
import { ensurePlatformOrgSeeded } from "../src/infrastructure/skill/ensure-platform-skill-catalog";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { toOrgId } from "../src/domain/org-id";
import { ACTOR, sha, stateDigest, verifyInputs, synchronize, type ReleaseRequest, type VerifiedInputs } from "./platform-content-release-core";
import { PgSkillStarterImportRepository } from "../src/infrastructure/skill/pg-skill-starter-import-repository";
import { verifySkillStarterPack, importPayloadDigest } from "../src/domain/skill/starter-pack";

const ORG = toOrgId("org-platform"), TENANT = "org-content-release-protected";
let db: PgDatabase;
function makePack(id: string, stableName: string, text = "# Release fixture\n") {
  const body = Buffer.from(text);
  const unsigned = { schemaVersion: 1, packId: id, packVersion: "1.0.0", skills: [{ stableName, name: stableName,
    semanticVersion: "1.0.0", manifest: { description: "isolated release fixture", entrypoint: "SKILL.md" },
    files: [{ path: "SKILL.md", digest: sha(body), contentBase64: body.toString("base64"), mediaType: "text/markdown" }] }] };
  return { ...unsigned, packDigest: sha(JSON.stringify(unsigned)) };
}
async function input(packs = [makePack("release-fixture", "release-fixture")]): Promise<VerifiedInputs> {
  const bytes = packs.map(x => Buffer.from(JSON.stringify(x)));
  const request: ReleaseRequest = { schemaVersion: 1, releaseId: "isolated-content-release", sourceRevision: "a".repeat(40),
    targetOrgId: "org-platform", acceptanceScope: "mvp-non-model", expectedDatabase: migrationConfig().database,
    beforeStateSha256: await db.withTenant(ORG, stateDigest), officialRolePackDigest: null, workflows: [],
    skippedTests: ["real-model", "ai-output-quality"], notApplicableContents: ["future-catalog-v2"],
    packRefs: packs.map((p, i) => ({ packId: p.packId, packVersion: p.packVersion, path: `fixture/${i}.json`,
      rawSha256: sha(bytes[i]!), packDigest: p.packDigest })) };
  return verifyInputs(request, sha(JSON.stringify(request)), ref => bytes[Number(ref.path.split("/")[1]!.split(".")[0])]!);
}
beforeAll(async () => {
  // Prevent accidental execution against the production DB even with copied env.
  expect(migrationConfig().database).toMatch(/^wsx_/);
  ensureDatabase(); await migrateOnce(); db = new PgDatabase(migrationConfig());
});
beforeEach(async () => { await resetOrgs([ORG, TENANT]); await ensurePlatformOrgSeeded(); });
afterAll(async () => { await db?.close(); await resetOrgs([ORG, TENANT]); });

describe("actual PostgreSQL content release", () => {
  it("imports exact bytes once, replays without new versions, and writes no fake gates", async () => {
    const target = await input(); const first = await synchronize(db, target); const second = await synchronize(db, target);
    expect(first).toMatchObject({ skillVersions: 1, replayed: false, fullBusinessAcceptance: false, realModel: "SKIPPED" });
    expect(second).toMatchObject({ skillVersions: 1, replayed: true });
    const counts = await db.withTenant(ORG, async s => ({
      versions: (await s.query<{ n: string }>("SELECT count(*)::text AS n FROM skill_versions WHERE org_id=$1", [ORG])).rows[0]!.n,
      gates: (await s.query<{ n: string }>("SELECT count(*)::text AS n FROM skill_gate_records WHERE org_id=$1", [ORG])).rows[0]!.n,
    }));
    expect(counts).toEqual({ versions: "1", gates: "0" });
  });
  it("fails a stale before-state CAS without importing", async () => {
    const target = await input();
    await asOwner(c => c.query("UPDATE organizations SET name='changed outside catalog' WHERE id=$1", [ORG]));
    // A catalog mutation, rather than unrelated organization metadata, invalidates catalog CAS.
    await new PgSkillStarterImportRepository(db).persistVerified({ orgId: ORG, actorId: ACTOR,
      idempotencyKey: "outside-release", payloadDigest: importPayloadDigest({ packId: "outside", packVersion: "1.0.0" }),
      pack: verifySkillStarterPack(makePack("outside", "outside"), { packId: "outside", packVersion: "1.0.0" }) });
    await expect(synchronize(db, target)).rejects.toThrow("CONTENT_BEFORE_STATE_CAS");
    const names = await db.withTenant(ORG, s => s.query<{ stable_name: string }>("SELECT stable_name FROM skills WHERE org_id=$1", [ORG]));
    expect(names.rows.map(x => x.stable_name)).toEqual(["outside"]);
  });
  it("rolls back the entire batch when a later package conflicts; tenant content survives", async () => {
    await seedOrg({ orgId: TENANT, projectId: "project-content-protected" });
    const old = verifySkillStarterPack(makePack("original", "existing", "# old\n"), { packId: "original", packVersion: "1.0.0" });
    await new PgSkillStarterImportRepository(db).persistVerified({ orgId: ORG, actorId: ACTOR,
      idempotencyKey: "original", payloadDigest: importPayloadDigest(old), pack: old });
    await asOwner(c => c.query(`INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES('protected-skill',$1,'existing','Private existing','enabled','private-user',now(),now())`, [TENANT]));
    const target = await input([makePack("first", "new-first"), makePack("conflicting", "existing", "# different\n")]);
    const before = await db.withTenant(ORG, stateDigest);
    await expect(synchronize(db, target)).rejects.toThrow("SKILL_IMPORT_REJECTED");
    expect(await db.withTenant(ORG, stateDigest)).toBe(before);
    const preserved = await asOwner(c => c.query("SELECT name FROM skills WHERE org_id=$1 AND id='protected-skill'", [TENANT]));
    expect(preserved.rows[0]?.name).toBe("Private existing");
  });
});
