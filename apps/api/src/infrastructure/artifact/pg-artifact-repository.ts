/**
 * PostgreSQL implementation of `ArtifactRepository`.
 *
 * Every query runs through `withTenant`, so RLS is the first line and the `org_id`
 * predicates are the second.
 *
 * `findSegments` returns `Guarded<SegmentRecord>` with `sources` naming the originating
 * artifact -- see the port for why, and `permission-filter.ts` for what makes it impossible
 * to unwrap without a decision. This file is the reason the guarded read path exists at all:
 * segments are the first tenant rows in the kernel that are DERIVED from something else, and
 * "the original is team-only but its segments are not" is the laundering bug R7 describes.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { guard, type Guarded } from "../../application/security/permission-filter";
import { DuplicateVersionNumberError } from "../../application/artifact/ports";
import type {
  AnchorKind,
  ArtifactRepository,
  ArtifactVersionRecord,
  DerivedKind,
  DerivedRepresentationRecord,
  NewArtifact,
  NewArtifactVersion,
  NewDerivedRepresentation,
  NewSegment,
  SegmentKind,
  SegmentRecord,
  VersionListEntry,
} from "../../application/artifact/ports";
import type { OrgId } from "../../domain/org-id";

/**
 * Is this a unique violation on one of the named constraints?
 *
 * Reads `code` and `constraint` off the driver's error rather than matching the message.
 * Messages are localised by `lc_messages` and reworded between major versions; the SQLSTATE
 * and the constraint name are contract.
 */
function isUniqueViolation(e: unknown, ...constraints: string[]): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && typeof err.constraint === "string" && constraints.includes(err.constraint);
}

export class PgArtifactRepository implements ArtifactRepository {
  constructor(private readonly db: DatabasePort) {}

  async createArtifact(a: NewArtifact): Promise<void> {
    // agenda_segment_id / confidential / ingestion_status are F35 additions to `NewArtifact`
    // (all optional). Explicit `?? <column default>` here rather than leaving them out of
    // the INSERT list, because "column has NOT NULL DEFAULT" and "caller supplied null"
    // must both resolve to the SAME value for every existing caller that predates them.
    await this.db.withTenant(a.orgId, (s) =>
      s.query(
        `INSERT INTO artifacts
           (id, org_id, project_id, source, title, created_by, synthesized,
            agenda_segment_id, confidential, ingestion_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          a.id, a.orgId, a.projectId, a.source, a.title, a.createdBy, a.synthesized,
          a.agendaSegmentId ?? null, a.confidential ?? false, a.ingestionStatus ?? "READY",
        ],
      ),
    );
  }

  async createVersion(v: NewArtifactVersion): Promise<void> {
    try {
      await this.db.withTenant(v.orgId, async (s) => {
        await s.query(
          `INSERT INTO artifact_versions
             (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime,
              size_bytes, pinned_by, context_pack_id, derived_from,
              creator_kind, agent_run_id, change_source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            v.id, v.orgId, v.artifactId, v.versionNumber, v.objectStorageKey, v.contentHash,
            v.mime, v.sizeBytes, v.pinnedBy, v.contextPackId, v.derivedFrom,
            // F44: undefined -> column default ('user' / NULL / 'materialize'), same
            // ?? convention F35 used for agendaSegmentId/confidential/ingestionStatus.
            v.creatorKind ?? "user", v.agentRunId ?? null, v.changeSource ?? "materialize",
          ],
        );

        // F36: same transaction as the version INSERT above -- see `NewArtifactVersion`'s
        // own doc comment for why that co-location is the whole point. `ON CONFLICT DO
        // NOTHING` on `ingestion_outbox_uniq_active` makes this call idempotent too: a retry
        // of the SAME `createVersion` (which cannot happen for the same version id today,
        // but a future caller that re-derives the same enqueue call must not double-queue)
        // is a no-op, not a duplicate job.
        if (v.enqueueIngestionOutboxStep != null) {
          await s.query(
            `INSERT INTO ingestion_outbox (org_id, artifact_id, artifact_version_id, step)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT ON CONSTRAINT ingestion_outbox_uniq_active DO NOTHING`,
            [v.orgId, v.artifactId, v.id, v.enqueueIngestionOutboxStep],
          );
        }
      });
    } catch (e) {
      // 23505 on either uniqueness rule is the same event seen from two angles: two writers
      // aimed at the same version number (`_uniq_number`), or at the same storage key
      // (`_uniq_key`, which is keyed on the version number too). Both mean the head moved.
      //
      // Narrowed to those two constraints on purpose. Catching bare 23505 would also swallow
      // a duplicate PRIMARY KEY -- a re-used version id, which is a caller bug -- and report
      // it as somebody else's concurrent pin, sending the user to press retry on something
      // that will fail identically forever.
      if (isUniqueViolation(e, "artifact_versions_uniq_number", "artifact_versions_uniq_key")) {
        throw new DuplicateVersionNumberError(v.artifactId, v.versionNumber);
      }
      throw e;
    }
    // No ON CONFLICT clause, deliberately. A duplicate (artifact_id, version_number) is a
    // concurrent pin, and swallowing it with DO NOTHING would report success for a write
    // that did not happen -- the caller would then hand out a version id that names
    // somebody else's row.
  }

  async headVersionNumber(orgId: OrgId, artifactId: string): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ n: string | null }>(
        `SELECT max(version_number)::text AS n FROM artifact_versions
          WHERE org_id = $1 AND artifact_id = $2`,
        [orgId, artifactId],
      );
      // `max()` over no rows is NULL, and 0 is the right answer: the next version is 1.
      return Number(r.rows[0]?.n ?? "0");
    });
  }

  async findVersion(orgId: OrgId, versionId: string): Promise<ArtifactVersionRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; artifact_id: string; version_number: number; object_storage_key: string;
        content_hash: string; mime: string; size_bytes: string; pinned_by: string;
        pinned_at: Date; context_pack_id: string | null;
      }>(
        `SELECT id, artifact_id, version_number, object_storage_key, content_hash, mime,
                size_bytes, pinned_by, pinned_at, context_pack_id
           FROM artifact_versions WHERE org_id = $1 AND id = $2`,
        [orgId, versionId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        artifactId: row.artifact_id,
        versionNumber: row.version_number,
        objectStorageKey: row.object_storage_key,
        contentHash: row.content_hash,
        mime: row.mime,
        // bigint arrives as a string from node-postgres. `Number` is applied once, here,
        // rather than wherever a caller happens to compare it -- `"12" > 9` is false.
        sizeBytes: Number(row.size_bytes),
        pinnedBy: row.pinned_by,
        pinnedAt: row.pinned_at.toISOString(),
        contextPackId: row.context_pack_id,
      };
    });
  }

  async addSegments(orgId: OrgId, segments: readonly NewSegment[]): Promise<void> {
    if (segments.length === 0) return;
    // ONE transaction for segments and their anchors, and that is load-bearing. I-7 is a
    // DEFERRED constraint checked at COMMIT: split across two transactions, the first one
    // commits a segment with no anchor and the constraint fires correctly -- so the atomicity
    // here is what makes the correct insert order possible at all.
    await this.db.withTenant(orgId, async (s) => {
      for (const seg of segments) {
        await s.query(
          `INSERT INTO segments (id, org_id, artifact_version_id, kind, ordinal)
           VALUES ($1,$2,$3,$4,$5)`,
          [seg.id, orgId, seg.artifactVersionId, seg.kind, seg.ordinal],
        );
        for (const a of seg.anchors) {
          await s.query(
            `INSERT INTO anchors (id, org_id, segment_id, kind, locator) VALUES ($1,$2,$3,$4,$5)`,
            [a.id, orgId, seg.id, a.kind, a.locator],
          );
        }
      }
    });
  }

  async findSegments(orgId: OrgId, versionId: string): Promise<readonly Guarded<SegmentRecord>[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; artifact_version_id: string; kind: string; ordinal: number;
        artifact_id: string; anchor_kinds: string[] | null; anchor_locators: string[] | null;
      }>(
        // The artifact id is joined in, not looked up afterwards: it is the `sources` entry
        // the guard needs, and a second round trip to fetch it is a round trip a caller can
        // decide to skip.
        `SELECT sg.id, sg.artifact_version_id, sg.kind, sg.ordinal, v.artifact_id,
                array_agg(a.kind ORDER BY a.id)    FILTER (WHERE a.id IS NOT NULL) AS anchor_kinds,
                array_agg(a.locator ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL) AS anchor_locators
           FROM segments sg
           JOIN artifact_versions v ON v.id = sg.artifact_version_id AND v.org_id = sg.org_id
           LEFT JOIN anchors a ON a.segment_id = sg.id AND a.org_id = sg.org_id
          WHERE sg.org_id = $1 AND sg.artifact_version_id = $2
          GROUP BY sg.id, sg.artifact_version_id, sg.kind, sg.ordinal, v.artifact_id
          ORDER BY sg.ordinal`,
        [orgId, versionId],
      );
      return r.rows.map((row) => {
        const kinds = row.anchor_kinds ?? [];
        const locators = row.anchor_locators ?? [];
        const record: SegmentRecord = {
          id: row.id,
          artifactVersionId: row.artifact_version_id,
          kind: row.kind as SegmentKind,
          ordinal: row.ordinal,
          anchors: kinds.map((k, i) => ({ kind: k as AnchorKind, locator: locators[i]! })),
        };
        // `sources` is the artifact, not the segment. I-13: a segment's effective scope is
        // its original's and may only be narrower, so the decision has to be made about the
        // original -- judging the segment on its own binding is how a team-only artifact's
        // text leaves through an unbound segment.
        return guard<SegmentRecord>(
          { kind: "segment", id: row.id },
          record,
          [{ kind: "artifact", id: row.artifact_id }],
        );
      });
    });
  }

  async listVersions(orgId: OrgId, artifactId: string): Promise<readonly VersionListEntry[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; version_number: number; pinned_at: Date; pinned_by: string;
        size_bytes: string; content_hash: string; creator_kind: string; agent_run_id: string | null;
        change_source: string;
      }>(
        `SELECT id, version_number, pinned_at, pinned_by, size_bytes, content_hash,
                creator_kind, agent_run_id, change_source
           FROM artifact_versions
          WHERE org_id = $1 AND artifact_id = $2
          ORDER BY version_number DESC`,
        [orgId, artifactId],
      );
      return r.rows.map((row) => ({
        versionId: row.id,
        versionNumber: row.version_number,
        createdAt: row.pinned_at.toISOString(),
        creator: {
          type: row.creator_kind as "user" | "agent",
          id: row.pinned_by,
          agentRunId: row.agent_run_id,
        },
        sizeBytes: Number(row.size_bytes),
        sha256: row.content_hash,
        changeSource: row.change_source as "upload" | "materialize" | "rerun",
      }));
    });
  }

  async createDerived(d: NewDerivedRepresentation): Promise<void> {
    // No ON CONFLICT, same reasoning as `createVersion`: this only ever INSERTs a NEW row
    // (A4 -- a rerun is a new derived version, never an update of the old one), and the
    // `derived_key_not_an_original` trigger (0006) is what refuses a key collision with an
    // original outright rather than silently reusing it.
    await this.db.withTenant(d.orgId, (s) =>
      s.query(
        `INSERT INTO derived_representations
           (id, org_id, derived_from, kind, object_storage_key, model, model_version, pipeline_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          d.id, d.orgId, d.derivedFrom, d.kind, d.objectStorageKey,
          d.generatorModel, d.generatorVersion, d.pipelineVersion,
        ],
      ),
    );
  }

  async listDerived(orgId: OrgId, artifactId: string): Promise<readonly DerivedRepresentationRecord[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; derived_from: string; kind: string; object_storage_key: string | null;
        model: string | null; model_version: string | null; pipeline_version: string | null;
        created_at: Date;
      }>(
        // Joined through artifact_versions rather than filtered by a denormalised
        // artifact_id column on derived_representations: N-15 is precisely that this table
        // only knows its VERSION, and a shortcut column here would be the second declaration
        // of "which artifact" the whole point of `derived_from` is to avoid.
        `SELECT d.id, d.derived_from, d.kind, d.object_storage_key, d.model, d.model_version,
                d.pipeline_version, d.created_at
           FROM derived_representations d
           JOIN artifact_versions v ON v.id = d.derived_from AND v.org_id = d.org_id
          WHERE d.org_id = $1 AND v.artifact_id = $2
          ORDER BY d.created_at DESC`,
        [orgId, artifactId],
      );
      return r.rows.map((row) => ({
        id: row.id,
        derivedFrom: row.derived_from,
        kind: row.kind as DerivedKind,
        objectStorageKey: row.object_storage_key,
        generatorModel: row.model ?? "",
        generatorVersion: row.model_version ?? "",
        pipelineVersion: row.pipeline_version ?? "",
        createdAt: row.created_at.toISOString(),
      }));
    });
  }
}
