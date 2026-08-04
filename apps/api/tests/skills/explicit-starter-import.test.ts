import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-wave2-skills";
const OTHER_ORG = "org-wave2-skills-other";
const ADMIN = "u-wave2-skill-admin";
const MEMBER = "u-wave2-skill-member";
const PACK_ID = "facilitation-core";
const PACK_VERSION = "1.0.0";

describe("starter import authorization structure", () => {
  it("keeps the admin decision before every import dependency and the repository narrowly scoped", () => {
    const useCase = readFileSync(
      new URL("../../src/application/skill-import/import-skill-starter-pack.ts", import.meta.url),
      "utf8",
    );
    const membership = useCase.indexOf("findOrgMembership");
    const adminDecision = useCase.indexOf('membership.orgRole !== "admin"');
    expect(membership).toBeGreaterThan(-1);
    expect(adminDecision).toBeGreaterThan(membership);
    for (const dependencyCall of [
      "deps.imports.findExisting",
      "deps.packs.load",
      "deps.imports.recordFailure",
      "deps.imports.persistVerified",
    ]) {
      expect(useCase.indexOf(dependencyCall)).toBeGreaterThan(adminDecision);
    }

    const repository = readFileSync(
      new URL("../../src/infrastructure/skill/pg-skill-starter-import-repository.ts", import.meta.url),
      "utf8",
    );
    expect(repository).not.toContain("withoutTenant");
    const sqlTables = [...repository.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)]
      .map((match) => match[1]?.toLowerCase());
    expect(new Set(sqlTables)).toEqual(new Set([
      "starter_pack_imports",
      "skills",
      "capability_listings",
      "skill_versions",
      "skill_version_files",
    ]));
  });
});

let app: NestExpressApplication;
let base = "";
let packRoot = "";

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

interface PackFileInput {
  readonly path: string;
  readonly mediaType: string;
  readonly content: string;
  readonly digestOverride?: string;
}

function writePack(input: {
  readonly packId: string;
  readonly packVersion: string;
  readonly stableName?: string;
  readonly name?: string;
  readonly files?: readonly PackFileInput[];
  readonly packDigestOverride?: string;
}): void {
  const files = (input.files ?? [
    {
      path: "SKILL.md",
      mediaType: "text/markdown",
      content: "# Facilitation core\n\nSummarize a workshop without inventing facts.\n",
    },
    {
      path: "references/checklist.md",
      mediaType: "text/markdown",
      content: "# Checklist\n\n- Cite the source\n- Keep dissent visible\n",
    },
  ]).map((file) => {
    const contentBase64 = Buffer.from(file.content).toString("base64");
    return {
      path: file.path,
      mediaType: file.mediaType,
      digest: file.digestOverride ?? sha256(Buffer.from(file.content)),
      contentBase64,
    };
  });

  const skill = {
    stableName: input.stableName ?? "facilitation-core",
    name: input.name ?? "Facilitation core",
    semanticVersion: "1.0.0",
    manifest: {
      description: "Summarize a workshop with traceable evidence.",
      entrypoint: "SKILL.md",
    },
    files,
  };
  const unsigned = {
    schemaVersion: 1,
    packId: input.packId,
    packVersion: input.packVersion,
    skills: [skill],
  };
  const body = {
    ...unsigned,
    packDigest: input.packDigestOverride ?? sha256(JSON.stringify(unsigned)),
  };

  const dir = join(packRoot, input.packId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${input.packVersion}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

function importPack(
  userId: string,
  body: { packId: string; packVersion: string; idempotencyKey: string },
  orgId = ORG,
): Promise<Response> {
  return fetch(`${base}/admin/skills/starter-pack-imports`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });
}

async function counts(orgId = ORG): Promise<Record<string, number>> {
  return asApp(orgId, async (client) => {
    const tableNames = [
      "skills",
      "skill_versions",
      "skill_version_files",
      "skill_mounts",
      "starter_pack_imports",
    ] as const;
    const result: Record<string, number> = {};
    for (const tableName of tableNames) {
      const rows = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${tableName} WHERE org_id = $1`,
        [orgId],
      );
      result[tableName] = Number(rows.rows[0]?.n ?? "0");
    }
    return result;
  });
}

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "workspacex-skill-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = packRoot;
  writePack({ packId: PACK_ID, packVersion: PACK_VERSION });
  writePack({
    packId: PACK_ID,
    packVersion: "bad-file",
    files: [{
      path: "SKILL.md",
      mediaType: "text/markdown",
      content: "# Changed after signing\n",
      digestOverride: "0".repeat(64),
    }],
  });
  writePack({ packId: PACK_ID, packVersion: "bad-pack", packDigestOverride: "f".repeat(64) });
  writePack({
    packId: PACK_ID,
    packVersion: "missing-root",
    files: [{ path: "README.md", mediaType: "text/markdown", content: "not a skill root" }],
  });
  writePack({
    packId: "conflicting-pack",
    packVersion: PACK_VERSION,
    stableName: "facilitation-core",
    name: "Conflicting overwrite attempt",
  });
  writePack({
    packId: "second-pack",
    packVersion: PACK_VERSION,
    stableName: "second-skill",
    name: "Second Skill",
  });

  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
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
  const otherFixture = await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  await addOrgMember(OTHER_ORG, ADMIN, "admin", otherFixture.teams.energy!);
});

describe("production-shaped empty state and authorization", () => {
  it("starts with zero Skills and never imports during migration, startup, or first request", async () => {
    expect(await counts()).toEqual({
      skills: 0,
      skill_versions: 0,
      skill_version_files: 0,
      skill_mounts: 0,
      starter_pack_imports: 0,
    });

    const directory = await fetch(`${base}/capabilities?orgId=${ORG}&kind=skill`, {
      headers: authFor(ADMIN),
    });
    expect(directory.status).toBe(200);
    expect(await directory.json()).toEqual([]);
    expect((await counts()).skills).toBe(0);
  });

  it("rejects a non-administrator and leaves every durable table empty", async () => {
    const response = await importPack(MEMBER, {
      packId: PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(response.status).toBe(403);
    expect(await counts()).toEqual({
      skills: 0,
      skill_versions: 0,
      skill_version_files: 0,
      skill_mounts: 0,
      starter_pack_imports: 0,
    });
  });
});

describe("verified, transactional explicit import", () => {
  it("persists NOT_FOUND provenance and replays the original failure after the pack appears", async () => {
    const request = {
      packId: "appears-later",
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    };
    const first = await importPack(ADMIN, request);
    expect(first.status).toBe(404);
    expect(await first.json()).toMatchObject({ reasonCode: "SKILL_STARTER_PACK_NOT_FOUND" });
    expect((await counts()).starter_pack_imports).toBe(1);

    writePack({
      packId: request.packId,
      packVersion: request.packVersion,
      stableName: "appears-later",
      name: "Appears later",
    });
    const retry = await importPack(ADMIN, request);
    expect(retry.status).toBe(404);
    expect(await retry.json()).toMatchObject({ reasonCode: "SKILL_STARTER_PACK_NOT_FOUND" });
    expect((await counts()).skills).toBe(0);
    expect((await counts()).starter_pack_imports).toBe(1);
  });

  it("imports Skills, immutable versions/files, provenance, and the catalog projection atomically", async () => {
    const request = {
      packId: PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    };
    const response = await importPack(ADMIN, request);
    expect(response.status).toBe(201);
    const result = await response.json() as {
      importId: string;
      packId: string;
      packVersion: string;
      packDigest: string;
      status: string;
      skillIds: string[];
      versionIds: string[];
      importedAt: string;
    };
    expect(result).toMatchObject({
      packId: PACK_ID,
      packVersion: PACK_VERSION,
      status: "succeeded",
    });
    expect(result.importId).toMatch(/^skill-import-/);
    expect(result.skillIds).toHaveLength(1);
    expect(result.versionIds).toHaveLength(1);
    expect(result.packDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Number.isNaN(Date.parse(result.importedAt))).toBe(false);

    expect(await counts()).toEqual({
      skills: 1,
      skill_versions: 1,
      skill_version_files: 2,
      skill_mounts: 0,
      starter_pack_imports: 1,
    });

    const durable = await asApp(ORG, async (client) => {
      const skill = await client.query<{ stable_name: string; name: string; status: string }>(
        "SELECT stable_name, name, status FROM skills WHERE org_id = $1",
        [ORG],
      );
      const version = await client.query<{ semantic_label: string; content_digest: string; manifest: unknown }>(
        "SELECT semantic_label, content_digest, manifest FROM skill_versions WHERE org_id = $1",
        [ORG],
      );
      const files = await client.query<{ path: string; media_type: string; digest: string; content: Buffer }>(
        "SELECT path, media_type, digest, content FROM skill_version_files WHERE org_id = $1 ORDER BY path",
        [ORG],
      );
      const provenance = await client.query<{ pack_id: string; pack_version: string; pack_digest: string }>(
        "SELECT pack_id, pack_version, pack_digest FROM starter_pack_imports WHERE org_id = $1",
        [ORG],
      );
      return { skill: skill.rows[0], version: version.rows[0], files: files.rows, provenance: provenance.rows[0] };
    });
    expect(durable.skill).toEqual({
      stable_name: "facilitation-core",
      name: "Facilitation core",
      status: "enabled",
    });
    expect(durable.version?.semantic_label).toBe("1.0.0");
    expect(durable.version?.content_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(durable.version?.manifest).toEqual({
      description: "Summarize a workshop with traceable evidence.",
      entrypoint: "SKILL.md",
    });
    expect(new Set(durable.files.map((file) => file.path))).toEqual(
      new Set(["SKILL.md", "references/checklist.md"]),
    );
    for (const file of durable.files) expect(sha256(file.content)).toBe(file.digest);
    expect(durable.provenance).toMatchObject({ pack_id: PACK_ID, pack_version: PACK_VERSION });

    const directory = await fetch(`${base}/capabilities?orgId=${ORG}&kind=skill`, {
      headers: authFor(ADMIN),
    }).then((value) => value.json()) as Array<{ id: string; name: string }>;
    expect(directory).toHaveLength(1);
    expect(directory.map((entry) => entry.id)).toEqual(result.skillIds);
    expect(directory.map((entry) => entry.name)).toEqual(["Facilitation core"]);
  });

  it.each(["bad-file", "bad-pack", "missing-root"])(
    "rejects an invalid %s pack without partial Skill/version/file rows",
    async (packVersion) => {
      const response = await importPack(ADMIN, {
        packId: PACK_ID,
        packVersion,
        idempotencyKey: randomUUID(),
      });
      expect(response.status).toBe(422);
      const current = await counts();
      expect(current.skills).toBe(0);
      expect(current.skill_versions).toBe(0);
      expect(current.skill_version_files).toBe(0);
      expect(current.skill_mounts).toBe(0);
      expect(current.starter_pack_imports).toBe(1);
    },
  );

  it("rejects a name conflict visibly and never overwrites user/imported content", async () => {
    const first = await importPack(ADMIN, {
      packId: PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(first.status).toBe(201);

    const conflict = await importPack(ADMIN, {
      packId: "conflicting-pack",
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(conflict.status).toBe(409);
    const names = await asApp(ORG, (client) =>
      client.query<{ name: string }>("SELECT name FROM skills WHERE org_id = $1", [ORG]),
    );
    expect(names.rows.map((row) => row.name)).toEqual(["Facilitation core"]);
    expect((await counts()).skills).toBe(1);
  });
});

describe("retry idempotency, immutable files, mounts, and tenant isolation", () => {
  it("returns the byte-equivalent original result for an identical retry and creates no duplicates", async () => {
    const request = {
      packId: PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    };
    const first = await importPack(ADMIN, request);
    const firstText = await first.text();
    expect(first.status).toBe(201);

    // A successful retry is served from durable provenance. It must not depend on the
    // deployment-side pack still being present or still having the same bytes.
    writePack({
      packId: PACK_ID,
      packVersion: PACK_VERSION,
      packDigestOverride: "f".repeat(64),
    });
    const retry = await importPack(ADMIN, request);
    writePack({ packId: PACK_ID, packVersion: PACK_VERSION });
    expect(retry.status).toBe(200);
    expect(await retry.text()).toBe(firstText);
    expect(await counts()).toEqual({
      skills: 1,
      skill_versions: 1,
      skill_version_files: 2,
      skill_mounts: 0,
      starter_pack_imports: 1,
    });
  });

  it("rejects reusing an idempotency key with a changed payload", async () => {
    const idempotencyKey = randomUUID();
    expect((await importPack(ADMIN, { packId: PACK_ID, packVersion: PACK_VERSION, idempotencyKey })).status)
      .toBe(201);
    const changed = await importPack(ADMIN, {
      packId: PACK_ID,
      packVersion: "bad-file",
      idempotencyKey,
    });
    expect(changed.status).toBe(409);
    expect((await counts()).skills).toBe(1);
  });

  it("database constraints make published versions/files immutable and mount paths unique per target", async () => {
    const result = await importPack(ADMIN, {
      packId: PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    }).then((response) => response.json()) as { skillIds: string[]; versionIds: string[] };
    const skillId = result.skillIds[0]!;
    const versionId = result.versionIds[0]!;

    await expect(asApp(ORG, (client) => client.query(
      `INSERT INTO skill_versions
        (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
       VALUES ('direct-published',$1,$2,'direct',$3,'{}'::jsonb,$4,now(),true)`,
      [ORG, skillId, "0".repeat(64), ADMIN],
    ))).rejects.toThrow(/draft/i);

    await asApp(ORG, (client) => client.query(
      `INSERT INTO skill_versions
        (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
       VALUES ('empty-draft',$1,$2,'empty',$3,'{}'::jsonb,$4,now(),false)`,
      [ORG, skillId, "1".repeat(64), ADMIN],
    ));
    await expect(asApp(ORG, (client) =>
      client.query("SELECT wave2_publish_skill_version($1, 'empty-draft')", [ORG]),
    )).rejects.toThrow(/root SKILL\.md/i);

    const candidateContent = Buffer.from("invalid path");
    for (const invalidPath of ["a//b", "./SKILL.md", "a/./b", "trailing/"]) {
      await expect(asApp(ORG, (client) => client.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,'empty-draft',$2,$3,'text/plain',$4)`,
        [ORG, invalidPath, candidateContent, sha256(candidateContent)],
      ))).rejects.toThrow(/check constraint/i);
    }

    const foreign = await importPack(ADMIN, {
      packId: PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    }, OTHER_ORG).then((response) => response.json()) as { versionIds: string[] };
    for (const foreignVersionId of ["missing-version", foreign.versionIds[0]!]) {
      await expect(asApp(ORG, (client) => client.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,$2,'probe.md',$3,'text/plain',$4)`,
        [OTHER_ORG, foreignVersionId, candidateContent, sha256(candidateContent)],
      ))).rejects.toThrow(/tenant does not match/i);
    }

    await expect(asApp(ORG, (client) =>
      client.query("UPDATE skill_versions SET semantic_label = '9.9.9' WHERE id = $1", [versionId]),
    )).rejects.toThrow(/permission|immutable/i);
    await expect(asApp(ORG, (client) =>
      client.query("UPDATE skill_version_files SET content = $2 WHERE version_id = $1", [versionId, Buffer.from("tampered")]),
    )).rejects.toThrow(/permission|immutable/i);
    // The migration owner bypasses grants, so these two assertions prove the database
    // trigger also refuses mutation rather than relying only on app-role permissions.
    await expect(asOwner((client) =>
      client.query("UPDATE skill_versions SET semantic_label = '9.9.9' WHERE id = $1", [versionId]),
    )).rejects.toThrow(/immutable/i);
    await expect(asOwner((client) =>
      client.query("UPDATE skill_version_files SET content = $2 WHERE version_id = $1", [versionId, Buffer.from("tampered")]),
    )).rejects.toThrow(/immutable/i);
    const addedContent = Buffer.from("late file");
    const insertLateFile = (client: { query(sql: string, params: unknown[]): Promise<unknown> }) =>
      client.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,$2,'late.md',$3,'text/markdown',$4)`,
        [ORG, versionId, addedContent, sha256(addedContent)],
      );
    await expect(asApp(ORG, insertLateFile)).rejects.toThrow(/immutable/i);
    await expect(asOwner(async (client) => {
      await client.query("SELECT set_config('app.current_org', $1, false)", [ORG]);
      return insertLateFile(client);
    })).rejects.toThrow(/immutable/i);

    // Publish and late-file insertion share the parent-version row lock. Once publish has
    // crossed the boundary, a concurrently queued file insert observes `published=true`.
    await asApp(ORG, async (client) => {
      await client.query(
        `INSERT INTO skill_versions
          (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
         VALUES ('concurrent-draft',$1,$2,'concurrent',$3,'{}'::jsonb,$4,now(),false)`,
        [ORG, skillId, "2".repeat(64), ADMIN],
      );
      const root = Buffer.from("# Concurrent\n");
      await client.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,'concurrent-draft','SKILL.md',$2,'text/markdown',$3)`,
        [ORG, root, sha256(root)],
      );
    });
    let releasePublish!: () => void;
    const holdPublish = new Promise<void>((resolve) => { releasePublish = resolve; });
    let publishLocked!: () => void;
    const publishHasLocked = new Promise<void>((resolve) => { publishLocked = resolve; });
    const publishing = asApp(ORG, async (client) => {
      await client.query("SELECT wave2_publish_skill_version($1, 'concurrent-draft')", [ORG]);
      publishLocked();
      await holdPublish;
    });
    await publishHasLocked;
    const concurrentLateInsert = asApp(ORG, (client) => client.query(
      `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
       VALUES ($1,'concurrent-draft','late.md',$2,'text/markdown',$3)`,
      [ORG, addedContent, sha256(addedContent)],
    ));
    const lateInsertRejected = expect(concurrentLateInsert).rejects.toThrow(/immutable/i);
    releasePublish();
    await publishing;
    await lateInsertRejected;

    await asApp(ORG, (client) => client.query(
      `INSERT INTO skill_mounts
        (id, org_id, target_kind, target_id, skill_id, skill_version_id, mount_path, enabled, mounted_by)
       VALUES ($1,$2,'project',$3,$4,$5,$6,true,$7)`,
      ["mount-1", ORG, `${ORG}-project`, skillId, versionId, "/skills/facilitation", ADMIN],
    ));
    await expect(asApp(ORG, (client) => client.query(
      `INSERT INTO skill_mounts
        (id, org_id, target_kind, target_id, skill_id, skill_version_id, mount_path, enabled, mounted_by)
       VALUES ($1,$2,'project',$3,$4,$5,$6,true,$7)`,
      ["mount-2", ORG, `${ORG}-project`, skillId, versionId, "/skills/facilitation", ADMIN],
    ))).rejects.toThrow(/unique|duplicate/i);

    for (const invalidPath of [
      "/skills/../escape",
      "/skills/a/../equivalent",
      "/skills//duplicate-separator",
      "/skills/trailing/",
    ]) {
      await expect(asApp(ORG, (client) => client.query(
        `INSERT INTO skill_mounts
          (id, org_id, target_kind, target_id, skill_id, skill_version_id, mount_path, enabled, mounted_by)
         VALUES ($1,$2,'project',$3,$4,$5,$6,true,$7)`,
        [`invalid-${sha256(invalidPath).slice(0, 8)}`, ORG, `${ORG}-project`, skillId, versionId, invalidPath, ADMIN],
      ))).rejects.toThrow(/check constraint/i);
    }

    const second = await importPack(ADMIN, {
      packId: "second-pack",
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    }).then((response) => response.json()) as { versionIds: string[] };
    await expect(asApp(ORG, (client) => client.query(
      `INSERT INTO skill_mounts
        (id, org_id, target_kind, target_id, skill_id, skill_version_id, mount_path, enabled, mounted_by)
       VALUES ('cross-skill-version',$1,'project',$2,$3,$4,'/skills/crossed',true,$5)`,
      [ORG, `${ORG}-project`, skillId, second.versionIds[0], ADMIN],
    ))).rejects.toThrow(/foreign key/i);
    expect((await counts()).skill_mounts).toBe(1);
  });

  it("keeps imports isolated by organization even for the same administrator and pack", async () => {
    const request = { packId: PACK_ID, packVersion: PACK_VERSION, idempotencyKey: randomUUID() };
    expect((await importPack(ADMIN, request, ORG)).status).toBe(201);
    expect((await importPack(ADMIN, request, OTHER_ORG)).status).toBe(201);
    expect((await counts(ORG)).skills).toBe(1);
    expect((await counts(OTHER_ORG)).skills).toBe(1);
  });
});
