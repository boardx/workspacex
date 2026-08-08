/**
 * `PgAssetFileRepository` -- #785, the first REAL (Postgres-backed) implementation of
 * `AssetFileRepository`. Covers `assetKind === "skill"` only; every other kind (`agent` /
 * `model` / `mcp` / `canvas-template` / `blueprint`) delegates to the injected fallback (in
 * practice `FixtureAssetFileRepository`) unchanged.
 *
 * ## Why not `agent` too (see issue #787)
 *
 * There is no `agent_version_files` table (or any persisted per-agent directory) anywhere in
 * this kernel today -- `agent`s in this codebase are governance/config rows (`04-agent`), not
 * a versioned file tree the way Skills are (`skills` / `skill_versions` / `skill_version_files`,
 * "model A", see `pg-skill-url-import-repository.ts`'s header). Building that table is a new
 * persistence surface with its own migration, immutability trigger, and publish path -- out of
 * this issue's scope, which is "wire the store that already exists". #787 tracks it.
 *
 * ## Model A only -- never `skill_contracts`
 *
 * Same warning as every other real skill-persistence file in this bundle: `skill_contracts` is
 * model B, edited in the back office, **never read by anything that executes a skill**. This
 * file reads/writes exclusively `skills` / `skill_versions` / `skill_version_files`.
 *
 * ## `assetId` = `skills.id`, resolved to its CURRENT published version
 *
 * `assetId` is a Skill's stable id, never a specific `skill_versions.id` -- confirmed against
 * `pg-skill-url-import-repository.ts` (`ImportSkillFromUrlResult.skillId`, not `versionId`, is
 * what a caller holds onto) and the URL-import/starter-import flows, which always resolve "the
 * skill" by `skills.id`. "Current" means the most recently created `skill_versions` row with
 * `published = true` for that `(org_id, skill_id)` -- `published` is never cleared on an older
 * version when a newer one publishes (the immutable trigger forbids it), so more than one row
 * can be `published = true` at once; `created_at DESC LIMIT 1` picks the live one.
 *
 * ## The write path: publish a whole new version, never `UPDATE`
 *
 * `skill_versions` / `skill_version_files` are immutable once published (`wave2_skill_immutable`
 * trigger, `wave2_skill_starter_import` migration) -- an `UPDATE` is not merely bad practice
 * here, it is a statement the database itself refuses to execute. `writeFile` / `deleteFile` /
 * `renameFile` therefore all funnel through `publishNewSnapshot`, which -- inside a single
 * `pg_advisory_xact_lock`-serialized transaction (same lock key convention as
 * `pg-skill-version-edit-repository.ts` / `pg-skill-url-import-repository.ts`: `hashtextextended
 * (skillId, 0)`) -- reads the CURRENT published version's COMPLETE file set, applies exactly
 * one change to it (the one the caller asked for), inserts every file (changed AND unchanged)
 * under a brand-new draft version, and publishes that draft via `wave2_publish_skill_version`
 * (the only legal publish path; it also re-validates "exactly one root `SKILL.md`", the DB's own
 * backstop for uc-23-3's I-6/I-7). The new version is a full snapshot, not a diff -- F143's own
 * invariant is "目录集合 = 运行时装载集合", and a runtime that mounts a skill version reads
 * ALL of `skill_version_files` for that version id (`pg-agent-run-repository.ts`), so a version
 * missing the untouched files would make the directory listing and the runtime load set drift
 * apart on the very next read, which is exactly what F143 exists to catch.
 *
 * ## `writeFile`'s return shape vs. what actually happened -- the one deliberate compression
 *
 * `AssetFileRepository.writeFile` returns a single `AssetFileContentRecord` (the record AT
 * `path`), even though under the hood a whole new `skill_versions` row was published. That
 * port shape is F142's signed-off contract and this issue does not change it -- so "a new
 * version was created" is real but invisible to the caller through this one return value.
 * What matters for correctness is NOT the return shape, it's that the NEXT `getDirectory` /
 * `readFile` against the same `assetId` resolves to the NEW version (because it is now the
 * most recent `published = true` row) -- i.e. the write is durable and immediately visible
 * through the read path, not just echoed back in the response. `pg-asset-file-repository
 * -real-persistence.test.ts` asserts this explicitly (reads a NEW connection/transaction after
 * the write, not the write's own transaction).
 *
 * ## `orgId` -- see `application/asset/ports.ts`'s 2026-08-09 header on why every method now
 * takes it (RLS: the app role has no `BYPASSRLS`, so there is no legal way to even ISSUE these
 * queries without a tenant to scope the transaction to).
 *
 * ## Known gap: `creator_id` attribution
 *
 * `AssetFileRepository`'s methods carry no `userId` (unlike, say, `PgSkillVersionEditRepository
 * .persist`, which takes an explicit `actorId`) -- `write-asset-file.ts` / `delete-asset-file.ts`
 * / `rename-asset-file.ts` all know `input.userId` at the use-case layer but never pass it down
 * this far. Threading it through would mean widening this port a second time in the same PR,
 * for a strictly lower-stakes reason than the `orgId` gap (that one was a security hole; this
 * one is a lost-attribution nit). Left as `ASSET_EDIT_ACTOR_ID`, a fixed placeholder, and
 * flagged here rather than silently guessed at -- a real fix threads `userId` through
 * `AssetFileRepository` the same way this PR threaded `orgId` through.
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  AssetDirectoryRecord,
  AssetFileContentRecord,
  AssetFileRepository,
  AssetKind,
  AssetRenamedFileRecord,
} from "../../application/asset/ports";
import type { OrgId } from "../../domain/org-id";
import { sha256 } from "../../domain/skill/starter-pack";

/** uc-23-3's fixed root file name for the `skill` `AssetKind` -- never mutated by this file. */
const SKILL_ROOT_FILE = "SKILL.md";

/** See the class header's "Known gap" note. */
const ASSET_EDIT_ACTOR_ID = "asset-directory-editor";

interface FileRow {
  readonly path: string;
  readonly content: Buffer;
  readonly media_type: string;
}

interface VersionRow {
  readonly id: string;
}

interface CountRow {
  readonly count: string;
}

interface WorkingFile {
  readonly body: string;
  readonly mediaType: string;
}

export class PgAssetFileRepository implements AssetFileRepository {
  constructor(
    private readonly db: DatabasePort,
    /** Non-`skill` kinds (and, for now, `agent` -- see the class header) delegate here. */
    private readonly fallback: AssetFileRepository,
  ) {}

  async getDirectory(orgId: OrgId, assetKind: AssetKind, assetId: string): Promise<AssetDirectoryRecord | null> {
    if (assetKind !== "skill") return this.fallback.getDirectory(orgId, assetKind, assetId);
    const files = await this.readCurrentSnapshot(orgId, assetId);
    if (files === null) return null;
    return {
      rootFile: SKILL_ROOT_FILE,
      entries: [...files.entries()].map(([path, f]) => ({ path, sizeBytes: Buffer.byteLength(f.body, "utf8") })),
    };
  }

  async readFile(
    orgId: OrgId,
    assetKind: AssetKind,
    assetId: string,
    path: string,
  ): Promise<AssetFileContentRecord | null> {
    if (assetKind !== "skill") return this.fallback.readFile(orgId, assetKind, assetId, path);
    const files = await this.readCurrentSnapshot(orgId, assetId);
    if (files === null) return null;
    const file = files.get(path);
    if (file === undefined) return null;
    return { sizeBytes: Buffer.byteLength(file.body, "utf8"), body: file.body };
  }

  async writeFile(
    orgId: OrgId,
    assetKind: AssetKind,
    assetId: string,
    path: string,
    body: string,
  ): Promise<AssetFileContentRecord | null> {
    if (assetKind !== "skill") return this.fallback.writeFile(orgId, assetKind, assetId, path, body);
    const next = await this.publishNewSnapshot(orgId, assetId, (files) => {
      const existing = files.get(path);
      if (existing === undefined) return null; // this port does not create new paths
      const copy = new Map(files);
      copy.set(path, { body, mediaType: existing.mediaType });
      return copy;
    });
    if (next === null) return null;
    const written = next.get(path)!;
    return { sizeBytes: Buffer.byteLength(written.body, "utf8"), body: written.body };
  }

  async deleteFile(orgId: OrgId, assetKind: AssetKind, assetId: string, path: string): Promise<string | null> {
    if (assetKind !== "skill") return this.fallback.deleteFile(orgId, assetKind, assetId, path);
    const next = await this.publishNewSnapshot(orgId, assetId, (files) => {
      if (!files.has(path)) return null;
      const copy = new Map(files);
      copy.delete(path);
      return copy;
    });
    if (next === null) return null;
    return path;
  }

  async renameFile(
    orgId: OrgId,
    assetKind: AssetKind,
    assetId: string,
    from: string,
    to: string,
  ): Promise<AssetRenamedFileRecord | null> {
    if (assetKind !== "skill") return this.fallback.renameFile(orgId, assetKind, assetId, from, to);
    const next = await this.publishNewSnapshot(orgId, assetId, (files) => {
      const existing = files.get(from);
      if (existing === undefined) return null;
      const copy = new Map(files);
      copy.delete(from);
      copy.set(to, existing);
      return copy;
    });
    if (next === null) return null;
    const renamed = next.get(to)!;
    return { path: to, sizeBytes: Buffer.byteLength(renamed.body, "utf8"), body: renamed.body };
  }

  /** `null` = no `skills` row for this `(org, id)`, or it has never published a version. */
  private async currentPublishedVersionId(
    orgId: OrgId,
    skillId: string,
    session: TenantSession,
  ): Promise<string | null> {
    const found = await session.query<VersionRow>(
      `SELECT id FROM skill_versions
        WHERE org_id = $1 AND skill_id = $2 AND published = true
        ORDER BY created_at DESC LIMIT 1`,
      [orgId, skillId],
    );
    return found.rows[0]?.id ?? null;
  }

  private async readCurrentSnapshot(orgId: OrgId, skillId: string): Promise<Map<string, WorkingFile> | null> {
    return this.db.withTenant(orgId, async (session) => {
      const versionId = await this.currentPublishedVersionId(orgId, skillId, session);
      if (versionId === null) return null;
      const rows = await session.query<FileRow>(
        `SELECT path, content, media_type FROM skill_version_files
          WHERE org_id = $1 AND version_id = $2 ORDER BY path`,
        [orgId, versionId],
      );
      return new Map(
        rows.rows.map((r) => [r.path, { body: Buffer.from(r.content).toString("utf8"), mediaType: r.media_type }]),
      );
    });
  }

  /**
   * Reads the current published snapshot, applies `mutate` (returning `null` means "the
   * requested change is impossible" -- unknown path, e.g.), and if a change resulted, publishes
   * it as a brand-new version carrying the WHOLE resulting file set. Returns the resulting
   * snapshot (post-mutation) on success, `null` on any "impossible" outcome (unknown skill,
   * no published version, or `mutate` itself declining).
   */
  private async publishNewSnapshot(
    orgId: OrgId,
    skillId: string,
    mutate: (files: ReadonlyMap<string, WorkingFile>) => Map<string, WorkingFile> | null,
  ): Promise<Map<string, WorkingFile> | null> {
    return this.db.withTenant(orgId, async (session) => {
      // Same lock convention as `pg-skill-version-edit-repository.ts` / `pg-skill-url-import
      // -repository.ts`: concurrent edits to the SAME skill must serialize, or two callers
      // compute the same `count(*)` and the same next `semantic_label`, and the unique
      // constraint only stops one of them after both have otherwise "succeeded".
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [skillId]);

      const versionId = await this.currentPublishedVersionId(orgId, skillId, session);
      if (versionId === null) return null;

      const rows = await session.query<FileRow>(
        `SELECT path, content, media_type FROM skill_version_files
          WHERE org_id = $1 AND version_id = $2 ORDER BY path`,
        [orgId, versionId],
      );
      const current = new Map<string, WorkingFile>(
        rows.rows.map((r) => [r.path, { body: Buffer.from(r.content).toString("utf8"), mediaType: r.media_type }]),
      );

      const next = mutate(current);
      if (next === null) return null;

      const counted = await session.query<CountRow>(
        `SELECT count(*)::text AS count FROM skill_versions WHERE org_id = $1 AND skill_id = $2`,
        [orgId, skillId],
      );
      const semanticLabel = `v${Number(counted.rows[0]?.count ?? "0") + 1}`;
      const newVersionId = `sv_${randomUUID()}`;
      const now = new Date().toISOString();

      // A version-level digest for "this exact file set" -- deterministic, and reuses the ONE
      // sha256 implementation this bundle already has (`domain/skill/starter-pack.ts`) rather
      // than a second hashing routine.
      const manifestDigest = sha256(
        [...next.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([path, f]) => `${path}\0${sha256(f.body)}`)
          .join("\n"),
      );

      await session.query(
        `INSERT INTO skill_versions
           (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id,
            created_at, published)
         VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,$7,false)`,
        [newVersionId, orgId, skillId, semanticLabel, manifestDigest, ASSET_EDIT_ACTOR_ID, now],
      );
      for (const [path, f] of next) {
        await session.query(
          `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [orgId, newVersionId, path, Buffer.from(f.body, "utf8"), f.mediaType, sha256(f.body)],
        );
      }
      // See file header: the only legal publish path. Also re-checks "exactly one root
      // SKILL.md", the DB's own backstop for this snapshot always being a complete, valid tree.
      await session.query("SELECT wave2_publish_skill_version($1, $2)", [orgId, newVersionId]);

      return next;
    });
  }
}
