import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { operations } from "@repo/contracts/portable-package";
import { ensureDatabase, migrateOnce, seedOrg, addOrgMember, asOwner } from "../support/db";
import { skillV2, agentV2, officialV2, sha } from "./portable-pack-fixture";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
let app: NestExpressApplication, base: string;
const org = `portable-http-${randomUUID()}`, admin = `${org}-admin`, member = `${org}-member`;
const headers = (user = admin) => ({ "x-kernel-test-principal": `${user}:${org}`, "content-type": "application/json" });
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  const fixture = await seedOrg({ orgId: org, projectId: `${org}-project` });
  await addOrgMember(org, admin, "admin", fixture.teams.energy!);
  await addOrgMember(org, member, "consultant", fixture.teams.energy!);
  const { createApp } = await import("../../src/main");
  app = await createApp(); await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => { await app?.close(); });
describe("real portable-package HTTP surface", () => {
  for (const [kind, build, path] of [["skill", skillV2, operations.importSkill.path], ["agent", agentV2, operations.importAgent.path]] as const) {
    it(`${kind}: imports and exports copy, rejects members, wrong tenant, replay tampering and changed payload`, async () => {
      const pack = build(), idempotencyKey = randomUUID();
      const request = (body: unknown, user = admin) => fetch(`${base}${path}`, { method: "POST", headers: headers(user), body: JSON.stringify(body) });
      expect((await request({ pack, idempotencyKey }, member)).status).toBe(403);
      expect((await request({ pack, idempotencyKey, expectedOrgId: "wrong-org" })).status).toBe(403);
      const first = await request({ pack, idempotencyKey });
      expect(first.status).toBe(201);
      const imported = kind === "skill" ? operations.importSkill.out.parse(await first.json()) : operations.importAgent.out.parse(await first.json());
      const id = "skillIds" in imported ? imported.skillIds[0]! : imported.agentIds[0]!;
      const exportPath = (kind === "skill" ? operations.exportSkill.path : operations.exportAgent.path).replace(":entityId", encodeURIComponent(id));
      expect((await fetch(`${base}${exportPath}`, { headers: headers(member) })).status).toBe(403);
      const exported = await fetch(`${base}${exportPath}`, { headers: headers() });
      expect(exported.status).toBe(200);
      const raw = await exported.json();
      if (kind === "skill") expect(operations.exportSkill.out.parse(raw).skills[0]!.localization.translations.en?.name).toBe("Translated name");
      else expect(operations.exportAgent.out.parse(raw).agents[0]!.localization.translations.en?.name).toBe("Translated name");
      const changed = structuredClone(pack);
      if ("skills" in changed) changed.skills[0]!.localization.translations.en!.name = "Different copy";
      else changed.agents[0]!.localization.translations.en!.name = "Different copy";
      expect((await request({ pack: changed, idempotencyKey })).status).toBe(422);
      const { packDigest: _old, ...unsigned } = changed;
      changed.packDigest = sha(JSON.stringify(unsigned));
      expect((await request({ pack: changed, idempotencyKey })).status).toBe(409);
      const replay = await request({ pack, idempotencyKey });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(imported);
    });
  }
  it("installs all current bilingual Work packages together and publishes the matching official role definitions", async () => {
    const freshOrg = `bilingual-${randomUUID()}`, freshAdmin = `${freshOrg}-admin`;
    await seedOrg({ orgId: freshOrg, projectId: `${freshOrg}-project` });
    await addOrgMember(freshOrg,freshAdmin,"admin",null);
    const freshHeaders = { "x-kernel-test-principal": `${freshAdmin}:${freshOrg}`,"content-type": "application/json" };
    const { AUTHORED_DISPLAY_METADATA: metadata } = await import("../../src/domain/localization/authored-display-metadata");
    for (const packId of Object.keys(metadata.packages)) {
      const response = await fetch(`${base}/admin/skills/starter-pack-imports`,{ method: "POST",headers: freshHeaders,
        body: JSON.stringify({ packId,packVersion: metadata.metadataVersion,idempotencyKey: randomUUID() }) });
      expect(response.status,`${packId}: ${await response.clone().text()}`).toBe(201);
    }
    const imported = await fetch(`${base}/admin/agents/starter-pack-imports`,{ method: "POST",headers: freshHeaders,
      body: JSON.stringify({ packId: "official-digitalhuman-roles",packVersion: metadata.metadataVersion,idempotencyKey: randomUUID() }) });
    expect(imported.status,await imported.clone().text()).toBe(201);
    const originals = await import("../../src/domain/agent/official-role-packs");
    await asOwner(async c => {
      const rows = (await c.query("SELECT a.stable_name,a.name,a.source_locale,v.instructions,v.instruction_digest,v.skill_version_ids,v.pending_skill_bindings FROM agents a JOIN agent_versions v ON v.org_id=a.org_id AND v.id=a.published_version_id WHERE a.org_id=$1",[freshOrg])).rows;
      expect(rows).toHaveLength(7);
      const skills = (await c.query("SELECT id,manifest->'work'->>'stableId' AS stable_id FROM skill_versions WHERE org_id=$1",[freshOrg])).rows;
      const byVersion = new Map(skills.map(row => [row.id,row.stable_id]));
      for (const entry of originals.buildOfficialAgentRolePack().agents) {
        const row = rows.find(row => row.stable_name === entry.stableName)!;
        expect(row).toMatchObject({ name: entry.name,source_locale: "zh-CN",instructions: entry.instructions,instruction_digest: entry.instructionDigest });
        const actual = [...row.skill_version_ids.map((id: string) => byVersion.get(id)),...row.pending_skill_bindings.map((binding: { stableId: string }) => binding.stableId)];
        expect(new Set(actual).size).toBe(actual.length);
        expect(actual.sort()).toEqual(entry.authoredSkillBindings!.map(binding => binding.stableId).sort());
      }
    });
    const catalog = await fetch(`${base}/skills/catalog?locale=en&q=Enterprise%20Search&limit=1`,{ headers: freshHeaders });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({ items: [{ name: "S003",display: { fields: { name: { value: "Enterprise Search",fallback: false } } } }] });
  });
  it("cannot turn an untrusted JSON package into official catalog provenance", async () => {
    const response = await fetch(`${base}${operations.importAgent.path}`, { method: "POST", headers: headers(), body: JSON.stringify({ idempotencyKey: randomUUID(), pack: officialV2() }) });
    expect(response.status).toBe(422);
  });
  it("offers installed Work titles to admins and updates both member locales without rewriting execution", async () => {
    const imported = await fetch(`${base}/admin/skills/starter-pack-imports`, { method: "POST",headers: headers(),
      body: JSON.stringify({ packId: "work-research",packVersion: "1.0.0",idempotencyKey: randomUUID() }) });
    expect(imported.status).toBe(201);
    expect((await fetch(`${base}${operations.displayUpdateOffer.path}`,{ headers: headers(member) })).status).toBe(403);
    const offered = await fetch(`${base}${operations.displayUpdateOffer.path}`,{ headers: headers() });
    expect(offered.status).toBe(200);
    const offer = operations.displayUpdateOffer.out.parse(await offered.json()); expect(offer.available).toBe(true);
    const body = { expectedOrgId: org,expectedMetadataVersion: offer.metadataVersion,idempotencyKey: randomUUID() };
    const update = (data: unknown,user = admin) => fetch(`${base}${operations.applyDisplayUpdate.path}`,{ method: "POST",headers: headers(user),body: JSON.stringify(data) });
    expect((await update(body,member)).status).toBe(403);
    expect((await update({ ...body,expectedOrgId: "other-org" })).status).toBe(403);
    expect((await update({ ...body,expectedMetadataVersion: "obsolete" })).status).toBe(409);
    const snapshot = () => asOwner(c => c.query("SELECT v.id,v.content_digest,f.path,f.digest,f.content FROM skill_versions v JOIN skill_version_files f ON f.version_id=v.id AND f.org_id=v.org_id WHERE v.org_id=$1 ORDER BY v.id,f.path",[org]));
    const before = await snapshot(), applied = await update(body); expect(applied.status).toBe(200);
    expect(operations.applyDisplayUpdate.out.parse(await applied.json()).updatedEntities).toBeGreaterThan(0);
    const replay = await update(body); expect(replay.status).toBe(200);
    expect(operations.applyDisplayUpdate.out.parse(await replay.json()).replayed).toBe(true);
    for (const [locale,title] of [["en","Enterprise Search"],["zh-CN","企业内部检索"]]) {
      const found = await fetch(`${base}/skills/catalog?locale=${locale}&q=${encodeURIComponent(title!)}&limit=1`,{ headers: headers(member) });
      expect(found.status).toBe(200);
      expect(await found.json()).toMatchObject({ items: [{ name: "S003",display: { fields: { name: { value: title,fallback: false } } } }] });
    }
    expect((await snapshot()).rows).toEqual(before.rows);
    const refreshed = operations.displayUpdateOffer.out.parse(await (await fetch(`${base}${operations.displayUpdateOffer.path}`,{ headers: headers() })).json());
    expect(refreshed.available).toBe(false);
  });
});
