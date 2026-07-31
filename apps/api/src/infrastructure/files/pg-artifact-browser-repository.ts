/**
 * PostgreSQL implementation of the file browser's reads (F31).
 *
 * Dependency inversion: this file imports the application-layer port in order to implement it.
 *
 * ## Every query goes through `wsx_visible_artifacts()` -- including search
 *
 * That is the feature. `VISIBLE` below is a single string constant used by all three reads,
 * so "the list and the search agree" is not a property somebody maintains; it is a property
 * of there being one FROM clause. A second reader that wrote its own predicate would be the
 * exact drift F31's acceptance is about, and it would pass every test that only looked at one
 * side.
 *
 * ## Nothing here filters by permission a second time
 *
 * Rows are wrapped in `Guarded<T>` -- that is the doorway `lint-permission-paths` requires and
 * `permission-filter` provides -- but the decision they are unwrapped with is the
 * REQUESTER-level one the use case already made. There is no per-row re-judgement, because a
 * per-row re-judgement would silently cover for a broken or missing SQL predicate. See the
 * counter-proof in `tests/files/artifacts-list-rls.test.ts`, which neuters
 * `wsx_visible_artifacts` inside a rolled-back transaction and requires the forbidden row to
 * appear in the payload.
 *
 * ## Tenant scoping is doubled on purpose
 *
 * `withTenant` sets `app.current_org` (RLS, the first line) and every query also carries an
 * explicit `org_id = $1` (the second). Same convention as `pg-segment-retriever.ts`: RLS is
 * the guarantee, the predicate is the thing a reader can see.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ArtifactBrowserRepository,
  ArtifactBrowserRow,
  ArtifactSearchHitRow,
  ListVisibleInput,
} from "../../application/files/ports";
import type { IngestionStatus } from "../../domain/files/ingestion-visibility";
import type { AnchorKind } from "../../application/artifact/ports";
import { guard, type Guarded } from "../../application/security/permission-filter";

/**
 * The visible set, once.
 *
 * `$1` org, `$2` project, `$3` requester's org team (nullable). `wsx_visible_artifacts` runs
 * SECURITY INVOKER, so RLS applies to it exactly as it applies to a direct read -- asserted in
 * `artifacts-list-rls.test.ts` rather than trusted.
 */
const VISIBLE = `
  FROM wsx_visible_artifacts($2, $3) vis
  JOIN artifacts a ON a.id = vis.artifact_id AND a.org_id = $1`;

/** The head version supplies size and the last write time. */
const HEAD_VERSION = `
  LEFT JOIN LATERAL (
    SELECT av.size_bytes, av.pinned_at
      FROM artifact_versions av
     WHERE av.artifact_id = a.id AND av.org_id = a.org_id
     ORDER BY av.version_number DESC
     LIMIT 1
  ) v ON true`;

const ROW_COLUMNS = `
  a.id, a.title, a.source, a.agenda_segment_id, a.confidential, a.ingestion_status,
  COALESCE(v.size_bytes, 0) AS size_bytes,
  GREATEST(a.created_at, COALESCE(v.pinned_at, a.created_at)) AS updated_at`;

interface Row {
  id: string;
  title: string;
  source: string;
  agenda_segment_id: string | null;
  confidential: boolean;
  ingestion_status: string;
  /** `bigint` arrives as a string from node-postgres. Converted once, here. */
  size_bytes: string | number;
  updated_at: Date;
}

interface SearchRow extends Row {
  snippet: string | null;
  anchor_kind: string | null;
  anchor_locator: string | null;
}

function toSearchGuarded(row: SearchRow): Guarded<ArtifactSearchHitRow> {
  const record: ArtifactSearchHitRow = {
    artifactId: row.id,
    name: row.title,
    sourceType: row.source,
    agendaSegmentId: row.agenda_segment_id,
    sizeBytes: Number(row.size_bytes),
    confidential: row.confidential,
    ingestionStatus: row.ingestion_status as IngestionStatus,
    updatedAt: row.updated_at.toISOString(),
    snippet: row.snippet,
    anchorKind: row.anchor_kind as AnchorKind | null,
    anchorLocator: row.anchor_locator,
  };
  return guard<ArtifactSearchHitRow>({ kind: "artifact", id: row.id }, record);
}

function toGuarded(row: Row): Guarded<ArtifactBrowserRow> {
  const record: ArtifactBrowserRow = {
    artifactId: row.id,
    name: row.title,
    sourceType: row.source,
    agendaSegmentId: row.agenda_segment_id,
    sizeBytes: Number(row.size_bytes),
    confidential: row.confidential,
    ingestionStatus: row.ingestion_status as IngestionStatus,
    updatedAt: row.updated_at.toISOString(),
  };
  // A first-class object: `sources` is empty, because an artifact's scope IS its own. Derived
  // objects (segments, embeddings) name their originals -- that is `pg-segment-retriever.ts`.
  return guard<ArtifactBrowserRow>({ kind: "artifact", id: row.id }, record);
}

/**
 * The keyset cursor: `<iso timestamp>|<artifact id>`.
 *
 * A composite, not a bare id, because the order is `created_at DESC, id DESC` and two
 * artifacts can share a timestamp. An offset would be worse than either: rows inserted during
 * paging shift it, and the symptom is a file the user never sees rather than an error.
 */
function decodeCursor(cursor: string | null): { ts: string; id: string } | null {
  if (cursor === null) return null;
  const at = cursor.lastIndexOf("|");
  if (at <= 0) return null;
  return { ts: cursor.slice(0, at), id: cursor.slice(at + 1) };
}

export function encodeCursor(row: { updatedAt: string; artifactId: string }): string {
  return `${row.updatedAt}|${row.artifactId}`;
}

export class PgArtifactBrowserRepository implements ArtifactBrowserRepository {
  constructor(private readonly db: DatabasePort) {}

  async listVisible(input: ListVisibleInput): Promise<readonly Guarded<ArtifactBrowserRow>[]> {
    const f = input.filters;
    const cur = decodeCursor(input.cursor);
    return this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT ${ROW_COLUMNS}
         ${VISIBLE}
         ${HEAD_VERSION}
          WHERE ($4::text[]  IS NULL OR a.source            = ANY($4))
            AND ($5::text[]  IS NULL OR a.agenda_segment_id = ANY($5))
            AND ($6::timestamptz IS NULL OR a.created_at >= $6)
            AND ($7::timestamptz IS NULL OR a.created_at <= $7)
            AND ($8::text  IS NULL OR (a.creator_kind = $8 AND a.created_by = $9))
            AND ($10::boolean IS NULL OR a.confidential = $10)
            AND ($11::text[] IS NULL OR a.ingestion_status = ANY($11))
            AND ($12::timestamptz IS NULL
                 OR (a.created_at, a.id) < ($12::timestamptz, $13::text))
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $14`,
        [
          input.orgId, input.projectId, input.requesterTeamId,
          emptyToNull(f?.sourceType), emptyToNull(f?.agendaSegmentId),
          f?.timeRange?.from ?? null, f?.timeRange?.to ?? null,
          f?.uploader?.type ?? null, f?.uploader?.id ?? null,
          f?.confidential ?? null, emptyToNull(f?.ingestionState),
          cur?.ts ?? null, cur?.id ?? null,
          input.pageSize,
        ],
      );
      return r.rows.map(toGuarded);
    });
  }

  /**
   * Search: filename OR extracted text, over THE SAME visible set.
   *
   * ⚠ Not `LEFT JOIN segment_text ... DISTINCT` any more (F33). That shape matched the F31
   * claim (「visible ≡ searchable」, an ARTIFACT-set property) but had no way to also carry
   * ONE snippet per artifact -- a flat join can produce several matching segment rows per
   * artifact, and `DISTINCT` over the whole row would either explode into duplicates (if a
   * per-row snippet column were added) or require picking a winner outside SQL. Instead the
   * best match is chosen INSIDE a `LATERAL` subquery (highest `ts_rank`, one row), and artifact
   * visibility is still decided by the same EXISTS-shaped predicate the old DISTINCT query
   * expressed implicitly -- an artifact with no indexed content still matches by filename via
   * `a.title ILIKE`.
   *
   * `ts_headline` runs against `wsx_tsquery`, the SAME tokenizer/query function the index and
   * `WHERE` use (0009's header on why one-sided tokenization is the classic silent-FTS-miss
   * bug) -- so a headline is never produced for a query the index could not have matched in
   * the first place.
   *
   * Snippet/anchor are returned RAW (not yet gated for confidential material); see
   * `ports.ts`'s `searchVisible` doc comment for where T-6's fail-closed branch is applied.
   */
  async searchVisible(
    input: Omit<ListVisibleInput, "cursor"> & { readonly query: string },
  ): Promise<readonly Guarded<ArtifactSearchHitRow>[]> {
    return this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<SearchRow>(
        `SELECT ${ROW_COLUMNS}, hit.snippet, hit.anchor_kind, hit.anchor_locator
         ${VISIBLE}
         ${HEAD_VERSION}
          LEFT JOIN LATERAL (
            SELECT ts_headline('simple', st.content, wsx_tsquery($4)) AS snippet,
                   anc.kind AS anchor_kind, anc.locator AS anchor_locator
              FROM segment_text st
              LEFT JOIN anchors anc ON anc.segment_id = st.segment_id AND anc.org_id = st.org_id
             WHERE st.artifact_id = a.id AND st.org_id = a.org_id AND st.tsv @@ wsx_tsquery($4)
             ORDER BY ts_rank(st.tsv, wsx_tsquery($4)) DESC
             LIMIT 1
          ) hit ON true
          WHERE (
            hit.snippet IS NOT NULL
            OR a.title ILIKE '%' || $4 || '%'
          )
          ORDER BY updated_at DESC, a.id DESC
          LIMIT $5`,
        [input.orgId, input.projectId, input.requesterTeamId, input.query, input.pageSize],
      );
      return r.rows.map(toSearchGuarded);
    });
  }

  async treeRows(
    input: Omit<ListVisibleInput, "cursor" | "pageSize" | "filters">,
  ): Promise<readonly Guarded<Pick<ArtifactBrowserRow, "artifactId" | "sourceType" | "agendaSegmentId">>[]> {
    return this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<{ id: string; source: string; agenda_segment_id: string | null }>(
        `SELECT a.id, a.source, a.agenda_segment_id
         ${VISIBLE}
          ORDER BY a.id`,
        [input.orgId, input.projectId, input.requesterTeamId],
      );
      return r.rows.map((row) =>
        guard({ kind: "artifact", id: row.id }, {
          artifactId: row.id,
          sourceType: row.source,
          agendaSegmentId: row.agenda_segment_id,
        }),
      );
    });
  }
}

/**
 * `[]` means "not filtering", not "match nothing".
 *
 * The contract types these as plain arrays with no nullable wrapper, so an absent filter
 * arrives as `[]`. Passing `[]` straight to `= ANY(...)` matches zero rows -- i.e. an empty
 * filter would empty the browser, and it would look exactly like a permission denial.
 */
function emptyToNull(v: readonly string[] | undefined): string[] | null {
  return v === undefined || v.length === 0 ? null : [...v];
}
