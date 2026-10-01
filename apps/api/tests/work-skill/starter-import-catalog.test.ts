/**
 * WS02（Phase 20，UC-2 / R3.3–R3.4 / E1 E2 E6 E8）：starter-pack 导入接入 `metadata.work` 校验，
 * 解析结果写入不可变 `skill_versions.manifest.work`，同事务 upsert `skill_catalog_entries`。
 *
 * 真实 HTTP + 真实 PostgreSQL（RLS 下以 app_rw 读回断言）。每条拒绝用例都先装一个合法包，
 * 断言「行数不变」是对一个非空基线做的——空表上的「不变」证明不了原子性。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ws02-catalog";
const ADMIN = "u-ws02-admin";
const PACK = "ws02-work-pack";

let app: NestExpressApplication;
let base = "";
let packRoot = "";

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

const WORK_BLOCK = (over: { stableId?: string; required?: string; license?: string | null; copiedNotice?: boolean; domain?: string } = {}) => {
  const license = over.license === undefined ? "Apache-2.0" : over.license;
  return [
    "metadata:",
    "  work:",
    `    stableId: ${over.stableId ?? "S003"}`,
    `    domain: ${over.domain ?? "Research"}`,
    "    riskClass: low",
    "    dependencies:",
    `      required: [${over.required ?? "knowledge.search"}]`,
    "      optional: [web.fetch]",
    "    provenance:",
    "      - repo: anthropics/skills",
    "        path: skills/research/SKILL.md",
    `        commit: ${"a".repeat(40)}`,
    ...(license === null ? [] : [`        license: ${license}`]),
    "        strategy: adapt",
    `        copied: ${over.copiedNotice === false ? "true" : "false"}`,
    "    locales: [zh-CN, en]",
    "    jurisdictions: [CN]",
    "    evalSuiteId: E003",
    "    inputSchema: { type: object }",
    "    outputSchema: { type: object }",
  ].join("\n");
};

const skillMd = (name: string, frontmatter: string | null) =>
  `${frontmatter === null ? "" : `---\nname: ${name}\n${frontmatter}\n---\n`}# ${name}\n\nResearch brief with citations.\n`;

interface SkillSpec { readonly stableName: string; readonly name: string; readonly semanticVersion?: string; readonly md: string }

function writePack(packVersion: string, skills: readonly SkillSpec[]): void {
  const built = skills.map((spec) => ({
    stableName: spec.stableName,
    name: spec.name,
    semanticVersion: spec.semanticVersion ?? "1.0.0",
    manifest: { description: `${spec.name} description`, entrypoint: "SKILL.md" },
    files: [{
      path: "SKILL.md",
      mediaType: "text/markdown",
      digest: sha256(Buffer.from(spec.md)),
      contentBase64: Buffer.from(spec.md).toString("base64"),
    }],
  }));
  const unsigned = { schemaVersion: 1, packId: PACK, packVersion, skills: built };
  const dir = join(packRoot, PACK);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${packVersion}.json`), JSON.stringify({ ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) }));
}

const RESEARCH = (md: string, semanticVersion?: string): SkillSpec =>
  ({ stableName: "research-brief", name: "Research brief", md, ...(semanticVersion ? { semanticVersion } : {}) });

async function importPack(packVersion: string): Promise<Response> {
  return fetch(`${base}/admin/skills/starter-pack-imports`, {
    method: "POST",
    headers: { "x-kernel-test-principal": `${ADMIN}:${ORG}`, "content-type": "application/json" },
    body: JSON.stringify({ packId: PACK, packVersion, idempotencyKey: randomUUID() }),
  });
}

async function counts(): Promise<Record<string, number>> {
  return asApp(ORG, async (c) => {
    const out: Record<string, number> = {};
    for (const table of ["skills", "skill_versions", "skill_version_files", "skill_catalog_entries"]) {
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE org_id = $1`, [ORG]);
      out[table] = Number(r.rows[0]?.n ?? 0);
    }
    return out;
  });
}

async function catalogRows() {
  return asApp(ORG, async (c) => (await c.query<{
    skill_id: string; stable_id: string; domain: string; channel: string; search_document: string; successor_skill_id: string | null;
  }>(`SELECT skill_id, stable_id, domain, channel, search_document, successor_skill_id
        FROM skill_catalog_entries WHERE org_id = $1 ORDER BY stable_id`, [ORG])).rows);
}

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "ws02-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = packRoot;
  writePack("1.0.0", [RESEARCH(skillMd("Research brief", WORK_BLOCK()))]);
  writePack("1.1.0", [RESEARCH(skillMd("Research brief", WORK_BLOCK({ domain: "Shared" })), "1.1.0")]);
  writePack("bad-frontmatter", [RESEARCH(skillMd("Research brief", "metadata:\n  work:\n    stableId: X1\n    domain: Research"), "2.0.0")]);
  writePack("bad-yaml", [RESEARCH(skillMd("Research brief", "metadata: {work: [bad"), "2.0.0")]);
  writePack("unregistered", [RESEARCH(skillMd("Research brief", WORK_BLOCK({ required: "crm.teleport" })), "2.0.0")]);
  writePack("no-license", [RESEARCH(skillMd("Research brief", WORK_BLOCK({ license: null })), "2.0.0")]);
  writePack("copied-no-notice", [RESEARCH(skillMd("Research brief", WORK_BLOCK({ copiedNotice: false })), "2.0.0")]);
  writePack("second-bad", [
    RESEARCH(skillMd("Research brief", WORK_BLOCK()), "2.0.0"),
    { stableName: "meeting-notes", name: "Meeting notes", md: skillMd("Meeting notes", WORK_BLOCK({ stableId: "S004", required: "Salesforce" })) },
  ]);
  writePack("plain", [{ stableName: "plain-skill", name: "Plain skill", md: skillMd("Plain skill", null) }]);

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
  await resetOrgs(ORG);
  rmSync(packRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
});

describe("WS02 import writes manifest.work and a candidate catalog entry in one transaction", () => {
  it("persists the parsed metadata.work on the immutable version and creates one candidate row", async () => {
    const response = await importPack("1.0.0");
    expect(response.status).toBe(201);
    const body = await response.json() as { skillIds: string[]; versionIds: string[] };

    const manifest = await asApp(ORG, async (c) => (await c.query<{ manifest: Record<string, unknown> }>(
      "SELECT manifest FROM skill_versions WHERE id = $1", [body.versionIds[0]])).rows[0]!.manifest);
    expect(manifest.description).toBe("Research brief description");
    expect(manifest.work).toMatchObject({
      stableId: "S003", domain: "Research", riskClass: "low",
      dependencies: { required: ["knowledge.search"], optional: ["web.fetch"] },
      provenance: [{ license: "Apache-2.0", strategy: "adapt", copied: false }],
      evalSuiteId: "E003",
    });

    const rows = await catalogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ skill_id: body.skillIds[0], stable_id: "S003", domain: "Research", channel: "candidate", successor_skill_id: null });
    expect(rows[0]!.search_document).toContain("Research brief");
  });

  it("re-import refreshes search fields, never rolls the channel back, and keeps the old manifest readable", async () => {
    const first = await (await importPack("1.0.0")).json() as { skillIds: string[]; versionIds: string[] };
    await asOwner((c) => c.query("UPDATE skill_catalog_entries SET channel = 'verified' WHERE org_id = $1", [ORG]));

    const second = await importPack("1.1.0");
    expect(second.status).toBe(201);
    const secondBody = await second.json() as { skillIds: string[]; versionIds: string[] };
    expect(secondBody.skillIds).toEqual(first.skillIds);
    expect(secondBody.versionIds[0]).not.toBe(first.versionIds[0]);

    const rows = await catalogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "verified", domain: "Shared" });

    const manifests = await asApp(ORG, async (c) => (await c.query<{ id: string; manifest: { work: { domain: string } } }>(
      "SELECT id, manifest FROM skill_versions WHERE skill_id = $1", [first.skillIds[0]])).rows);
    const byId = new Map(manifests.map((row) => [row.id, row.manifest.work.domain]));
    expect(byId.get(first.versionIds[0]!)).toBe("Research");
    expect(byId.get(secondBody.versionIds[0]!)).toBe("Shared");
  });

  it("a plain skill without metadata.work imports as before and gets no catalog row", async () => {
    const response = await importPack("plain");
    expect(response.status).toBe(201);
    expect((await counts()).skill_catalog_entries).toBe(0);
  });
});

describe("WS02 rejects the whole pack with 422 and leaves skill_versions unchanged", () => {
  const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
    ["bad-frontmatter", "WORK_SKILL_MANIFEST_INVALID", /^metadata\.work\./],
    ["bad-yaml", "WORK_SKILL_MANIFEST_INVALID", /^frontmatter$/],
    ["unregistered", "WORK_SKILL_CAPABILITY_UNREGISTERED", /^metadata\.work\.dependencies\.required\.0$/],
    ["no-license", "WORK_SKILL_PROVENANCE_LICENSE_MISSING", /^metadata\.work\.provenance\.0\.license$/],
    ["copied-no-notice", "WORK_SKILL_PROVENANCE_LICENSE_MISSING", /^metadata\.work\.provenance\.0\.notice$/],
    ["second-bad", "WORK_SKILL_MANIFEST_INVALID", /^metadata\.work\.dependencies\.required\.0$/],
  ];

  for (const [packVersion, code, fieldPath] of cases) {
    it(`${packVersion} → 422 ${code}`, async () => {
      expect((await importPack("1.0.0")).status).toBe(201);
      const before = await counts();
      const catalogBefore = await catalogRows();

      const response = await importPack(packVersion);
      expect(response.status).toBe(422);
      const body = await response.json() as { code: string; issues: Array<{ file: string; fieldPath: string; message: string }> };
      expect(body.code).toBe(code);
      expect(body.issues.length).toBeGreaterThan(0);
      expect(body.issues.some((issue) => fieldPath.test(issue.fieldPath))).toBe(true);
      expect(body.issues.every((issue) => issue.file.endsWith("/SKILL.md"))).toBe(true);

      expect(await counts()).toEqual(before);
      expect(await catalogRows()).toEqual(catalogBefore);
    });
  }

  it("a stableId already owned by another skill in the org → 409 and nothing written (E2)", async () => {
    expect((await importPack("1.0.0")).status).toBe(201);
    writePack("clash", [{ stableName: "other-skill", name: "Other skill", md: skillMd("Other skill", WORK_BLOCK()) }]);
    const before = await counts();
    const response = await importPack("clash");
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("WORK_SKILL_STABLE_ID_CONFLICT");
    expect(await counts()).toEqual(before);
  });
});
