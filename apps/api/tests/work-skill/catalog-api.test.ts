/**
 * WS03（Phase 20，R3.5–R3.7 / R3.10 / A2 A3 / E7 / R5）：Work Skill 目录列表、搜索、分页与详情。
 *
 * 真实 HTTP + 真实 PostgreSQL；目录行由真实 starter-pack 导入（WS02 路径）产生，不手插。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { CONTRACT, importWorkPack, MEETING, RESEARCH, writeWorkPack } from "./support/catalog-fixture";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ws03-api";
const OTHER_ORG = "org-ws03-api-other";
const ADMIN = "u-ws03-api-admin";
const MEMBER = "u-ws03-api-member";
const OUTSIDER = "u-ws03-api-outsider";
const PACK = "ws03-api-pack";

let app: NestExpressApplication;
let base = "";
let packRoot = "";
let ids: { research: string; meeting: string; contract: string; researchV1: string } = { research: "", meeting: "", contract: "", researchV1: "" };

const as = (user: string, org: string) => ({ "x-kernel-test-principal": `${user}:${org}` });

async function getJson(path: string, user = MEMBER, org = ORG) {
  const response = await fetch(`${base}${path}`, { headers: as(user, org) });
  return { status: response.status, body: await response.json() as any };
}

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "ws03-api-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = packRoot;
  writeWorkPack(packRoot, PACK, "1.0.0", [RESEARCH, MEETING, CONTRACT]);
  writeWorkPack(packRoot, PACK, "1.1.0", [{ ...RESEARCH, semanticVersion: "1.1.0", domain: "Research" }, MEETING, CONTRACT]);
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  rmSync(packRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  const other = await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-project` });
  await addOrgMember(OTHER_ORG, OUTSIDER, "admin", other.teams.energy!);
  const imported = await importWorkPack(base, `${ADMIN}:${ORG}`, PACK, "1.0.0");
  ids = { research: imported.skillIds[0]!, meeting: imported.skillIds[1]!, contract: imported.skillIds[2]!, researchV1: imported.versionIds[0]! };
});

describe("WS03 GET /skills/catalog", () => {
  it("lists the org's work skills ordered by stableId with the contract item shape", async () => {
    const { status, body } = await getJson("/skills/catalog");
    expect(status).toBe(200);
    expect(body.items.map((i: any) => i.stableId)).toEqual(["S003", "S004", "S005"]);
    expect(body.nextCursor).toBeNull();
    expect(body.items[0]).toEqual({
      skillId: ids.research, name: "Research brief", stableId: "S003", domain: "Shared", channel: "candidate",
      riskClass: "low", currentVersionId: ids.researchV1, currentVersionLabel: "1.0.0",
      readiness: { overall: "unknown", missingRequired: null }, successorSkillId: null,
    });
    expect(body.items[2]).toMatchObject({ stableId: "S005", riskClass: "high" });
  });

  it("filters by domain and channel", async () => {
    expect((await getJson("/skills/catalog?domain=Shared")).body.items.map((i: any) => i.stableId)).toEqual(["S003"]);
    await asOwner((c) => c.query("UPDATE skill_catalog_entries SET channel='verified' WHERE org_id=$1 AND stable_id='S004'", [ORG]));
    expect((await getJson("/skills/catalog?channel=verified")).body.items.map((i: any) => i.stableId)).toEqual(["S004"]);
    expect((await getJson("/skills/catalog?channel=candidate")).body.items.map((i: any) => i.stableId)).toEqual(["S003", "S005"]);
  });

  it("searches name / stableId / domain / description (incl. Chinese substring) and returns empty for no match (E7)", async () => {
    expect((await getJson("/skills/catalog?q=search")).body.items.map((i: any) => i.stableId)).toEqual(["S003"]);
    expect((await getJson("/skills/catalog?q=S004")).body.items[0].stableId).toBe("S004");
    expect((await getJson("/skills/catalog?q=legal")).body.items.map((i: any) => i.stableId)).toEqual(["S005"]);
    expect((await getJson(`/skills/catalog?q=${encodeURIComponent("调研")}`)).body.items.map((i: any) => i.stableId)).toEqual(["S003"]);
    const none = await getJson("/skills/catalog?q=zzzz-nothing");
    expect(none.status).toBe(200);
    expect(none.body.items).toEqual([]);
    expect((await getJson("/skills/catalog?q=100%25")).body.items).toEqual([]);
  });

  it("paginates with an opaque cursor", async () => {
    const first = await getJson("/skills/catalog?limit=2");
    expect(first.body.items.map((i: any) => i.stableId)).toEqual(["S003", "S004"]);
    expect(typeof first.body.nextCursor).toBe("string");
    const second = await getJson(`/skills/catalog?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((i: any) => i.stableId)).toEqual(["S005"]);
    expect(second.body.nextCursor).toBeNull();
    expect((await getJson("/skills/catalog?cursor=not-a-cursor")).status).toBe(422);
    expect((await getJson("/skills/catalog?limit=0")).status).toBe(422);
    expect((await getJson("/skills/catalog?channel=bogus")).body.code).toBe("VALIDATION_FAILED");
  });

  it("hides deprecated entries by default and shows them with includeDeprecated or channel=deprecated (A3)", async () => {
    await asOwner((c) => c.query("UPDATE skill_catalog_entries SET channel='deprecated' WHERE org_id=$1 AND stable_id='S005'", [ORG]));
    expect((await getJson("/skills/catalog")).body.items.map((i: any) => i.stableId)).toEqual(["S003", "S004"]);
    const shown = await getJson("/skills/catalog?includeDeprecated=true");
    expect(shown.body.items.map((i: any) => [i.stableId, i.channel])).toEqual([["S003", "candidate"], ["S004", "candidate"], ["S005", "deprecated"]]);
    expect((await getJson("/skills/catalog?channel=deprecated")).body.items.map((i: any) => i.stableId)).toEqual(["S005"]);
  });

  it("is tenant-scoped: another org sees none of these rows; unauthenticated → 401", async () => {
    const other = await getJson("/skills/catalog", OUTSIDER, OTHER_ORG);
    expect(other.status).toBe(200);
    expect(other.body.items).toEqual([]);
    expect((await fetch(`${base}/skills/catalog`)).status).toBe(401);
  });
});

describe("WS03 GET /skills/catalog/:skillId", () => {
  it("returns manifest detail, gate placeholders, versions and canManageChannel by role", async () => {
    const { status, body } = await getJson(`/skills/catalog/${ids.research}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      skillId: ids.research, stableId: "S003", channel: "candidate", canManageChannel: false,
      description: RESEARCH.description, successor: null,
      manifest: {
        stableId: "S003", domain: "Shared",
        dependencies: { required: ["knowledge.search"], optional: ["web.fetch"] },
        provenance: [{ commit: "a".repeat(40), license: "Apache-2.0" }],
        locales: ["zh-CN", "en"], jurisdictions: ["CN"], evalSuiteId: "E003",
        inputSchema: { type: "object" }, outputSchema: { type: "object" },
      },
      versions: [{ skillVersionId: ids.researchV1, semanticLabel: "1.0.0", current: true }],
    });
    expect(body.gates.map((g: any) => g.gate)).toEqual(["G0", "G1", "G2", "G3", "G4", "G5", "G6"]);
    expect(body.gates.every((g: any) => g.state === "not_run")).toBe(true);
    expect(body.manifest).not.toHaveProperty("channel");
    expect((await getJson(`/skills/catalog/${ids.research}`, ADMIN)).body.canManageChannel).toBe(true);
  });

  it("after a new version, detail follows the current version and ?versionId= reads the old manifest (A2)", async () => {
    await importWorkPack(base, `${ADMIN}:${ORG}`, PACK, "1.1.0");
    const current = await getJson(`/skills/catalog/${ids.research}`);
    expect(current.body.currentVersionLabel).toBe("1.1.0");
    expect(current.body.manifest.domain).toBe("Research");
    expect(current.body.versions.map((v: any) => [v.semanticLabel, v.current])).toEqual([["1.1.0", true], ["1.0.0", false]]);
    const old = await getJson(`/skills/catalog/${ids.research}?versionId=${ids.researchV1}`);
    expect(old.status).toBe(200);
    expect(old.body.manifest.domain).toBe("Shared");
    expect((await getJson(`/skills/catalog/${ids.research}?versionId=${ids.meeting}`)).status).toBe(404);
  });

  it("shows the successor link on a deprecated entry (R3.10)", async () => {
    await asOwner((c) => c.query(
      "UPDATE skill_catalog_entries SET channel='deprecated', successor_skill_id=$2 WHERE org_id=$1 AND skill_id=$3",
      [ORG, ids.research, ids.contract]));
    const { body } = await getJson(`/skills/catalog/${ids.contract}`);
    expect(body.successor).toEqual({ skillId: ids.research, name: "Research brief", stableId: "S003" });
  });

  it("cross-org and unknown ids are an indistinguishable 404; unauthenticated → 401", async () => {
    const cross = await getJson(`/skills/catalog/${ids.research}`, OUTSIDER, OTHER_ORG);
    const missing = await getJson("/skills/catalog/skill-does-not-exist");
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(cross.body.code).toBe("WORK_SKILL_NOT_FOUND");
    expect(missing.body.code).toBe("WORK_SKILL_NOT_FOUND");
    expect((await fetch(`${base}/skills/catalog/${ids.research}`)).status).toBe(401);
  });
});
