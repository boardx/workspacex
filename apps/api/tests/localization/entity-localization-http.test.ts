import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { EntityLocalizationAdminView } from "@repo/contracts/entity-localization";
import { ensureDatabase, migrateOnce, seedOrg, addOrgMember, asOwner } from "../support/db";
import { writeWorkPack, importWorkPack, RESEARCH, MEETING } from "../work-skill/support/catalog-fixture";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
let app: NestExpressApplication;
let base: string;
let root: string;
let skillId: string;
let otherSkillId: string;
let otherTeamId: string;
const org = `loc-http-${randomUUID()}`;
const admin = `${org}-admin`;
const member = `${org}-member`;
const pack = `loc-pack-${randomUUID()}`;
const previousRoot = process.env.SKILL_STARTER_PACK_ROOT;
const headers = (user = admin) => ({ "x-kernel-test-principal": `${user}:${org}`, "content-type": "application/json" });
const path = () => `/admin/skills/${skillId}/localizations/en`;
async function adminView() {
  const response = await fetch(`${base}${path()}`, { headers: headers() });
  expect(response.status).toBe(200);
  return EntityLocalizationAdminView.parse(await response.json());
}
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "entity-localization-http-"));
  process.env.SKILL_STARTER_PACK_ROOT = root;
  writeWorkPack(root, pack, "1.0.0", [RESEARCH, MEETING]);
  ensureDatabase(); await migrateOnce();
  const fixture = await seedOrg({ orgId: org, projectId: `${org}-project` });
  otherTeamId = fixture.teams.platform!;
  await addOrgMember(org, admin, "admin", fixture.teams.energy!);
  await addOrgMember(org, member, "consultant", fixture.teams.energy!);
  const { createApp } = await import("../../src/main");
  app = await createApp(); await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const imported = await importWorkPack(base, `${admin}:${org}`, pack, "1.0.0");
  skillId = imported.skillIds[0]!; otherSkillId = imported.skillIds[1]!;
});
afterAll(async () => {
  await app?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.SKILL_STARTER_PACK_ROOT;
  else process.env.SKILL_STARTER_PACK_ROOT = previousRoot;
});
describe("real HTTP translation authoring and localized catalog", () => {
  it("does not give a member translation administration, and validates the locale", async () => {
    expect((await fetch(`${base}${path()}`, { headers: headers(member) })).status).toBe(403);
    expect((await fetch(`${base}${path().replace(/en$/, "en-US")}`, { headers: headers() })).status).toBe(422);
  });
  it("stores translated copy, searches before pagination, and leaves execution file bytes intact", async () => {
    const before = await asOwner(async c => (await c.query("SELECT path,digest,content FROM skill_version_files f JOIN skill_versions v ON v.id=f.version_id WHERE v.skill_id=$1 ORDER BY path", [skillId])).rows);
    const current = await adminView();
    const input = { sourceRevision: current.source.revision, expectedTranslationRevision: current.translation?.revision ?? null,
      status: "reviewed", fields: { name: "独有译名无源匹配", summary: "Localized summary" } };
    const response = await fetch(`${base}${path()}`, { method: "PUT", headers: headers(), body: JSON.stringify(input) });
    expect(response.status).toBe(200);
    const catalog = await fetch(`${base}/skills/catalog?locale=en&q=${encodeURIComponent("独有译名")}&limit=1`, { headers: headers(member) });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({ items: [{ skillId, name: RESEARCH.name, display: { fields: { name: { value: "独有译名无源匹配", fallback: false } } } }], nextCursor: null });
    const detail = await fetch(`${base}/skills/catalog/${skillId}?locale=en`, { headers: headers(member) });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ skillId, name: RESEARCH.name, description: RESEARCH.description, display: { fields: { summary: { value: "Localized summary" } } } });
    const after = await asOwner(async c => (await c.query("SELECT path,digest,content FROM skill_version_files f JOIN skill_versions v ON v.id=f.version_id WHERE v.skill_id=$1 ORDER BY path", [skillId])).rows);
    expect(after).toEqual(before);
    const legacy = await fetch(`${base}/skills/catalog?q=${encodeURIComponent("独有译名")}`, { headers: headers(member) });
    expect(await legacy.json()).toMatchObject({ items: [] });
    const unrelated = await fetch(`${base}/skills/catalog/${otherSkillId}?locale=en`, { headers: headers(member) });
    expect(await unrelated.json()).toMatchObject({ name: MEETING.name, display: { fields: { name: { value: MEETING.name, fallback: true } } } });
  });
  it("rejects stale CAS and executable fields, and clears only translated display copy", async () => {
    const current = await adminView();
    const input = { sourceRevision: current.source.revision, expectedTranslationRevision: current.translation?.revision ?? null, status: "reviewed", fields: { name: "Temporary translation" } };
    expect((await fetch(`${base}${path()}`, { method: "PUT", headers: headers(), body: JSON.stringify({ ...input, instructions: "rewrite" }) })).status).toBe(422);
    expect((await fetch(`${base}${path()}`, { method: "PUT", headers: headers(), body: JSON.stringify(input) })).status).toBe(200);
    expect((await fetch(`${base}${path()}`, { method: "PUT", headers: headers(), body: JSON.stringify(input) })).status).toBe(409);
    const saved = await adminView();
    expect((await fetch(`${base}${path()}`, { method: "DELETE", headers: headers(), body: JSON.stringify({ sourceRevision: saved.source.revision, expectedTranslationRevision: saved.translation!.revision }) })).status).toBe(200);
    const detail = await fetch(`${base}/skills/catalog/${skillId}?locale=en`, { headers: headers(member) });
    expect(await detail.json()).toMatchObject({ name: RESEARCH.name, display: { fields: { name: { value: RESEARCH.name, fallback: true } } } });
  });
  it("does not let an admin author translations outside their team scope", async () => {
    const target = `/admin/skills/${otherSkillId}/localizations/en`;
    const current = EntityLocalizationAdminView.parse(await (await fetch(`${base}${target}`, { headers: headers() })).json());
    await asOwner(c => c.query("UPDATE capability_listings SET scope='team-only',owner_team_id=$2 WHERE id=$1", [otherSkillId, otherTeamId]));
    try {
      expect((await fetch(`${base}${target}`, { headers: headers() })).status).toBe(404);
      expect((await fetch(`${base}${target}`, { method: "PUT", headers: headers(), body: JSON.stringify({ sourceRevision: current.source.revision, expectedTranslationRevision: null, status: "reviewed", fields: { name: "Forbidden translation" } }) })).status).toBe(404);
    } finally {
      await asOwner(c => c.query("UPDATE capability_listings SET scope='org-wide',owner_team_id=NULL WHERE id=$1", [otherSkillId]));
    }
  });
});
