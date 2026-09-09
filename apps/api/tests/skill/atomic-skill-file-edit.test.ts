import { createHash, randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_PORT, type DatabasePort } from "../../src/application/ports/database.port";
import { HttpException } from "@nestjs/common";
import { SKILL_FILE_EDIT_REPOSITORY, type SkillFileEditRepository } from "../../src/application/skill/edit-skill-files";
import { operations } from "@repo/contracts/skill-file-edit";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
const ORG = `org-file-edit-${randomUUID()}`;
const OTHER = `${ORG}-other`, ADMIN = "file-edit-admin", MEMBER = "file-edit-member";
const SKILL = "file-edit-skill", VERSION = "file-edit-version";
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const root = "---\nname: research\ndescription: Read reference\nallowed-tools: read_file\n---\n# Research\n";
const original = [
  { path: "SKILL.md", bytes: Buffer.from(root), mediaType: "text/markdown" },
  { path: "references/guide.md", bytes: Buffer.from("old reference"), mediaType: "text/markdown" },
  { path: "scripts/old.py", bytes: Buffer.from("print('old')"), mediaType: "text/x-python" },
  { path: "assets/logo.bin", bytes: Buffer.from([0, 255, 128, 1]), mediaType: "application/octet-stream" },
];
const put = (path: string, text: string) => ({ kind: "put", path, contentBase64: Buffer.from(text).toString("base64"), mediaType: "text/markdown" });
let app: NestExpressApplication, base: string, db: PgDatabase;
const headers = (actor = ADMIN, org = ORG) => ({ "content-type": "application/json", "x-kernel-test-principal": `${actor}:${org}` });
const save = (mutations: unknown[], expectedVersionId = VERSION, actor = ADMIN, org = ORG) => fetch(`${base}/admin/skills/${SKILL}/file-edits`, { method: "POST", headers: headers(actor, org), body: JSON.stringify({ expectedVersionId, mutations }) });
const read = (versionId: string, actor = ADMIN, org = ORG) => fetch(`${base}/admin/skills/${SKILL}/file-snapshot?versionId=${encodeURIComponent(versionId)}`, { headers: headers(actor, org) });
const count = () => asApp(ORG, async c => (await c.query("SELECT id FROM skill_versions WHERE org_id=$1 AND skill_id=$2", [ORG, SKILL])).rows.length);
beforeAll(async () => {
  await ensureDatabase(); await migrateOnce();
  const { createApp } = await import("../../src/main"); app = await createApp(); await app.listen(0, "127.0.0.1");
  base = await app.getUrl(); db = new PgDatabase(appConfig());
}, 180_000);
afterAll(async () => { await db?.close(); await app?.close(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  for (const org of [ORG, OTHER]) {
    const seeded = await seedOrg({ orgId: org, projectId: `project-${org}` });
    await addOrgMember(org, ADMIN, "admin", seeded.teams.energy ?? null);
  }
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await asApp(ORG, async c => {
    await c.query("INSERT INTO skills(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,$1,'Edit skill','enabled',$3,now(),now())", [SKILL, ORG, ADMIN]);
    await c.query("INSERT INTO skill_versions(id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published) VALUES($1,$2,$3,'v1',$4,$5::jsonb,$6,now(),false)", [VERSION, ORG, SKILL, hash(original[0]!.bytes), JSON.stringify({ sourceUrl: "https://github.com/example/research" }), ADMIN]);
    for (const file of original) await c.query("INSERT INTO skill_version_files(org_id,version_id,path,content,media_type,digest) VALUES($1,$2,$3,$4,$5,$6)", [ORG, VERSION, file.path, file.bytes, file.mediaType, hash(file.bytes)]);
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, VERSION]);
  });
});
describe("atomic Skill snapshot HTTP and real database", () => {
  it("saves all changes once, preserves binary and old version, and loads the exact runtime package", async () => {
    const res = await save([put("SKILL.md", `${root}new root`), put("references/guide.md", "new reference"), put("references/new.md", "created"), { kind: "rename", from: "scripts/old.py", to: "scripts/new.py" }]);
    expect(res.status).toBe(201);
    const result = operations.saveSkillFiles.out.parse(await res.json());
    expect(result.versionId).not.toBe(VERSION); expect(await count()).toBe(2);
    expect(result.files.map(f => f.path)).toEqual(["SKILL.md", "assets/logo.bin", "references/guide.md", "references/new.md", "scripts/new.py"]);
    expect(Buffer.from(result.files.find(f => f.path === "assets/logo.bin")!.contentBase64, "base64")).toEqual(original[3]!.bytes);
    const readBack = await read(result.versionId); expect(readBack.status).toBe(200);
    expect(await readBack.json()).toEqual(result);
    const old = operations.getSkillFileSnapshot.out.parse(await (await read(VERSION)).json());
    expect(Buffer.from(old.files.find(f => f.path === "references/guide.md")!.contentBase64, "base64").toString()).toBe("old reference");
    const runtime = await new PgAgentRunRepository(db).readPinnedSkills(toOrgId(ORG), [result.versionId, VERSION]);
    expect(runtime[0]!.package!.files.map(f => f.path).sort()).toEqual(result.files.map(f => f.path).sort());
    expect(runtime[0]!.package!.files.find(f => f.path === "references/guide.md")!.digest).toBe(hash(Buffer.from("new reference")));
    expect(runtime[1]!.content).toBe(root);
    const attribution = await asApp(ORG, c => c.query("SELECT creator_id,manifest FROM skill_versions WHERE id=$1", [result.versionId]));
    expect(attribution.rows[0]!.creator_id).toBe(ADMIN);
    expect(attribution.rows[0]!.manifest).toEqual({ sourceUrl: "https://github.com/example/research" });
  });
  it("allows exactly one winner for a shared baseline and reports conflict without a partial version", async () => {
    const responses = await Promise.all([save([put("references/guide.md", "A")]), save([put("references/guide.md", "B")])]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const winner = operations.saveSkillFiles.out.parse(await responses.find(r => r.status === 201)!.json());
    expect(await responses.find(r => r.status === 409)!.json()).toMatchObject({ reasonCode: "EDIT_VERSION_CONFLICT", currentVersionId: winner.versionId });
    expect(await count()).toBe(2);
  });
  it("rejects forbidden roots, invalid tree changes and unknown paths atomically", async () => {
    for (const mutations of [[{ kind: "delete", path: "SKILL.md" }], [{ kind: "rename", from: "scripts/old.py", to: "assets/logo.bin" }],
      [{ kind: "delete", path: "missing.md" }], [put("assets/logo.bin/nested.txt", "collision")], [put("../bad", "bad")], [put("SKILL.md", "")]]) {
      const res = await save(mutations); expect([400, 422]).toContain(res.status); expect(await count()).toBe(1);
    }
    const res = await save([{ kind: "delete", path: "scripts/old.py" }]); expect(res.status).toBe(201);
    expect(operations.saveSkillFiles.out.parse(await res.json()).files.some(f => f.path === "scripts/old.py")).toBe(false);
  });
  it("checks organization administrator membership before reading or writing", async () => {
    expect((await save([put("references/guide.md", "bad")], VERSION, MEMBER)).status).toBe(403);
    expect((await read(VERSION, MEMBER)).status).toBe(403);
    expect((await save([put("references/guide.md", "bad")], VERSION, ADMIN, OTHER)).status).toBe(404);
    expect((await read(VERSION, ADMIN, OTHER)).status).toBe(404);
    expect((await fetch(`${base}/admin/skills/${SKILL}/file-snapshot?versionId=${VERSION}`)).status).toBe(401);
    expect(await count()).toBe(1);
  });
  it("projects only closed conflict fields from an exception over real HTTP", async () => {
    const repository = app.get<SkillFileEditRepository>(SKILL_FILE_EDIT_REPOSITORY);
    const spy = vi.spyOn(repository, "append").mockRejectedValueOnce(new HttpException({ reasonCode: "EDIT_VERSION_CONFLICT",
      currentVersionId: VERSION, sql: "secret-db-detail", credential: "secret-value" }, 409));
    try {
      const response = await save([put("references/guide.md", "new")]);
      expect(response.status).toBe(409);
      const body = await response.json() as Record<string, unknown>;
      expect(body).toMatchObject({ reasonCode: "EDIT_VERSION_CONFLICT", currentVersionId: VERSION });
      expect(Object.keys(body).sort()).toEqual(["currentVersionId", "error", "reasonCode", "traceId"]);
      expect(JSON.stringify(body)).not.toContain("secret");
      expect(await count()).toBe(1);
    } finally { spy.mockRestore(); }
  });

  it("accepts a valid file exceeding the default JSON parser limit without widening other routes", async () => {
    const body = "multi-file-content-".repeat(12000);
    const response = await save([put("references/guide.md", body)]);
    expect(response.status).toBe(201);
    const result = operations.saveSkillFiles.out.parse(await response.json());
    expect(Buffer.from(result.files.find(f => f.path === "references/guide.md")!.contentBase64, "base64").toString()).toBe(body);
    const unchangedRoute = await fetch(`${base}/admin/skills/${SKILL}/versions`, { method: "POST", headers: headers(), body: JSON.stringify({ content: body }) });
    // Existing global filter maps body-parser overflow to 500; preserve that route
    // rather than silently widening its accepted body size in this change.
    expect([413, 500]).toContain(unchangedRoute.status);
  });
  it("rolls back even when an error occurs after inserting part of the new snapshot", async () => {
    const database = app.get<DatabasePort>(DATABASE_PORT);
    const originalTransaction = database.withTenant.bind(database);
    const spy = vi.spyOn(database, "withTenant").mockImplementation((orgId, fn) => originalTransaction(orgId, session => fn({
      query: (sql, params) => {
        if (sql.includes("INSERT INTO skill_version_files") && params?.[2] === "assets/logo.bin") throw new Error("injected file write failure");
        return session.query(sql, params);
      },
    })));
    try {
      const response = await save([put("references/guide.md", "new")]);
      expect(response.status).toBe(500);
      expect(await count()).toBe(1);
      const old = operations.getSkillFileSnapshot.out.parse(await (await read(VERSION)).json());
      expect(old.files).toHaveLength(original.length);
      expect(JSON.stringify(await response.json())).not.toContain("injected");
    } finally { spy.mockRestore(); }
  });

});
