import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asApp, ensureDatabase, migrateOnce, seedOrg } from "../support/db";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId, PLATFORM_ORG_ID } from "../../src/domain/org-id";

const suffix = randomUUID();
const org = `org-e004-${suffix}`;
const other = `org-e004-other-${suffix}`;
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const binary = Buffer.from([0, 255, 128, 65]);
const files = [
  { path: "SKILL.md", content: Buffer.from("# Complete skill\nRead references/guide.md") },
  { path: "references/guide.md", content: Buffer.from("Use assets/template.bin") },
  { path: "scripts/render.js", content: Buffer.from("console.log('render')") },
  { path: "assets/template.bin", content: binary },
];
async function seed(scope: string, skill: string, version: string, published = true, corrupt = false) {
  await asApp(scope, async (c) => {
    await c.query(`INSERT INTO skills(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES($1,$2,$1,$1,'enabled','e004',now(),now()) ON CONFLICT(id) DO NOTHING`, [skill, scope]);
    await c.query(`INSERT INTO skill_versions(id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
      VALUES($1,$2,$3,$1,$4,'{}','e004',now(),false)`, [version, scope, skill, hash(files[0]!.content)]);
    for (const file of files) await c.query(`INSERT INTO skill_version_files(org_id,version_id,path,content,media_type,digest)
      VALUES($1,$2,$3,$4,$5,$6)`, [scope, version, file.path, file.content,
      file.path.endsWith(".bin") ? "application/octet-stream" : "text/plain", corrupt ? "0".repeat(64) : hash(file.content)]);
    if (published) await c.query("SELECT wave2_publish_skill_version($1,$2)", [scope, version]);
  });
}
const version = (key: string) => `v-e004-${key}-${suffix}`;
let repo: PgAgentRunRepository;
beforeAll(async () => {
  await ensureDatabase(); await migrateOnce();
  await seedOrg({ orgId: org, projectId: `project-${org}` });
  await seedOrg({ orgId: other, projectId: `project-${other}` });
  await asApp(PLATFORM_ORG_ID, (c) => c.query("INSERT INTO organizations(id,name,kind) VALUES($1,'Platform','organization') ON CONFLICT(id) DO NOTHING", [PLATFORM_ORG_ID]));
  repo = new PgAgentRunRepository(new PgDatabase(appConfig()));
  await seed(org, `skill-e004-${suffix}`, version("old"));
  await seed(org, `skill-e004-${suffix}`, version("new"));
  await seed(other, `skill-e004-other-${suffix}`, version("other"));
  await seed(PLATFORM_ORG_ID, `skill-e004-platform-${suffix}`, version("platform"));
  await seed(org, `skill-e004-draft-${suffix}`, version("draft"), false);
  await seed(org, `skill-e004-corrupt-${suffix}`, version("corrupt"), true, true);
}, 120_000);

describe("WX-E004 immutable complete packages", () => {
  it("reads all files losslessly in pinned order, including platform, without resolving newer heads", async () => {
    const result = await repo.readPinnedSkills(toOrgId(org), [version("platform"), version("old")]);
    expect(result.map((s) => s.versionId)).toEqual([version("platform"), version("old")]);
    expect(result[1]!.content).toBe(files[0]!.content.toString("utf8"));
    for (const skill of result) {
      expect(skill.package!.versionId).toBe(skill.versionId);
      expect(skill.package!.files).toHaveLength(files.length);
      for (const original of files) {
        const stored = skill.package!.files.find((f) => f.path === original.path)!;
        expect(Buffer.from(stored.contentBase64, "base64")).toEqual(original.content);
        expect(stored.digest).toBe(hash(original.content));
      }
    }
    expect(result.some((s) => s.versionId === version("new"))).toBe(false);
  });
  it("does not read another organization's version or unpublished draft, even when explicitly pinned", async () => {
    expect(await repo.readPinnedSkills(toOrgId(org), [version("other"), version("draft")])).toEqual([]);
  });
  it("rejects corrupt persisted bytes instead of advertising a complete verified package", async () => {
    await expect(repo.readPinnedSkills(toOrgId(org), [version("corrupt")])).rejects.toThrow("integrity mismatch");
  });
});
