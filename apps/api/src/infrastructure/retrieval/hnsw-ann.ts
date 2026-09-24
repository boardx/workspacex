/**
 * Phase 18 F05 -- how a vector query reaches the per-model HNSW index, and how it avoids the
 * R9 failure once it does (uc-18-2 R9; index DDL in migration
 * `20260924270000_kg_f05_hnsw_vector_index.sql`).
 *
 * ## Reaching the index
 *
 * `embedding` is an unconstrained `vector`; the index is a partial EXPRESSION index per registered
 * model: `(embedding::vector(dims)) vector_cosine_ops WHERE model = .. AND model_version = ..`.
 * The planner only uses it when the query orders by the SAME expression and its WHERE pins the
 * model, so the dimension has to be looked up first. `annOrder` builds that expression; a
 * query ordering by plain `embedding <=> $q::vector` is an exact scan, and `exactOrder` is
 * exactly that (used for completion, below).
 *
 * ## The failure the index introduces, and the three things that stop it
 *
 * HNSW returns an approximate top window FIRST; RLS and the scope predicate filter SECOND. When
 * most of the window belongs to other sessions / users / orgs, fewer than k rows survive and
 * the requester is told the material does not exist -- the silent under-recall R9 calls more
 * dangerous than an error. So:
 *
 *   1. `hnsw.ef_search` is sized to the requested k (`efSearchFor`) instead of the default 40;
 *   2. on pgvector >= 0.8 `hnsw.iterative_scan = strict_order` keeps the index scan going while
 *      the executor still wants rows (filtered-out rows do not count towards LIMIT);
 *   3. if the index path still returns fewer than k rows, the same query is re-run as an exact
 *      scan (`annThenExact`). Under-fill only happens when the eligible set is small relative to
 *      the window, which is precisely when the exact scan over the (org, model) btree is cheap.
 *      The result is never worse than exact; the path taken is reported, not hidden.
 */
import type { TenantSession } from "../../application/ports/database.port";

/**
 * Which query produced the rows.
 *
 * `ann`: the index-shaped query filled k. The planner serves it from the HNSW index when the
 * permission / scope filter is broad, and may instead pre-filter through a btree and sort exactly
 * when the filter is selective -- both are correct, and that choice is the planner's (cost-based).
 * `exact-completion`: the index-shaped query came back short and the exact form was re-run.
 */
export type VectorSearchPath = "ann" | "exact-completion";

export interface VectorSearchEvent {
  readonly path: VectorSearchPath;
  /** Rows the index path returned before any completion. */
  readonly annRows: number;
  /** Rows finally returned. */
  readonly rows: number;
  readonly limit: number;
  readonly efSearch: number;
  readonly iterativeScan: boolean;
}

export interface AnnSetup {
  readonly dims: number;
  readonly efSearch: number;
  readonly iterativeScan: boolean;
}

/** The pgvector version that introduced `hnsw.iterative_scan`. */
const ITERATIVE_SCAN_SINCE = [0, 8, 0] as const;
/** pgvector's own bounds for `hnsw.ef_search`. */
const EF_SEARCH_MIN = 40;
const EF_SEARCH_MAX = 1000;
/**
 * Window per requested row. Not a quality threshold (that is `THRESHOLDS.vectorRecallBaseline`,
 * judged by the recall test) but a latency knob: a wider window means the index path fills k
 * more often under a selective permission filter, and completion (step 3) runs less often.
 */
const EF_SEARCH_PER_ROW = 10;

export function efSearchFor(limit: number): number {
  return Math.min(EF_SEARCH_MAX, Math.max(EF_SEARCH_MIN, Math.ceil(limit) * EF_SEARCH_PER_ROW));
}

export function supportsIterativeScan(extversion: string): boolean {
  const parts = extversion.split(".").map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < ITERATIVE_SCAN_SINCE.length; i++) {
    const have = parts[i] ?? 0;
    const want = ITERATIVE_SCAN_SINCE[i]!;
    if (Number.isNaN(have)) return false;
    if (have !== want) return have > want;
  }
  return true;
}

/** Thrown when the query vector's length disagrees with the registered model's dimension. */
export class VectorDimensionMismatchError extends Error {
  readonly code = "vector_query_dimension_mismatch";
  constructor(readonly model: string, readonly modelVersion: string, readonly expected: number, readonly actual: number) {
    super(`query embedding has ${actual} dimensions but model ${model}/${modelVersion} is registered with ${expected}`);
  }
}

function assertDims(dims: number): number {
  if (!Number.isSafeInteger(dims) || dims < 1) throw new Error(`invalid vector dimension ${String(dims)}`);
  return dims;
}

/** Distance expression that matches the per-model HNSW index (see the migration). */
export function annOrder(column: string, param: string, dims: number): string {
  const d = assertDims(dims);
  return `(${column}::vector(${d})) <=> ${param}::vector(${d})`;
}

/** Same distance, written so that no ANN index can serve it: an exact scan. */
export function exactOrder(column: string, param: string): string {
  return `${column} <=> ${param}::vector`;
}

/**
 * Look up the model's dimension and set this transaction's HNSW knobs (`SET LOCAL` semantics via
 * `set_config(.., true)`, so they die with the transaction). `null` = the model is not
 * registered, in which case no embedding row can exist for it (foreign key).
 */
export async function prepareAnn(
  s: TenantSession,
  model: { model: string; modelVersion: string },
  embedding: readonly number[],
  limit: number,
): Promise<AnnSetup | null> {
  // `'[0]'::vector` runs pgvector's input function, which loads the library in this backend
  // BEFORE the `hnsw.*` settings below: they are then set on registered parameters rather than
  // on placeholders that the library would have to adopt when it loads.
  const r = await s.query<{ dims: number | null; extversion: string | null }>(
    `SELECT (SELECT dims FROM embedding_models WHERE model = $1 AND model_version = $2) AS dims,
            (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS extversion,
            ('[0]'::vector IS NOT NULL) AS vector_loaded`,
    [model.model, model.modelVersion],
  );
  const row = r.rows[0];
  if (!row || row.dims === null) return null;
  if (embedding.length !== row.dims) {
    throw new VectorDimensionMismatchError(model.model, model.modelVersion, row.dims, embedding.length);
  }
  const efSearch = efSearchFor(limit);
  const iterativeScan = row.extversion !== null && supportsIterativeScan(row.extversion);
  await s.query("SELECT set_config('hnsw.ef_search', $1, true)", [String(efSearch)]);
  if (iterativeScan) await s.query("SELECT set_config('hnsw.iterative_scan', 'strict_order', true)");
  return { dims: assertDims(row.dims), efSearch, iterativeScan };
}

/** Index path first; exact re-run only when the index path came back short of `limit`. */
export async function annThenExact<R>(
  limit: number,
  ann: () => Promise<readonly R[]>,
  exact: () => Promise<readonly R[]>,
): Promise<{ rows: readonly R[]; path: VectorSearchPath; annRows: number }> {
  const first = await ann();
  if (first.length >= limit) return { rows: first, path: "ann", annRows: first.length };
  return { rows: await exact(), path: "exact-completion", annRows: first.length };
}
