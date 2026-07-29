/**
 * PostgreSQL implementation of `LocalExportRepository` (F17).
 *
 * ## The one thing worth reading in this file
 *
 * `commitExport` runs the copies AND both audit events in ONE transaction that re-points
 * `app.current_org` between the two tenants. That is unusual enough to justify:
 *
 *   · `set_config(..., true)` is TRANSACTION-local, so re-pointing it is not a leak -- the
 *     setting dies at COMMIT/ROLLBACK either way. `insertPersonalLocalOrg` already does this
 *     for the same structural reason (one atom, two tenants).
 *   · The alternative -- one transaction per side -- makes "the copy exists and the trail
 *     does not" a reachable state. V11④ says both sides are written; an export whose audit
 *     did not land must not have happened, and the only way to say that in a database is to
 *     put them in the same transaction.
 *
 * ⚠ The provenance INSERT is NOT written here. It comes from `ProvenanceWriter.appendWithin`,
 * because `provenance_events` is one table with one writer (coherence X-2), and a second
 * INSERT statement in this file would be a second answer to "how is an audit event written".
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ConsumedPreview,
  ExportCommitResult,
  ExportPlanItem,
  ExportVisibilitySubject,
  ExportableArtifact,
  ExportableVersion,
  LocalExportRepository,
} from "../../application/identity/local-export-ports";
import type { ProvenanceWriter } from "../../application/provenance/ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import { LOCAL_EXPORT_PREVIEW_TTL_MS, localExportUnvettedNote } from "../../domain/identity/local-export";
import type { OrgId } from "../../domain/org-id";

interface ArtifactRow {
  id: string;
  title: string;
  source: string;
  synthesized: boolean;
}

interface VersionRow {
  id: string;
  artifact_id: string;
  version_number: number;
  object_storage_key: string;
  content_hash: string;
  mime: string;
  size_bytes: string;
}

export class PgLocalExportRepository implements LocalExportRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly provenance: ProvenanceWriter,
  ) {}

  async findExportable(
    fromLocalOrgId: OrgId,
    artifactIds: readonly string[],
  ): Promise<readonly Guarded<ExportableArtifact>[]> {
    if (artifactIds.length === 0) return [];
    return this.db.withTenant(fromLocalOrgId, async (s) => {
      const arts = await s.query<ArtifactRow>(
        `SELECT id, title, source, synthesized
           FROM artifacts
          WHERE org_id = $1 AND id = ANY($2::text[])
          ORDER BY id`,
        [fromLocalOrgId, artifactIds],
      );
      if (arts.rows.length === 0) return [];

      const vers = await s.query<VersionRow>(
        `SELECT id, artifact_id, version_number, object_storage_key, content_hash, mime,
                size_bytes::text AS size_bytes
           FROM artifact_versions
          WHERE org_id = $1 AND artifact_id = ANY($2::text[])
          ORDER BY artifact_id, version_number`,
        [fromLocalOrgId, arts.rows.map((a) => a.id)],
      );
      const byArtifact = new Map<string, ExportableVersion[]>();
      for (const v of vers.rows) {
        const list = byArtifact.get(v.artifact_id) ?? [];
        list.push({
          versionId: v.id,
          versionNumber: v.version_number,
          objectStorageKey: v.object_storage_key,
          contentHash: v.content_hash,
          mime: v.mime,
          sizeBytes: Number(v.size_bytes),
        });
        byArtifact.set(v.artifact_id, list);
      }

      // ⚠ Wrapped, not returned raw. The preview shows TITLES to a caller, so this is a
      // disclosure path and goes through the one doorway (UC-0.3 R7). `sources` is empty:
      // an artifact is a first-class object, its scope is its own binding -- passing
      // anything here would claim a derivation that does not exist.
      return arts.rows.map((a) =>
        guard<ExportableArtifact>({ kind: "artifact", id: a.id }, {
          artifactId: a.id,
          title: a.title,
          source: a.source,
          synthesized: a.synthesized,
          versions: byArtifact.get(a.id) ?? [],
        }),
      );
    });
  }

  /**
   * Who ends up able to read a freshly imported item in the target organization.
   *
   * ⚠ Every member, and that is the honest answer rather than a lazy one: an imported
   * artifact arrives with NO `acl_bindings` row, and F04 records that an unbound object's
   * scope is the org-wide default. So "who will see this" really is "everybody here", and
   * that is precisely the fact the human is being asked to confirm. Showing a shorter list
   * would be showing them a permission model the copy does not have.
   */
  async previewVisibility(toOrgId: OrgId): Promise<readonly ExportVisibilitySubject[]> {
    return this.db.withTenant(toOrgId, async (s) => {
      const r = await s.query<{ user_id: string; org_role: string; team_id: string | null }>(
        `SELECT user_id, org_role, team_id
           FROM org_memberships
          WHERE org_id = $1
          ORDER BY user_id`,
        [toOrgId],
      );
      return r.rows.map((m) => ({
        // ⚠ `kind` is an open string in the contract (KNOWN_CONTRACT_GAPS.C_F17_3). The value
        // written here is the one `acl_bindings.subject_kind` uses, so the day the contract
        // closes the enum this does not have to change.
        kind: "user",
        id: m.user_id,
        name: m.team_id ? `${m.user_id}（${m.org_role} · ${m.team_id}）` : `${m.user_id}（${m.org_role}）`,
      }));
    });
  }

  async createPreview(input: {
    readonly fromLocalOrgId: OrgId;
    readonly toOrgId: string;
    readonly actorId: string;
    readonly artifactIds: readonly string[];
  }): Promise<{ readonly token: string; readonly issuedAtMs: number }> {
    const token = `xprv-${randomUUID()}`;
    return this.db.withTenant(input.fromLocalOrgId, async (s) => {
      const r = await s.query<{ created_at: Date }>(
        `INSERT INTO local_export_previews (token, org_id, to_org_id, actor_id, artifact_ids, expires_at)
         VALUES ($1, $2, $3, $4, $5::text[], date_trunc('milliseconds', now()) + ($6 || ' milliseconds')::interval)
         RETURNING created_at`,
        [token, input.fromLocalOrgId, input.toOrgId, input.actorId, input.artifactIds,
         String(LOCAL_EXPORT_PREVIEW_TTL_MS)],
      );
      const createdAt = r.rows[0]?.created_at;
      if (!createdAt) throw new Error("export preview insert returned no row");
      return { token, issuedAtMs: createdAt.getTime() };
    });
  }

  /**
   * Single-use, by conditional UPDATE.
   *
   * ⚠ `WHERE consumed_at IS NULL` is what makes it single-use, and it is inside the UPDATE
   * rather than in a preceding SELECT for the reason this project keeps rediscovering: a
   * read followed by a write is not atomic, and the case it loses -- two concurrent exports
   * both seeing "unused" -- produces two copies from one human confirmation, silently.
   *
   * ⚠ `actor_id = $3` too. A token is one PERSON's confirmation. Without it, anybody who
   * could observe a token could spend somebody else's decision.
   */
  async consumePreview(
    fromLocalOrgId: OrgId,
    token: string,
    actorId: string,
  ): Promise<ConsumedPreview | null> {
    return this.db.withTenant(fromLocalOrgId, async (s) => {
      const r = await s.query<{ to_org_id: string; artifact_ids: string[]; created_at: Date }>(
        `UPDATE local_export_previews
            SET consumed_at = date_trunc('milliseconds', now())
          WHERE token = $1 AND org_id = $2 AND actor_id = $3 AND consumed_at IS NULL
        RETURNING to_org_id, artifact_ids, created_at`,
        [token, fromLocalOrgId, actorId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        toOrgId: row.to_org_id,
        artifactIds: row.artifact_ids,
        issuedAtMs: row.created_at.getTime(),
      };
    });
  }

  async commitExport(input: {
    readonly fromLocalOrgId: OrgId;
    readonly toOrgId: OrgId;
    readonly actorId: string;
    readonly ownerDisplayId: string;
    readonly items: readonly ExportPlanItem[];
  }): Promise<ExportCommitResult> {
    const copies = input.items.map((i) => ({
      sourceArtifactId: i.sourceArtifactId,
      targetArtifactId: i.targetArtifactId,
    }));
    const note = localExportUnvettedNote(input.ownerDisplayId);

    // Opened against the SOURCE tenant, because the first things this atom does are READS of
    // local rows, and RLS only shows them under their own tenant. The setting is re-pointed
    // at the target ONCE, and the transaction ENDS there -- see the note on ordering below.
    return this.db.withTenant(input.fromLocalOrgId, async (s) => {
      // Citable structure, read while the source tenant is still in scope.
      const structure = await readSourceStructure(s, input.items);

      /**
       * ⚠ The LOCAL event is written FIRST, and the order is not stylistic -- it is forced by
       * a DEFERRED constraint plus RLS, and it cost a real debugging session to find.
       *
       * `segments`' I-7 check (`segment_has_anchor`, migration 0006) is a CONSTRAINT TRIGGER
       * DEFERRABLE INITIALLY DEFERRED: it runs at COMMIT, not at INSERT. Its body is a plain
       * `SELECT ... FROM anchors`, which means it runs **under whatever `app.current_org` the
       * transaction happens to be pointed at when it commits**.
       *
       * The first version wrote the target event, then re-pointed back to the local tenant
       * for the local event. Everything inserted cleanly; at COMMIT the deferred check ran
       * with the setting on the LOCAL organization, could not see the TARGET organization's
       * anchors, and raised "segment ... has no anchor" for rows whose anchors were sitting
       * right there in the same transaction. A correct copy, refused by an invariant it
       * satisfied.
       *
       * ⇒ A cross-tenant transaction must END in the tenant whose rows carry deferred
       *   constraints. So: local event first, then switch, then everything target-side.
       *   Nothing about atomicity changes -- it is still one transaction, and V11④ still
       *   holds in the form that matters: no audit, no export.
       */
      const localProvenanceEventId = await this.provenance.appendWithin(s, {
        orgId: input.fromLocalOrgId,
        type: "local-export",
        actorId: input.actorId,
        // `target` is the ORGANIZATION rather than one artifact: an export is one act
        // covering N items, and naming one of them would make the other N-1 findable only by
        // reading `detail`.
        target: { kind: "organization", id: input.fromLocalOrgId },
        detail: {
          direction: "outbound-to-organization",
          toOrgId: input.toOrgId,
          // ⚠ 复制而非迁移：the local rows are untouched, and saying so in the trail is what
          // lets a reader answer "did I lose anything" without going to look.
          movedLocalCopy: false,
          copies,
        },
      });

      // ⚠ Re-point, do not open a second transaction. `set_config(..., true)` is
      // transaction-local, so this is scoped to this atom and dies with it.
      await s.query("SELECT set_config('app.current_org', $1, true)", [input.toOrgId]);

      for (const item of input.items) {
        await copyArtifactInto(s, { ...input, item, note, structure });
      }

      const targetProvenanceEventId = await this.provenance.appendWithin(s, {
        orgId: input.toOrgId,
        type: "local-export",
        actorId: input.actorId,
        target: { kind: "organization", id: input.toOrgId },
        detail: {
          direction: "inbound-from-local-org",
          fromOrgId: input.fromLocalOrgId,
          // The note is the CONTRACT's sentence, not one composed here -- same string the
          // rows carry and the UI renders.
          unvettedNote: note,
          copies,
        },
      });

      return { localProvenanceEventId, targetProvenanceEventId };
    });
  }
}

/** Segments (with their anchors) of one source version. */
interface SourceSegment {
  readonly kind: string;
  readonly ordinal: number;
  readonly anchors: readonly { readonly kind: string; readonly locator: string }[];
}

/** sourceVersionId -> its segments. Read under the SOURCE tenant, before the switch. */
type SourceStructure = ReadonlyMap<string, readonly SourceSegment[]>;

async function readSourceStructure(
  s: TenantSession,
  items: readonly ExportPlanItem[],
): Promise<SourceStructure> {
  const versionIds = items.flatMap((i) => i.versions.map((v) => v.sourceVersionId));
  const out = new Map<string, SourceSegment[]>();
  if (versionIds.length === 0) return out;

  const r = await s.query<{
    artifact_version_id: string;
    kind: string;
    ordinal: number;
    anchor_kind: string | null;
    locator: string | null;
  }>(
    `SELECT sg.artifact_version_id, sg.kind, sg.ordinal,
            a.kind AS anchor_kind, a.locator
       FROM segments sg
       LEFT JOIN anchors a ON a.segment_id = sg.id
      WHERE sg.artifact_version_id = ANY($1::text[])
      ORDER BY sg.artifact_version_id, sg.ordinal, a.id`,
    [versionIds],
  );

  for (const row of r.rows) {
    const list = out.get(row.artifact_version_id) ?? [];
    let seg = list.find((x) => x.ordinal === row.ordinal);
    if (!seg) {
      seg = { kind: row.kind, ordinal: row.ordinal, anchors: [] };
      list.push(seg);
    }
    if (row.anchor_kind !== null && row.locator !== null) {
      (seg.anchors as { kind: string; locator: string }[]).push({
        kind: row.anchor_kind,
        locator: row.locator,
      });
    }
    out.set(row.artifact_version_id, list);
  }
  return out;
}

/**
 * One artifact's rows, into the target organization.
 *
 * Segments and anchors travel with the versions. Not for completeness: a copy without them
 * is a file the target organization cannot CITE, and an uncitable artifact in a product whose
 * whole point is "every conclusion can be traced to a segment" is a copy in name only.
 *
 * ⚠ `derived_representations` are deliberately NOT copied. They are OCR / ASR / summary /
 * embedding outputs produced by the LOCAL organization's local-only models, and re-deriving
 * them in the target organization is that organization's own act under its own model policy.
 * Copying them would carry a local model's output into an organization that never chose it.
 */
async function copyArtifactInto(
  s: TenantSession,
  input: {
    readonly fromLocalOrgId: OrgId;
    readonly toOrgId: OrgId;
    readonly actorId: string;
    readonly item: ExportPlanItem;
    readonly note: string;
    readonly structure: SourceStructure;
  },
): Promise<void> {
  const { item, toOrgId } = input;

  await s.query(
    `INSERT INTO artifacts
       (id, org_id, project_id, source, title, created_by, synthesized,
        imported_from_org_id, imported_from_artifact_id, imported_from_note)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9)`,
    [
      item.targetArtifactId, toOrgId, item.source, item.title, input.actorId, item.synthesized,
      // The three marks travel together -- migration 0016's CHECK refuses a half-filled row,
      // because a row that looks like it carries provenance but cannot name whose local
      // organization is worse than one that carries none.
      input.fromLocalOrgId, item.sourceArtifactId, input.note,
    ],
  );
  // `project_id` is NULL on purpose: which project this belongs to is a decision for the
  // target organization, and guessing it would file unvetted material into a live project.

  for (const v of item.versions) {
    await s.query(
      `INSERT INTO artifact_versions
         (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime,
          size_bytes, pinned_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        v.targetVersionId, toOrgId, item.targetArtifactId, v.versionNumber,
        // ⚠ A NEW key. `local/<orgId>/` is the addressable set of bytes that may not leave
        // the machine, and migration 0015's trigger refuses a real organization's row inside
        // it. The copy is no longer covered by that promise, and its key says so.
        v.targetObjectKey,
        // The hash is CARRIED, not recomputed: it is what makes "this is the same evidence"
        // checkable on the other side. A recomputed hash would agree with whatever arrived,
        // including a truncated transfer.
        v.contentHash, v.mime, v.sizeBytes, input.actorId,
      ],
    );

    for (const seg of input.structure.get(v.sourceVersionId) ?? []) {
      const targetSegmentId = `seg-imp-${randomUUID()}`;
      await s.query(
        `INSERT INTO segments (id, org_id, artifact_version_id, kind, ordinal)
         VALUES ($1,$2,$3,$4,$5)`,
        [targetSegmentId, toOrgId, v.targetVersionId, seg.kind, seg.ordinal],
      );
      for (const a of seg.anchors) {
        await s.query(
          `INSERT INTO anchors (id, org_id, segment_id, kind, locator) VALUES ($1,$2,$3,$4,$5)`,
          [`anc-imp-${randomUUID()}`, toOrgId, targetSegmentId, a.kind, a.locator],
        );
      }
    }
  }
}
