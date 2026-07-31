/**
 * Fixtures for the `files` bundle (F31).
 *
 * Real PostgreSQL, like every other fixture here. F31's entire claim is about a predicate that
 * runs in SQL under row-level security; an in-memory double would test the shape of the code
 * and none of the thing that can actually be wrong.
 *
 * Everything is written through the APP role inside a tenant transaction (`asApp`), never as
 * the owner. If a policy's WITH CHECK were wrong, owner-side inserts would sail through and
 * these tests would rest on rows production could never have written.
 *
 * ## ⚠ Artifact ids must be namespaced PER TEST FILE, not just per organization
 *
 * `db.ts` says "every test file owns its own org ids", and that is necessary but NOT
 * sufficient here: `artifacts.id` is a bare `text PRIMARY KEY` (migration 0006) with no
 * organization in the key. Two files in different tenants that both seed an artifact called
 * `a-open` collide on `artifacts_pkey` -- and only when vitest happens to run them at the same
 * time, so it looks like a flake rather than a name clash.
 *
 * That is not hypothetical: this file's first version used `a-open`, and so does
 * `tests/kernel/retrieval-five-channels.test.ts`. Every file alone was green; the full suite
 * failed with `duplicate key value violates unique constraint "artifacts_pkey"` in a beforeAll,
 * which reports as the whole FILE failing rather than as a fixture problem.
 *
 * So: prefix ids with something naming the file (`f31rls-`, `f31eq-`, `f31meta-`).
 */
import { asApp } from "./db";
import type { IngestionStatus } from "../../src/domain/files/ingestion-visibility";

export interface BrowserArtifactSpec {
  readonly orgId: string;
  readonly id: string;
  readonly projectId: string | null;
  /**
   * ⚠ Constrained by 0006's SEVEN-value CHECK, taken from the SIGNED `artifact.ArtifactSource`.
   * The prototype's eight values and `segment_text`'s eight values are two OTHER vocabularies
   * (XC-03 / files FS1, unruled). Fixtures use the contract's, because that is what the column
   * accepts -- not because the dispute is settled.
   */
  readonly source?: string;
  readonly title?: string;
  readonly agendaSegmentId?: string | null;
  readonly confidential?: boolean;
  readonly ingestionStatus?: IngestionStatus;
  readonly creator?: { kind: "user"; id: string } | { kind: "agent"; id: string; runId: string };
  /** Head-version size. A version is always created: F04 I-5 says a version with no bytes is not one. */
  readonly sizeBytes?: number;
  /** Indexed text, so the artifact is reachable through the retrieval channel. */
  readonly text?: string;
}

/**
 * Seed one artifact, its head version, a segment + anchor, and the retrieval index row.
 *
 * All five in ONE transaction, because `segments` carries a DEFERRED constraint requiring an
 * anchor at COMMIT (F04 I-7) -- a helper that inserted only the segment would be a helper that
 * always fails.
 */
export async function addBrowserArtifact(spec: BrowserArtifactSpec): Promise<void> {
  const creator = spec.creator ?? { kind: "user" as const, id: "u-seed" };
  const source = spec.source ?? "upload";
  const versionId = `${spec.id}-v1`;
  const segmentId = `${spec.id}-s1`;

  await asApp(spec.orgId, async (c) => {
    await c.query(
      `INSERT INTO artifacts
         (id, org_id, project_id, source, title, created_by, synthesized,
          agenda_segment_id, confidential, ingestion_status, creator_kind, agent_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        spec.id, spec.orgId, spec.projectId, source, spec.title ?? `artifact ${spec.id}`,
        creator.id, source === "ai-generated",
        spec.agendaSegmentId ?? null, spec.confidential ?? false,
        spec.ingestionStatus ?? "READY", creator.kind,
        creator.kind === "agent" ? creator.runId : null,
      ],
    );
    await c.query(
      `INSERT INTO artifact_versions
         (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime,
          size_bytes, pinned_by)
       VALUES ($1,$2,$3,1,$4,$5,'application/octet-stream',$6,$7)`,
      [
        versionId, spec.orgId, spec.id,
        `${spec.orgId}/artifacts/${spec.id}/v1/${versionId}`,
        // A syntactically valid SHA-256 -- the column constrains its shape, and "deadbeef"
        // would fail for a reason unrelated to what any of these tests assert.
        "0".repeat(64),
        spec.sizeBytes ?? 1024,
        creator.id,
      ],
    );
    await c.query(
      `INSERT INTO segments (id, org_id, artifact_version_id, kind, ordinal)
       VALUES ($1,$2,$3,'text',0)`,
      [segmentId, spec.orgId, versionId],
    );
    await c.query(
      `INSERT INTO anchors (id, org_id, segment_id, kind, locator) VALUES ($1,$2,$3,'page','1')`,
      [`${segmentId}-anchor`, spec.orgId, segmentId],
    );
    await c.query(
      // ⚠ `segment_text.source_type` has its OWN eight-value CHECK (migration 0009), which is
      // a THIRD vocabulary and equal to neither of the other two. `file` is a member of it;
      // that is the only reason it is used here.
      `INSERT INTO segment_text
         (segment_id, org_id, artifact_id, artifact_version_id, project_id, source_type,
          layer, private, lifecycle, content, tsv)
       VALUES ($1,$2,$3,$4,$5,'file','project',false,'effective',$6,''::tsvector)`,
      [segmentId, spec.orgId, spec.id, versionId, spec.projectId, spec.text ?? "seeded browser corpus token"],
    );
  });
}

/** Drop everything this bundle's fixtures wrote for the named artifacts, owner-side. */
export async function resetArtifacts(orgId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { asOwner } = await import("./db");
  await asOwner(async (c) => {
    // ON DELETE CASCADE carries versions / segments / anchors / segment_text with it.
    await c.query("DELETE FROM artifacts WHERE org_id = $1 AND id = ANY($2::text[])", [orgId, ids]);
  });
}
