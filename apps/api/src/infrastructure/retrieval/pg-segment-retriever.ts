/**
 * PostgreSQL implementation of the five recall channels.
 *
 * Every query runs inside `withTenant`, so RLS is the first line and the explicit `org_id`
 * predicate is the second. Every row comes back as `Guarded<CandidateRow>` whose `sources`
 * names the originating ARTIFACT -- F04 I-13: a segment's effective scope is its original's and
 * may only be narrower, so the decision has to be made about the original. Judging a segment on
 * its own binding is how a team-only artifact's text leaves through an unbound segment.
 *
 * ## The candidate set is constructed in SQL, and that is where I-8 lives
 *
 * `CANDIDATE_SET` below excludes personal-layer private notes with a predicate, not with a
 * later filter. That placement is the whole of invariant I-8 and it is not stylistic:
 *
 *   * I-2 says every candidate that does not become an item must be explained in `omissions[]`.
 *   * I-8 says a personal private note appears in NEITHER `items[]` NOR `omissions[].ref`,
 *     because an omission record leaks that the note exists.
 *
 * The two are compatible only if such notes are never candidates (coherence E-5; the handoff
 * note at the top of `application/context-pack/build-items.ts` addresses exactly this to F10).
 * Filtering them out after recall satisfies I-8's letter for `items[]` and violates it for
 * `omissions[]`, and the diff between the two versions is one line.
 *
 * ## Revoked rows are NOT excluded here
 *
 * They are returned and dropped in `retrieve-candidates.ts`, after disclosure, so that a
 * `withdrawn` omission can be emitted for them (R3 "排除" + I-2/I-4). Excluding them in SQL
 * would be tidier and would make a permanently-excluded document indistinguishable from one
 * that never existed -- which is the state "被丢弃不等于不存在" forbids. The ordering matters
 * too: the omission is emitted only after the requester has been judged, or its existence
 * leaks to somebody with no access at all.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  CandidateRow,
  ChannelQuery,
  ClaimChannelResult,
  ClaimHit,
  ClaimStatus,
  ContextSourceType,
  Lifecycle,
  SegmentRetriever,
} from "../../application/retrieval/ports";
import { guard, type Guarded } from "../../application/security/permission-filter";

/** Columns every channel selects, so one mapper serves all five. */
const COLUMNS = `
  st.segment_id, st.artifact_id, st.artifact_version_id, st.project_id, st.source_type,
  st.content, st.lifecycle, st.in_scope, st.confidential, st.occurred_at, st.method, st.cohort`;

interface Row {
  segment_id: string;
  artifact_id: string;
  artifact_version_id: string;
  project_id: string | null;
  source_type: string;
  content: string;
  lifecycle: string;
  in_scope: boolean;
  confidential: boolean;
  occurred_at: Date;
  method: string | null;
  cohort: string | null;
  channel_score: string | number | null;
}

function toGuarded(row: Row): Guarded<CandidateRow> {
  const record: CandidateRow = {
    segmentId: row.segment_id,
    artifactId: row.artifact_id,
    artifactVersionId: row.artifact_version_id,
    projectId: row.project_id,
    sourceType: row.source_type as ContextSourceType,
    content: row.content,
    lifecycle: row.lifecycle as Lifecycle,
    inScope: row.in_scope,
    confidential: row.confidential,
    occurredAt: row.occurred_at.toISOString(),
    method: row.method,
    cohort: row.cohort,
    // `numeric`/`real` arrive as strings from node-postgres. Converted once, here, rather than
    // wherever a caller happens to compare -- `"0.9" > 0.5` is a string comparison.
    channelScore: Number(row.channel_score ?? 0),
  };
  return guard<CandidateRow>({ kind: "segment", id: row.segment_id }, record, [
    { kind: "artifact", id: row.artifact_id },
  ]);
}

/**
 * The shared candidate-set predicate. `$1` org, `$2` project (nullable).
 *
 * `project_id IS NULL AND layer = 'org'` covers A1 ("not attached to any project"): the
 * organization layer is always in scope, the project layer is only in scope when there is a
 * project. Personal-layer content is in scope only when it is not private -- i.e. only what the
 * owner explicitly raised, which is the rule R3 step 2 states.
 */
const CANDIDATE_SET = `
  st.org_id = $1
  AND NOT (st.layer = 'personal' AND st.private)
  AND ($2::text IS NULL OR st.project_id = $2 OR st.layer <> 'project')`;

export class PgSegmentRetriever implements SegmentRetriever {
  constructor(private readonly db: DatabasePort) {}

  /**
   * Full-text. AND over every token (`wsx_tsquery`), which is what makes this the exact-match
   * channel rather than a worse version of the vector channel -- see migration 0009.
   */
  async fts(q: ChannelQuery): Promise<readonly Guarded<CandidateRow>[]> {
    return this.db.withTenant(q.orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT ${COLUMNS}, ts_rank(st.tsv, wsx_tsquery($3)) AS channel_score
           FROM segment_text st
          WHERE ${CANDIDATE_SET}
            AND st.tsv @@ wsx_tsquery($3)
          ORDER BY channel_score DESC, st.segment_id
          LIMIT $4`,
        [q.orgId, q.projectId, q.query, q.limit],
      );
      return r.rows.map(toGuarded);
    });
  }

  /**
   * pgvector nearest neighbours.
   *
   * ⚠ EXACT scan: there is no ANN index (migration 0009 explains why -- no embedding model has
   * been chosen, so any fixed dimension would be invented). The permission predicate and the
   * distance ordering therefore run over the same set, which is exactly the configuration in
   * which "approximate recall then filter" cannot lose an entitled row. When an ANN index
   * arrives, this stops being true and `pgvector-permission-recall.test.ts` goes red -- that
   * test asserts the absence of the index for this reason.
   */
  async vector(
    q: ChannelQuery,
    embedding: readonly number[],
    model: { model: string; modelVersion: string },
  ): Promise<readonly Guarded<CandidateRow>[]> {
    if (embedding.length === 0) return [];
    // pgvector's text input format. Built here rather than passed as an array so the cast is
    // explicit and a dimension mismatch fails at the query with pgvector's own message.
    const vec = `[${embedding.join(",")}]`;
    return this.db.withTenant(q.orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT ${COLUMNS}, 1 - (se.embedding <=> $3::vector) AS channel_score
           FROM segment_text st
           JOIN segment_embeddings se
             ON se.segment_id = st.segment_id
            AND se.org_id = st.org_id
            AND se.model = $4 AND se.model_version = $5
          WHERE ${CANDIDATE_SET}
          ORDER BY se.embedding <=> $3::vector, st.segment_id
          LIMIT $6`,
        [q.orgId, q.projectId, vec, model.model, model.modelVersion, q.limit],
      );
      return r.rows.map(toGuarded);
    });
  }

  /**
   * Graph traversal over `ontology_edges` -- a recursive CTE, not Apache AGE (usecases.md:
   * AGE is explicitly not enabled in phase one).
   *
   * Depth is capped at 2. Not a performance guard: at depth 3 nearly everything in a connected
   * project is reachable from nearly everything else, so an uncapped traversal returns the
   * whole corpus with a fixed bonus attached -- which is graph-first by accident, the thing
   * `context-engine.md` overturned.
   */
  async graph(
    q: ChannelQuery,
    seeds: readonly { kind: string; id: string }[],
  ): Promise<readonly Guarded<CandidateRow>[]> {
    if (seeds.length === 0) return [];
    const kinds = seeds.map((s) => s.kind);
    const ids = seeds.map((s) => s.id);
    return this.db.withTenant(q.orgId, async (s) => {
      const r = await s.query<Row>(
        `WITH RECURSIVE reached(kind, id, depth) AS (
             SELECT k, i, 0
               FROM unnest($3::text[], $4::text[]) AS seed(k, i)
           UNION
             SELECT e.dst_kind, e.dst_id, reached.depth + 1
               FROM ontology_edges e
               JOIN reached ON e.src_kind = reached.kind AND e.src_id = reached.id
              WHERE e.org_id = $1 AND reached.depth < 2
         )
         SELECT ${COLUMNS}, 1.0 AS channel_score
           FROM segment_text st
           JOIN reached ON reached.kind = 'segment' AND reached.id = st.segment_id
          WHERE ${CANDIDATE_SET}
          ORDER BY st.segment_id
          LIMIT $5`,
        [q.orgId, q.projectId, kinds, ids, q.limit],
      );
      // Every hit scores the same. The graph gives a FIXED bonus and never decides a result on
      // its own (R3 "线索"); a per-path score would be the knob that lets it decide.
      return r.rows.map(toGuarded);
    });
  }

  /**
   * Metadata: time range, research method, respondent cohort.
   *
   * Matching is on the method/cohort COLUMNS against the query text, not on the content: this
   * channel exists to answer "上个月能源组做的访谈" by structure, and if it fell back to
   * matching content it would be a second, worse full-text channel and its hits would look like
   * independent corroboration in the fusion.
   */
  async metadata(q: ChannelQuery): Promise<readonly Guarded<CandidateRow>[]> {
    return this.db.withTenant(q.orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT ${COLUMNS}, extract(epoch FROM st.occurred_at) AS channel_score
           FROM segment_text st
          WHERE ${CANDIDATE_SET}
            AND ($3::timestamptz IS NULL OR st.occurred_at >= $3)
            AND ($4::timestamptz IS NULL OR st.occurred_at <= $4)
            AND (
              (st.method IS NOT NULL AND $5 ILIKE '%' || st.method || '%')
              OR (st.cohort IS NOT NULL AND $5 ILIKE '%' || st.cohort || '%')
              -- A time range on its own is a complete metadata query; requiring a method or a
              -- cohort as well would make "上个月的材料" unanswerable by this channel.
              OR ($3::timestamptz IS NOT NULL OR $4::timestamptz IS NOT NULL)
            )
          ORDER BY st.occurred_at DESC, st.segment_id
          LIMIT $6`,
        [q.orgId, q.projectId, q.timeRange?.from ?? null, q.timeRange?.to ?? null, q.query, q.limit],
      );
      return r.rows.map(toGuarded);
    });
  }

  /**
   * Reviewed insights and decisions, with the evidence on BOTH sides.
   *
   * The claim query and the evidence query are separate round trips on purpose: the claims come
   * back whole, including `contradicting` ids whose segments the requester may not be allowed to
   * read. That is correct -- `ClaimRef.contradictingSegmentIds` is not permitted to be narrowed
   * to what survived (I-12) -- and it is why the SEGMENTS are fetched through the guarded path
   * separately. The ids are references; the text is the thing permission governs.
   */
  async claim(q: ChannelQuery): Promise<ClaimChannelResult> {
    return this.db.withTenant(q.orgId, async (s) => {
      const claimRows = await s.query<{
        id: string; statement: string; status: string;
        supporting: string[] | null; contradicting: string[] | null;
      }>(
        `SELECT c.id, c.statement, c.status,
                array_agg(cs.segment_id ORDER BY cs.segment_id)
                  FILTER (WHERE cs.stance = 'supporting')    AS supporting,
                array_agg(cs.segment_id ORDER BY cs.segment_id)
                  FILTER (WHERE cs.stance = 'contradicting') AS contradicting
           FROM claims c
           LEFT JOIN claim_segments cs ON cs.claim_id = c.id AND cs.org_id = c.org_id
          WHERE c.org_id = $1
            AND ($2::text IS NULL OR c.project_id = $2 OR c.project_id IS NULL)
            AND c.tsv @@ wsx_tsquery($3)
          GROUP BY c.id, c.statement, c.status
          ORDER BY c.id
          LIMIT $4`,
        [q.orgId, q.projectId, q.query, q.limit],
      );

      const claims: ClaimHit[] = claimRows.rows.map((c) => ({
        claimId: c.id,
        statement: c.statement,
        status: c.status as ClaimStatus,
        supportingSegmentIds: c.supporting ?? [],
        contradictingSegmentIds: c.contradicting ?? [],
      }));

      const cited = [...new Set(claims.flatMap((c) => [...c.supportingSegmentIds, ...c.contradictingSegmentIds]))];
      if (cited.length === 0) return { claims, candidates: [] };

      const segs = await s.query<Row>(
        `SELECT ${COLUMNS}, 1.0 AS channel_score
           FROM segment_text st
          WHERE ${CANDIDATE_SET}
            AND st.segment_id = ANY($3::text[])
          ORDER BY st.segment_id
          LIMIT $4`,
        [q.orgId, q.projectId, cited, q.limit],
      );
      return { claims, candidates: segs.rows.map(toGuarded) };
    });
  }
}
