/** Dedicated isolated database only; this file is excluded from shared platform fixtures. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, resetOrgs, asOwner, seedOrg } from "../tests/support/db";
import { ensurePlatformOrgSeeded } from "../src/infrastructure/skill/ensure-platform-skill-catalog";
import { appConfig, migrationConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase, pgHealthProbe } from "../src/infrastructure/db/pg-database";
import { toOrgId } from "../src/domain/org-id";
import { ACTOR, sha, canonical, stateDigest, verifyInputs, synchronize, readback, type ReleaseRequest, type VerifiedInputs } from "./platform-content-release-core";
import { PgSkillStarterImportRepository } from "../src/infrastructure/skill/pg-skill-starter-import-repository";
import { verifySkillStarterPack, importPayloadDigest } from "../src/domain/skill/starter-pack";
import { buildOfficialAgentRolePack } from "../src/domain/agent/official-role-packs";
import { PgOfficialAgentRolePackImportRepository } from "../src/infrastructure/agent/pg-official-agent-role-pack-import-repository";
import { wave2Runtime } from "@repo/contracts";
import { readFileSync } from "node:fs";
import { checkWorkSkillManifests } from "../src/domain/skill/work-skill-import-check";

import { schemaReadback } from "./platform-schema-readback-core";
import { migrationFiles, MIGRATIONS_DIR } from "../src/infrastructure/db/migrator";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ORG = toOrgId("org-platform"), TENANT = "org-content-release-protected";
let db: PgDatabase;
function makePack(id: string, stableName: string, text = "# Release fixture\n") {
  const body = Buffer.from(text);
  const unsigned = wave2Runtime.UnsignedSkillStarterPack.parse({ schemaVersion: 1, packId: id, packVersion: "1.0.0", skills: [{ stableName, name: stableName,
    semanticVersion: "1.0.0", manifest: { description: "isolated release fixture", entrypoint: "SKILL.md" },
    files: [{ path: "SKILL.md", digest: sha(body), contentBase64: body.toString("base64"), mediaType: "text/markdown" }] }] });
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
  it("runs isolated schema/content/independent readback and actual application-role tenant denial", async () => {
    const startedAt = new Date().toISOString();
    await seedOrg({ orgId: TENANT, projectId: "project-content-protected" });
    const expected = migrationFiles().map(name => ({ name, checksum: sha(readFileSync(join(MIGRATIONS_DIR, name))) }));
    const schema = await schemaReadback(db, migrationConfig().database, expected);
    const target = await input();
    const applied = await synchronize(db, target);
    const independentlyRead = await db.withTenant(ORG, async s => { await s.query("SET TRANSACTION READ ONLY"); return readback(db, s, target); });
    expect(independentlyRead).toMatchObject({ skillVersions: applied.skillVersions, contentReadbackPassed: true });
    const application = new PgDatabase(appConfig());
    let protectedRows = 0;
    try {
      const own = await application.withTenant(toOrgId(TENANT), s => s.query("SELECT id FROM projects WHERE id=$1", ["project-content-protected"]));
      expect(own.rows).toHaveLength(1);
      const foreign = await application.withTenant(ORG, s => s.query("SELECT id FROM projects WHERE id=$1", ["project-content-protected"]));
      protectedRows = foreign.rows.length; expect(protectedRows).toBe(0);
      const health = pgHealthProbe(application);
      expect(await health.allRlsForced()).toBe(true); expect(await health.currentRoleOwnsTables()).toBe(false);
    } finally { await application.close(); }
    const receipt = { kind: "cn-mvp-isolated-postgresql-flow-v1", startedAt, completedAt: new Date().toISOString(),
      actualDatabaseIsolated: migrationConfig().database.startsWith("wsx_"), requestSha256: target.requestSha256,
      stages: { schema, content: applied, independentReadback: independentlyRead, tenantProtection: { foreignProjectRows: protectedRows, actualApplicationRole: true } },
      cloudProviderExecuted: false, productionExecuted: false, modelQuality: "SKIPPED", fullBusinessAcceptance: false };
    console.log("CN_MVP_ISOLATED_PG_RECEIPT=" + JSON.stringify(receipt));
    const output = process.env.WORKSPACEX_MVP_RECEIPT_DIRECTORY;
    if (output) { mkdirSync(output, { recursive: true, mode: 0o700 }); writeFileSync(join(output, "isolated-postgresql-flow.json"), JSON.stringify(receipt), { flag: "wx", mode: 0o600 }); }
  });
  it("reads the actual migration ledger without mutation and rejects checksum drift", async () => {
    const expected = await db.withoutTenant(async s => (await s.query<{name:string;checksum:string}>("SELECT name,checksum FROM _kernel_migrations ORDER BY name")).rows);
    const before = sha(canonical(expected));
    expect(await schemaReadback(db, migrationConfig().database, expected)).toMatchObject({schemaReadbackPassed:true,productionWrites:false,schemaLedgerSha256:before});
    await expect(schemaReadback(db,migrationConfig().database,expected.map((row,i)=>i===0?{...row,checksum:"0".repeat(64)}:row))).rejects.toThrow("SCHEMA_LEDGER_READBACK");
    await expect(schemaReadback(db,"wrong_database",expected)).rejects.toThrow("SCHEMA_DATABASE");
    const after = await db.withoutTenant(async s => (await s.query("SELECT name,checksum FROM _kernel_migrations ORDER BY name")).rows);
    expect(sha(canonical(after))).toBe(before);
  });
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
  it("upgrades recognized legacy role without forging old history and preserves its frozen version", async () => {
    const pack = buildOfficialAgentRolePack();
    const old = wave2Runtime.UnsignedOfficialAgentStarterPack.parse({ schemaVersion: 1 as const, packId: pack.packId, packVersion: "1.6.0",
      agents: pack.agents.filter(x => x.roleRef === "D002").map(x => ({ ...x, semanticVersion: "1.6.0" })) });
    const legacy = { ...old, packDigest: sha(JSON.stringify(old)) };
    const created = await new PgOfficialAgentRolePackImportRepository(db).persistVerified({ orgId: ORG, actorId: ACTOR,
      idempotencyKey: "actual-test-legacy", payloadDigest: sha(JSON.stringify(old)), pack: legacy });
    expect(created.kind).toBe("created");
    const target = await input(); target.request.officialRolePackDigest = pack.packDigest;
    target.requestSha256 = sha(JSON.stringify(target.request));
    const receipt = await synchronize(db, target);
    expect(receipt.roleVersions).toBe(7);
    expect(receipt.pendingBindings).toBeGreaterThan(0);
    const versions = await db.withTenant(ORG, s => s.query<{ semantic_label: string }>(
      "SELECT semantic_label FROM agent_versions WHERE org_id=$1", [ORG]));
    expect(versions.rows.filter(x => x.semantic_label === "1.6.0")).toHaveLength(1);
    expect(versions.rows.filter(x => x.semantic_label === pack.packVersion)).toHaveLength(7);
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
  it("does not publish a customized official instruction draft", async () => {
    const pack = buildOfficialAgentRolePack();
    await new PgOfficialAgentRolePackImportRepository(db).persistVerified({ orgId: ORG, actorId: ACTOR,
      idempotencyKey: "current-role-fixture", payloadDigest: sha(JSON.stringify(pack)), pack });
    await asOwner(c => c.query("UPDATE agents SET instructions='user-authored custom draft' WHERE org_id=$1", [ORG]));
    const target = await input(); target.request.officialRolePackDigest = pack.packDigest;
    target.requestSha256 = sha(JSON.stringify(target.request));
    const before = await db.withTenant(ORG, stateDigest);
    await expect(synchronize(db, target)).rejects.toThrow("ROLE_DRAFT_RUNTIME_CHANGED");
    expect(await db.withTenant(ORG, stateDigest)).toBe(before);
  });
  it("rejects a same-version role whose frozen pending bindings became stale", async () => {
    const pack = buildOfficialAgentRolePack();
    await new PgOfficialAgentRolePackImportRepository(db).persistVerified({ orgId: ORG, actorId: ACTOR,
      idempotencyKey: "current-role-fixture", payloadDigest: sha(JSON.stringify(pack)), pack });
    const raw = JSON.parse(readFileSync(new URL("../../../skills/starter-packs/work-executive/1.0.0.json", import.meta.url), "utf8"));
    const skillPack = verifySkillStarterPack(raw, { packId: "work-executive", packVersion: "1.0.0" });
    const work = checkWorkSkillManifests(skillPack); expect(work.kind).not.toBe("rejected");
    if (work.kind === "rejected") throw new Error("invalid shipped fixture");
    await new PgSkillStarterImportRepository(db).persistVerified({ orgId: ORG, actorId: ACTOR, pack: skillPack,
      idempotencyKey: "after-role-skill-import", payloadDigest: importPayloadDigest(skillPack), workManifests: work.manifests });
    const target = await input(); target.request.officialRolePackDigest = pack.packDigest;
    target.requestSha256 = sha(JSON.stringify(target.request));
    const before = await db.withTenant(ORG, stateDigest);
    await expect(synchronize(db, target)).rejects.toThrow("ROLE_BINDINGS_NOT_ALIGNED");
    expect(await db.withTenant(ORG, stateDigest)).toBe(before);
  });
});
