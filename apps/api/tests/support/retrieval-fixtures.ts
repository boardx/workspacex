/**
 * Fixtures for the F10 retrieval tests.
 *
 * A separate file from `db.ts` on purpose: `db.ts` is shared by every kernel test file and is a
 * merge hotspot, and none of what is here is useful to anything but retrieval.
 *
 * Everything is inserted as the APP role under tenant scope, like every other fixture in this
 * suite. If a policy's WITH CHECK were wrong, owner-side inserts would sail through and the
 * tests would rest on data production could never have written. The one exception is
 * `registerEmbeddingModel`: `app_rw` has SELECT only on `embedding_models`, because registering
 * a model decides how every embedding in the system is interpreted and is an operator action.
 */
import { asApp, asOwner, addSegment } from "./db";
import type { EmbeddingPort, RerankPort } from "../../src/application/retrieval/ports";

export interface IndexedSegment {
  orgId: string;
  segmentId: string;
  artifactId: string;
  content: string;
  projectId?: string | null;
  sourceType?: string;
  layer?: "org" | "project" | "personal";
  private?: boolean;
  lifecycle?: "effective" | "review-pending" | "expired" | "revoked";
  inScope?: boolean;
  confidential?: boolean;
  occurredAt?: string;
  method?: string | null;
  cohort?: string | null;
  anchor?: { kind: string; locator: string };
  ordinal?: number;
}

/**
 * Create the F04 rows (artifact / version / segment / anchor) AND the F10 search projection.
 *
 * Both, because a `segment_text` row whose `segment_id` has no segment behind it is not a
 * candidate the production path could ever produce -- the FK forbids it -- and a test built on
 * one would be testing a shape that cannot exist.
 */
export async function indexSegment(s: IndexedSegment): Promise<{ versionId: string }> {
  const { versionId } = await addSegment({
    orgId: s.orgId,
    segmentId: s.segmentId,
    artifactId: s.artifactId,
    ordinal: s.ordinal,
    anchor: s.anchor ?? { kind: "page", locator: "1" },
  });
  await asApp(s.orgId, (c) =>
    c.query(
      `INSERT INTO segment_text
         (segment_id, org_id, artifact_id, artifact_version_id, project_id, source_type, layer,
          private, lifecycle, in_scope, occurred_at, method, cohort, confidential, content, tsv)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,''::tsvector)
       ON CONFLICT (segment_id) DO UPDATE SET content = EXCLUDED.content`,
      [
        s.segmentId, s.orgId, s.artifactId, versionId, s.projectId ?? null,
        s.sourceType ?? "interview", s.layer ?? "project", s.private ?? false,
        s.lifecycle ?? "effective", s.inScope ?? true, s.occurredAt ?? new Date().toISOString(),
        s.method ?? null, s.cohort ?? null, s.confidential ?? false, s.content,
      ],
    ),
  );
  return { versionId };
}

/** Register a model. Owner-side: see the header. */
export async function registerEmbeddingModel(model: string, version: string, dims: number): Promise<void> {
  await asOwner((c) =>
    c.query(
      `INSERT INTO embedding_models (model, model_version, dims) VALUES ($1,$2,$3)
       ON CONFLICT (model, model_version) DO UPDATE SET dims = EXCLUDED.dims`,
      [model, version, dims],
    ),
  );
}

export async function addEmbedding(opts: {
  orgId: string;
  segmentId: string;
  model: string;
  modelVersion: string;
  vector: readonly number[];
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO segment_embeddings (segment_id, org_id, model, model_version, embedding)
       VALUES ($1,$2,$3,$4,$5::vector)
       ON CONFLICT (segment_id, model, model_version) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [opts.segmentId, opts.orgId, opts.model, opts.modelVersion, `[${opts.vector.join(",")}]`],
    ),
  );
}

export async function addEdge(opts: {
  orgId: string;
  id: string;
  src: { kind: string; id: string };
  dst: { kind: string; id: string };
  relation: string;
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [opts.id, opts.orgId, opts.src.kind, opts.src.id, opts.dst.kind, opts.dst.id, opts.relation],
    ),
  );
}

export async function addClaim(opts: {
  orgId: string;
  id: string;
  projectId?: string | null;
  statement: string;
  status: string;
  supporting?: readonly string[];
  contradicting?: readonly string[];
}): Promise<void> {
  await asApp(opts.orgId, async (c) => {
    await c.query(
      `INSERT INTO claims (id, org_id, project_id, statement, status, tsv)
       VALUES ($1,$2,$3,$4,$5,''::tsvector) ON CONFLICT (id) DO NOTHING`,
      [opts.id, opts.orgId, opts.projectId ?? null, opts.statement, opts.status],
    );
    for (const s of opts.supporting ?? []) {
      await c.query(
        `INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
         VALUES ($1,$2,$3,'supporting') ON CONFLICT DO NOTHING`,
        [opts.id, opts.orgId, s],
      );
    }
    for (const s of opts.contradicting ?? []) {
      await c.query(
        `INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
         VALUES ($1,$2,$3,'contradicting') ON CONFLICT DO NOTHING`,
        [opts.id, opts.orgId, s],
      );
    }
  });
}

/**
 * An embedding port backed by a lookup table.
 *
 * NOT a hash of the text pretending to be a semantic model. There is no embedding model in
 * phase-00 (the model gateway is a later phase), and a hash embedding would place "证据链比预算
 * 更紧缺" and its paraphrase in unrelated parts of the space -- so a test asserting "the vector
 * channel catches the paraphrase" would be asserting a property the fake does not have, and
 * would only pass by being written around the fake.
 *
 * A lookup table states plainly that the neighbourhood is fixture data. What the tests then
 * assert is the thing under test: that the vector channel is reached, that the permission
 * filter applies to it, and that recall is not lost to filtering -- none of which depend on the
 * embedding being any good.
 */
export class TableEmbedding implements EmbeddingPort {
  constructor(
    readonly model: string,
    readonly modelVersion: string,
    private readonly table: Readonly<Record<string, readonly number[]>>,
  ) {}

  async embed(text: string): Promise<readonly number[]> {
    const v = this.table[text];
    if (v === undefined) {
      throw new Error(
        `no fixture embedding for "${text}" -- add it to the table rather than falling back to ` +
          `a default vector, which would make every unrecognised query silently match nothing`,
      );
    }
    return v;
  }
}

/** Rerank that keeps the fused order. Isolates the fusion from a reranker's opinions. */
export class IdentityRerank implements RerankPort {
  async rerank(_q: string, candidates: readonly { id: string }[]): Promise<readonly string[]> {
    return candidates.map((c) => c.id);
  }
}
