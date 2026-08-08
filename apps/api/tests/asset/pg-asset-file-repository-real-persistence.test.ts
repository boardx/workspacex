/**
 * #785 -- `PgAssetFileRepository` (`assetKind === "skill"`) against a REAL Postgres, not a
 * mock. Proves the three things the issue is actually about:
 *
 *   ① reads come back with the REAL seeded content (not `FixtureAssetFileRepository`'s canned
 *      `SK_TREE` bytes -- see that repository's header for the fixture body it would return if
 *      this repository were, wrongly, still delegating `skill` to it);
 *   ② a write NEVER `UPDATE`s a published row -- it publishes a whole new `skill_versions`
 *      snapshot, leaving the old version's row byte-for-byte untouched, and the immutable
 *      trigger rejects a direct `UPDATE` attempt even from the owner role;
 *   ③ after a write, the SAME `assetId` resolves to the NEW version on a fresh read (a
 *      different transaction than the write's own) -- not the response payload only.
 *
 * Independent transactions throughout for read-back, same reasoning as
 * `url-import-persists-real-db.test.ts`'s header: proving "committed", not "visible to the
 * writer's own transaction".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgAssetFileRepository } from "../../src/infrastructure/asset/pg-asset-file-repository";
import { FixtureAssetFileRepository } from "../../src/infrastructure/asset/fixture-asset-file-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { sha256 } from "../../src/domain/skill/starter-pack";

const ORG = "org-i785-asset-file-repo";
const ACTOR = "u-i785-seeder";

let repo: PgAssetFileRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i785-asset-file-repo" });
  repo = new PgAssetFileRepository(new PgDatabase(appConfig()), new FixtureAssetFileRepository());
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
});

/**
 * Seeds one published skill with two files -- deliberately NOT matching any of
 * `FixtureAssetFileRepository`'s `SK_TREE` bodies, so a test that accidentally still hits the
 * fixture would fail on content, not just be "green for the wrong reason".
 */
async function seedPublishedSkill(opts: {
  skillId: string;
  rootBody: string;
  refBody: string;
}): Promise<void> {
  const versionId = `sv_${randomUUID()}`;
  const now = new Date().toISOString();
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6)`,
      [opts.skillId, ORG, opts.skillId, `真实种入的 skill ${opts.skillId}`, ACTOR, now],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
       VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,$6,false)`,
      [versionId, ORG, opts.skillId, sha256(opts.rootBody), ACTOR, now],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
       VALUES ($1,$2,'SKILL.md',$3,'text/markdown',$4)`,
      [ORG, versionId, Buffer.from(opts.rootBody, "utf8"), sha256(opts.rootBody)],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
       VALUES ($1,$2,'references/real-content.md',$3,'text/markdown',$4)`,
      [ORG, versionId, Buffer.from(opts.refBody, "utf8"), sha256(opts.refBody)],
    );
    await c.query("SELECT wave2_publish_skill_version($1, $2)", [ORG, versionId]);
  });
}

async function skillVersionsFor(skillId: string): Promise<
  readonly { id: string; semanticLabel: string; published: boolean; contentDigest: string; createdAt: string }[]
> {
  return asApp(ORG, async (c) => {
    const rows = await c.query(
      `SELECT id, semantic_label, published, content_digest, created_at
         FROM skill_versions WHERE org_id = $1 AND skill_id = $2 ORDER BY created_at ASC`,
      [ORG, skillId],
    );
    return rows.rows.map((r) => ({
      id: r.id,
      semanticLabel: r.semantic_label,
      published: r.published,
      contentDigest: r.content_digest,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  });
}

describe("PgAssetFileRepository -- getDirectory / readFile 读到的是真实种入的字节，不是 fixture", () => {
  const SKILL_ID = "sk-i785-read";
  const ROOT_BODY = "---\nname: 真实技能\n---\n\n# 真实技能\n\n不是 fixture 的 MECE 假设拆解。\n";
  const REF_BODY = "# 真实引用文件\n\n这段内容只应该来自 skill_version_files，不应该来自 FixtureAssetFileRepository。\n";

  beforeAll(async () => {
    await seedPublishedSkill({ skillId: SKILL_ID, rootBody: ROOT_BODY, refBody: REF_BODY });
  });

  it("getDirectory 返回真实的两个文件路径与真实字节数，fixture 的 references/output-schema.md 等路径不出现", async () => {
    const dir = await repo.getDirectory(toOrgId(ORG), "skill", SKILL_ID);
    expect(dir).not.toBeNull();
    expect(dir!.rootFile).toBe("SKILL.md");
    expect(dir!.entries.map((e) => e.path).sort()).toEqual(["SKILL.md", "references/real-content.md"]);
    const ref = dir!.entries.find((e) => e.path === "references/real-content.md")!;
    expect(ref.sizeBytes).toBe(Buffer.byteLength(REF_BODY, "utf8"));
    // Fixture-only paths must never appear on a real-backed skill.
    expect(dir!.entries.map((e) => e.path)).not.toContain("references/output-schema.md");
    expect(dir!.entries.map((e) => e.path)).not.toContain("scripts/validate.py");
  });

  it("readFile 读到与种入时逐字节相同的内容", async () => {
    const rootFile = await repo.readFile(toOrgId(ORG), "skill", SKILL_ID, "SKILL.md");
    expect(rootFile).not.toBeNull();
    expect(rootFile!.body).toBe(ROOT_BODY);

    const refFile = await repo.readFile(toOrgId(ORG), "skill", SKILL_ID, "references/real-content.md");
    expect(refFile).not.toBeNull();
    expect(refFile!.body).toBe(REF_BODY);
  });

  it("未知路径 -> null；未知 assetId -> null（与 fixture 同一个折叠出口）", async () => {
    expect(await repo.readFile(toOrgId(ORG), "skill", SKILL_ID, "no/such/path.md")).toBeNull();
    expect(await repo.getDirectory(toOrgId(ORG), "skill", "sk-does-not-exist")).toBeNull();
  });
});

describe("PgAssetFileRepository -- writeFile 发新版本、旧版本原样不动（不可变）", () => {
  const SKILL_ID = "sk-i785-write";
  const ROOT_BODY = "---\nname: 可编辑技能\n---\n\n# 可编辑技能\n";
  const REF_BODY_V1 = "# 引用 v1\n\n编辑前的内容。\n";
  const REF_BODY_V2 = "# 引用 v2\n\n编辑后的内容 -- 这次 writeFile 写入的新字节。\n";

  beforeAll(async () => {
    await seedPublishedSkill({ skillId: SKILL_ID, rootBody: ROOT_BODY, refBody: REF_BODY_V1 });
  });

  it("① 写入前只有一条版本记录，已发布", async () => {
    const before = await skillVersionsFor(SKILL_ID);
    expect(before).toHaveLength(1);
    expect(before[0]!.published).toBe(true);
  });

  it("② writeFile 返回新内容，且新增了一条 skill_versions（旧的那条 digest/created_at 完全不变）", async () => {
    const before = await skillVersionsFor(SKILL_ID);
    const oldRow = before[0]!;

    const written = await repo.writeFile(toOrgId(ORG), "skill", SKILL_ID, "references/real-content.md", REF_BODY_V2);
    expect(written).not.toBeNull();
    expect(written!.body).toBe(REF_BODY_V2);
    expect(written!.sizeBytes).toBe(Buffer.byteLength(REF_BODY_V2, "utf8"));

    const after = await skillVersionsFor(SKILL_ID);
    expect(after).toHaveLength(2);

    // The OLD row -- looked up by its own id, not by position -- is untouched.
    const stillOld = after.find((r) => r.id === oldRow.id)!;
    expect(stillOld.contentDigest).toBe(oldRow.contentDigest);
    expect(stillOld.createdAt).toBe(oldRow.createdAt);
    expect(stillOld.semanticLabel).toBe(oldRow.semanticLabel);
    // ⚠ Still `published = true` -- the trigger forbids clearing it. "Current" is
    // determined by recency, not by the old row somehow un-publishing itself.
    expect(stillOld.published).toBe(true);

    // The NEW row is a distinct, later, ALSO-published version.
    const newRow = after.find((r) => r.id !== oldRow.id)!;
    expect(newRow.published).toBe(true);
    expect(newRow.semanticLabel).toBe("v2");
    expect(newRow.contentDigest).not.toBe(oldRow.contentDigest);
  });

  it("③ 再读（独立事务）-> 同一个 assetId 现在解析到新版本：新文件内容是 v2，且未改动的 SKILL.md 原样带过去了", async () => {
    const dir = await repo.getDirectory(toOrgId(ORG), "skill", SKILL_ID);
    expect(dir!.entries.map((e) => e.path).sort()).toEqual(["SKILL.md", "references/real-content.md"]);

    const ref = await repo.readFile(toOrgId(ORG), "skill", SKILL_ID, "references/real-content.md");
    expect(ref!.body).toBe(REF_BODY_V2);

    // Full-snapshot invariant (F143 I-6): the untouched root file was carried over into the
    // new version, not left behind on the old one -- a partial/diff version would read back
    // as a directory MISSING SKILL.md's real content on the new version.
    const root = await repo.readFile(toOrgId(ORG), "skill", SKILL_ID, "SKILL.md");
    expect(root!.body).toBe(ROOT_BODY);
  });

  it("④ 反证：直接对已发布的旧版本 UPDATE skill_version_files 被不可变触发器拒绝（owner 角色也不例外）", async () => {
    const versions = await skillVersionsFor(SKILL_ID);
    const oldVersionId = versions[0]!.id; // the v1 row, still published, from step ②
    await expect(
      asOwner((c) =>
        c.query(
          `UPDATE skill_version_files SET content = $1 WHERE org_id = $2 AND version_id = $3 AND path = 'SKILL.md'`,
          [Buffer.from("hacked", "utf8"), ORG, oldVersionId],
        ),
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it("⑤ 未知路径的写入 -> null，不创建新路径，也不发新版本（这个 port 不做 CreateAssetFile）", async () => {
    const beforeCount = (await skillVersionsFor(SKILL_ID)).length;
    const result = await repo.writeFile(toOrgId(ORG), "skill", SKILL_ID, "no/such/path.md", "x");
    expect(result).toBeNull();
    const afterCount = (await skillVersionsFor(SKILL_ID)).length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe("PgAssetFileRepository -- deleteFile / renameFile 同样走「整份新版本」路径", () => {
  const SKILL_ID = "sk-i785-delete-rename";
  const ROOT_BODY = "---\nname: 删除改名技能\n---\n\n# 删除改名技能\n";
  const REF_BODY = "# 待删除/改名的引用文件\n";

  beforeAll(async () => {
    await seedPublishedSkill({ skillId: SKILL_ID, rootBody: ROOT_BODY, refBody: REF_BODY });
  });

  it("deleteFile 成功后新版本里已不含该路径；旧版本行数不变", async () => {
    const before = await skillVersionsFor(SKILL_ID);
    const deleted = await repo.deleteFile(toOrgId(ORG), "skill", SKILL_ID, "references/real-content.md");
    expect(deleted).toBe("references/real-content.md");

    const after = await skillVersionsFor(SKILL_ID);
    expect(after).toHaveLength(before.length + 1);

    const dir = await repo.getDirectory(toOrgId(ORG), "skill", SKILL_ID);
    expect(dir!.entries.map((e) => e.path)).toEqual(["SKILL.md"]);
  });

  it("renameFile 之后旧路径读不到，新路径读到原内容", async () => {
    // Re-seed a fresh file to rename, since the previous test deleted it.
    await repo.writeFile(toOrgId(ORG), "skill", SKILL_ID, "SKILL.md", ROOT_BODY); // no-op content, just to have a stable base
    const dirBefore = await repo.getDirectory(toOrgId(ORG), "skill", SKILL_ID);
    expect(dirBefore!.entries.map((e) => e.path)).toEqual(["SKILL.md"]);

    // Add a renameable file via a direct write is not possible (writeFile never creates paths),
    // so seed one more published version with the extra file directly, then rename it through
    // the repository under test.
    const versions = await skillVersionsFor(SKILL_ID);
    const latest = versions[versions.length - 1]!;
    const extraVersionId = `sv_${randomUUID()}`;
    const now = new Date().toISOString();
    await asApp(ORG, async (c) => {
      const rows = await c.query(
        `SELECT path, content, media_type FROM skill_version_files WHERE org_id = $1 AND version_id = $2`,
        [ORG, latest.id],
      );
      await c.query(
        `INSERT INTO skill_versions
           (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
         VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,$7,false)`,
        [extraVersionId, ORG, SKILL_ID, `v${versions.length + 1}`, sha256("extra"), ACTOR, now],
      );
      for (const r of rows.rows as { path: string; content: Buffer; media_type: string }[]) {
        await c.query(
          `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ORG, extraVersionId, r.path, r.content, r.media_type, sha256(Buffer.from(r.content).toString("utf8"))],
        );
      }
      await c.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,$2,'notes/old-name.md',$3,'text/markdown',$4)`,
        [ORG, extraVersionId, Buffer.from("待改名内容", "utf8"), sha256("待改名内容")],
      );
      await c.query("SELECT wave2_publish_skill_version($1, $2)", [ORG, extraVersionId]);
    });

    const renamed = await repo.renameFile(toOrgId(ORG), "skill", SKILL_ID, "notes/old-name.md", "notes/new-name.md");
    expect(renamed).not.toBeNull();
    expect(renamed!.path).toBe("notes/new-name.md");
    expect(renamed!.body).toBe("待改名内容");

    expect(await repo.readFile(toOrgId(ORG), "skill", SKILL_ID, "notes/old-name.md")).toBeNull();
    const atNewPath = await repo.readFile(toOrgId(ORG), "skill", SKILL_ID, "notes/new-name.md");
    expect(atNewPath!.body).toBe("待改名内容");
  });
});

describe("PgAssetFileRepository -- 非 skill 的 AssetKind 委派给 fixture，不碰 Postgres", () => {
  it("agent 仍然是 FixtureAssetFileRepository 的固定文件树", async () => {
    const dir = await repo.getDirectory(toOrgId(ORG), "agent", "ag-any-id");
    expect(dir).not.toBeNull();
    expect(dir!.rootFile).toBe("AGENT.md");
    expect(dir!.entries.map((e) => e.path)).toContain("prompts/system.md");
  });
});
