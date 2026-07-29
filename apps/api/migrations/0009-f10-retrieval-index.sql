-- 0009 F10: the retrieval index -- what the five channels actually read
-- (uc-0-2 R3 step 2/3, contracts/context-pack/usecases.md "AssembleContextPack")
--
-- ## Why new tables at all
--
-- F04 stores STRUCTURE (artifact / version / segment / anchor) and keeps the BYTES in object
-- storage. Nothing it created can answer "which segments contain this exact sentence" or
-- "which segments are semantically near this query" -- `segments` has an ordinal and a kind
-- and no text. Five-way recall needs five readable surfaces, and four of them do not exist:
--
--   fts       segment_text.tsv            full-text, CJK-aware (see the tokenizer below)
--   vector    segment_embeddings.embedding pgvector
--   graph     ontology_edges              recursive CTE, fixed bonus only
--   metadata  segment_text.<columns>      project / source / time / method / cohort
--   claim     claims + claim_segments     reviewed insights, supporting AND contradicting
--
-- ## `segment_text.content` and the "PG holds no bytes" rule (F04 I-4)
--
-- I-4 forbids a BLOB column: the original's bytes are canonical in object storage and a
-- database copy makes a restore asymmetric. A text column for search is a different thing and
-- it is stated here rather than left to be argued about later:
--
--   * it is a DERIVED, REBUILDABLE PROJECTION. The canonical extracted text is a
--     `derived_representations` row pointing at a file (kind = 'ocr' / 'asr'); this column is
--     what an index needs to exist at all, because PostgreSQL FTS cannot search S3.
--   * losing it loses nothing but query performance -- it can be rebuilt from the derived
--     files. Losing an S3 object loses the evidence. That asymmetry is what makes one
--     canonical and the other a cache.
--
-- ⚠ It is still a second copy of the same words, and if the projection drifts from the file
-- the Context Pack cites text the original does not contain. Nothing here can prevent that;
-- the rebuild path is F-later's and is named as missing rather than pretended away.
--
-- ## What this migration deliberately does NOT create: an ANN index
--
-- R9 / V12 is about a specific silent failure: an approximate index (HNSW / IVFFlat) recalls
-- top-k FIRST and the permission predicate filters SECOND, so an entitled document can be
-- pushed out of the candidate window and the user is told "no such material" instead of
-- getting an error. That is the failure the recall test set exists to catch.
--
-- An ANN index requires a FIXED vector dimension, and a dimension is a property of an
-- embedding model. No embedding model has been chosen for phase-00 (the model gateway is out
-- of this phase), so any dimension written here would be invented -- and an invented dimension
-- with an HNSW index over it produces a measured-looking recall number for a configuration
-- that will never ship. So:
--
--   * `embedding` is an UNCONSTRAINED `vector`, and the vector channel is an EXACT scan.
--   * exactness is asserted in `pgvector-permission-recall.test.ts`, not assumed: the test
--     reads pg_indexes and fails the day an ANN index appears -- which is the day the
--     under-recall risk becomes real and the recall test set has to be re-armed.
--
-- Stating it is the point. A recall suite that passes because the index it is testing does not
-- exist, without saying so, is the "green gate, testing nothing" failure this repo keeps
-- finding.
--
-- Replayable: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, because
-- migrate:check force-replays each file ignoring the version table.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------------------
-- Tokenization -- the "中文需明确分词方案" the feature notes demand an answer to
-- ---------------------------------------------------------------------------------------
-- PostgreSQL's built-in configurations do not segment Chinese: `to_tsvector('simple', '证据链
-- 比预算更紧缺')` yields ONE token for the whole run, so the only query that can ever match is
-- the identical whole run. Every dedicated segmenter (zhparser, pg_bigm, pgroonga) is an
-- extension that is not in `pgvector/pgvector:pg16`, i.e. a deployment dependency this phase
-- has not taken.
--
-- The scheme, chosen explicitly: **CJK bigrams + `simple` for everything else.**
--
--   '证据链' -> '证据' '据链'          two overlapping bigrams
--   'ISO 27001'          -> 'iso' '27001'   simple's own tokens, untouched
--
-- Bigrams are dumber than a real segmenter and that is the correct trade here: they need no
-- dictionary, they never fail to split a word the dictionary has not heard of (new client
-- names, product codes -- exactly the material that arrives during a workshop), and mixed
-- CN/EN text works because the two token sources are unioned rather than chosen between.
-- The cost is precision: '据链' is not a word, so some bigram overlaps match text a human
-- would not call a match. Rank ordering absorbs that; the vector channel is the one asked to
-- be smart.
--
-- ⚠ A real evaluation of CN/EN mixed retrieval quality is NOT delivered here -- that needs a
-- labelled query set nobody has produced. What is delivered is that both scripts are reachable
-- through one index, asserted in `retrieval-fts-first-class.test.ts`.

-- Overlapping bigrams for each run of CJK characters. Latin/digits are left for `simple`.
CREATE OR REPLACE FUNCTION wsx_cjk_bigrams(t text) RETURNS text AS $$
DECLARE
  run text;
  acc text := '';
  i   int;
BEGIN
  IF t IS NULL THEN RETURN ''; END IF;
  -- U+4E00..U+9FFF (CJK Unified Ideographs), written as a literal range: PostgreSQL regexes
  -- have no \uXXXX escape.
  FOR run IN SELECT (regexp_matches(t, '[一-鿿]+', 'g'))[1] LOOP
    IF char_length(run) = 1 THEN
      -- A lone ideograph has no bigram; keep it so single-character queries still reach it.
      acc := acc || ' ' || run;
    ELSE
      FOR i IN 1..char_length(run) - 1 LOOP
        acc := acc || ' ' || substr(run, i, 2);
      END LOOP;
    END IF;
  END LOOP;
  RETURN acc;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- CJK runs replaced by spaces, so `simple` never sees them.
--
-- ⚠ Load-bearing, and it took a failing test to notice. Feeding the RAW text to `simple`
-- alongside the bigrams emits the whole run as one extra token: the document
-- '证据链比预算更紧缺' yields '证据链比预算更紧缺', and the query '证据链' yields '证据链'.
-- Those are different tokens, so an AND query can never be satisfied, and the FTS channel
-- returns nothing for every Chinese query while erroring on none of them. Exactly the silent
-- failure this feature is about, in the tokenizer itself.
CREATE OR REPLACE FUNCTION wsx_strip_cjk(t text) RETURNS text AS $$
  SELECT regexp_replace(coalesce($1, ''), '[一-鿿]+', ' ', 'g');
$$ LANGUAGE sql IMMUTABLE;

-- The ONE place a document is turned into tokens. `wsx_tsquery` below uses the same function,
-- so index side and query side cannot drift -- a tokenizer applied on only one side is the
-- classic "search finds nothing and nothing errors".
--
-- ⚠ Known limit, stated rather than discovered later: a query that is a SINGLE ideograph has
-- no bigram and will not match a document where that character sits inside a longer run.
-- Inherent to bigram indexing; the vector channel is what covers such a query.
CREATE OR REPLACE FUNCTION wsx_tsvector(t text) RETURNS tsvector AS $$
  SELECT to_tsvector('simple', wsx_strip_cjk($1) || ' ' || wsx_cjk_bigrams($1));
$$ LANGUAGE sql IMMUTABLE;

-- Query side: AND over every token.
--
-- AND, not OR, and that is a deliberate statement about what this channel is FOR. The FTS
-- channel's job (R3, V11) is the exact quote / the reference number / the person's name; OR
-- would return every document sharing one common token and drown the exact hit it was asked
-- for. Paraphrase is the vector channel's job, and if FTS returns nothing for a reworded query
-- that is the two channels behaving as designed -- which is exactly what V11 asserts.
CREATE OR REPLACE FUNCTION wsx_tsquery(q text) RETURNS tsquery AS $$
  SELECT CASE
           WHEN coalesce(array_length(lexemes, 1), 0) = 0 THEN NULL::tsquery
           ELSE to_tsquery('simple', array_to_string(lexemes, ' & '))
         END
    FROM (
      SELECT array_agg(quote_literal(lexeme)) AS lexemes
        FROM unnest(wsx_tsvector($1)) AS u(lexeme)
    ) s;
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------------------------
-- segment_text -- the fts and metadata channels
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS segment_text (
  segment_id          text PRIMARY KEY REFERENCES segments (id) ON DELETE CASCADE,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The ARTIFACT, carried here on purpose. It is the `sources` entry the permission guard
  -- needs (F04 I-13: a segment's scope is its original's), and a retriever that had to go and
  -- fetch it separately is a retriever whose author can decide to skip that round trip.
  artifact_id         text NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  artifact_version_id text NOT NULL REFERENCES artifact_versions (id) ON DELETE CASCADE,
  project_id          text REFERENCES projects (id) ON DELETE SET NULL,
  -- Closed enum, mirroring `contextPack.ContextSourceType`. Asserted equal to the contract
  -- member-for-member in `retrieval-five-channels.test.ts`, the same technique 0006 uses.
  source_type         text NOT NULL CHECK (source_type IN (
    'file', 'survey', 'interview', 'workshop', 'photo', 'conversation', 'deep-research',
    'ai-generated'
  )),
  -- ── I-8, and why it is a column rather than a filter ─────────────────────────────────
  -- I-2 says everything not in items[] must be explained in omissions[]; I-8 says a personal
  -- private note must appear in NEITHER items[] NOR omissions[].ref, because an omission
  -- record leaks that the note exists. Those two are compatible only if such notes never
  -- enter the CANDIDATE SET (coherence E-5; the handoff note at the top of
  -- `application/context-pack/build-items.ts` addresses this to F10).
  --
  -- So the exclusion happens in the recall SQL itself, on these columns -- before anything is
  -- a candidate, before anything could be explained. Doing it after recall is the version that
  -- looks identical in a diff and leaks.
  layer               text NOT NULL CHECK (layer IN ('org', 'project', 'personal')),
  private             boolean NOT NULL,
  -- R3 step 3. `effective` and `review-pending` are recalled; `expired` is recalled but marked;
  -- `revoked` is permanently excluded (its counter-example text is recalled as a separate
  -- lesson row, which is a different row, not this one).
  lifecycle           text NOT NULL CHECK (lifecycle IN (
    'effective', 'review-pending', 'expired', 'revoked'
  )),
  -- R3 "降权": applicability does not match => keep, mark cross-scope, downweight. Not exclude.
  in_scope            boolean NOT NULL DEFAULT true,
  -- metadata channel: "上个月能源组做的访谈"
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  method              text,
  cohort              text,
  -- Confidential material forces the whole round onto a local model (D-U1). Recorded at the
  -- segment because that is the granularity the Pack is assembled from; the DECISION is
  -- identity's (X-5) and is not made here.
  confidential        boolean NOT NULL DEFAULT false,
  content             text NOT NULL CHECK (length(content) > 0),
  -- Maintained by trigger, not a GENERATED column: a generated column pins the tokenizer
  -- function, and `migrate:check` force-replays this file, i.e. re-runs
  -- `CREATE OR REPLACE FUNCTION wsx_tsvector` against a table that depends on it.
  tsv                 tsvector NOT NULL
);

CREATE INDEX IF NOT EXISTS segment_text_tsv_idx ON segment_text USING gin (tsv);
-- Filter-column indexes, R9's first countermeasure: the tenant / project / lifecycle
-- predicates are what the planner needs in order to filter BEFORE ranking rather than after.
CREATE INDEX IF NOT EXISTS segment_text_scope_idx
  ON segment_text (org_id, project_id, lifecycle, layer);
CREATE INDEX IF NOT EXISTS segment_text_time_idx ON segment_text (org_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION segment_text_tokenize() RETURNS trigger AS $$
BEGIN
  NEW.tsv := wsx_tsvector(NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS segment_text_tokenize_trg ON segment_text;
CREATE TRIGGER segment_text_tokenize_trg
  BEFORE INSERT OR UPDATE ON segment_text
  FOR EACH ROW EXECUTE FUNCTION segment_text_tokenize();

-- Backfill the tsv of any row written before this file was (re)played, so a replay converges
-- rather than leaving rows whose tokens predate a tokenizer change.
UPDATE segment_text SET content = content;

-- ---------------------------------------------------------------------------------------
-- embedding_models + segment_embeddings -- the vector channel
-- ---------------------------------------------------------------------------------------
-- R9: "the embedding table must be partitioned by model / version; a dimension migration goes
-- through dual-write". The part of that which is expressible without choosing a model is the
-- INVARIANT: rows of one model all have that model's dimension, and two models coexist.
--
-- Registry, not tenant data: a model's identity and dimension are the same fact for every
-- organization, and a per-tenant copy is one more place for them to disagree.
CREATE TABLE IF NOT EXISTS embedding_models (
  model         text NOT NULL,
  model_version text NOT NULL,
  dims          integer NOT NULL CHECK (dims > 0),
  PRIMARY KEY (model, model_version)
);

COMMENT ON TABLE embedding_models IS
  'kernel-no-tenant-data: embedding model identity and dimension. The same fact for every '
  'organization; no row here belongs to a tenant.';

CREATE TABLE IF NOT EXISTS segment_embeddings (
  segment_id    text NOT NULL REFERENCES segments (id) ON DELETE CASCADE,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  model         text NOT NULL,
  model_version text NOT NULL,
  -- Unconstrained dimension on purpose -- see the header. The dimension is enforced against
  -- the registry by the trigger below, which is the guarantee that actually matters:
  -- pgvector's own error for mixing dimensions surfaces at QUERY time, on the day somebody
  -- searches, not at write time on the day the bad row is written.
  embedding     vector NOT NULL,
  -- Dual-write during a dimension migration means one segment carries two model rows at once,
  -- so the key includes the model. A key of (segment_id) alone makes the migration impossible
  -- and the impossibility only shows up mid-migration.
  PRIMARY KEY (segment_id, model, model_version),
  FOREIGN KEY (model, model_version) REFERENCES embedding_models (model, model_version)
);

CREATE INDEX IF NOT EXISTS segment_embeddings_model_idx
  ON segment_embeddings (org_id, model, model_version);

CREATE OR REPLACE FUNCTION segment_embedding_dims_match() RETURNS trigger AS $$
DECLARE
  want integer;
BEGIN
  SELECT dims INTO want FROM embedding_models
   WHERE model = NEW.model AND model_version = NEW.model_version;
  IF want IS NULL THEN
    RAISE EXCEPTION 'embedding model %/% is not registered', NEW.model, NEW.model_version;
  END IF;
  IF vector_dims(NEW.embedding) <> want THEN
    RAISE EXCEPTION
      'embedding for segment % has % dimensions but model %/% is registered with %',
      NEW.segment_id, vector_dims(NEW.embedding), NEW.model, NEW.model_version, want;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS segment_embedding_dims_match_trg ON segment_embeddings;
CREATE TRIGGER segment_embedding_dims_match_trg
  BEFORE INSERT OR UPDATE ON segment_embeddings
  FOR EACH ROW EXECUTE FUNCTION segment_embedding_dims_match();

-- ---------------------------------------------------------------------------------------
-- ontology_edges -- the graph channel
-- ---------------------------------------------------------------------------------------
-- Apache AGE is explicitly NOT enabled in phase one (usecases.md); traversal is a recursive
-- CTE over this table. The graph gives a FIXED BONUS and never decides a result on its own
-- (R3 "线索"), which is why there is no weight column: a per-edge weight is precisely the
-- knob that would let the graph decide, and graph-first is what `context-engine.md` overturned.
--
-- ⚠ No phase-00 feature owns the knowledge graph (see PROPAGATION_PATHS: `graph-traversal` is
-- phase-01 09-kg). This table is the minimum the channel needs to be a real fifth of the
-- recall rather than a stub, and it is deliberately thin.
CREATE TABLE IF NOT EXISTS ontology_edges (
  id        text PRIMARY KEY,
  org_id    text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  src_kind  text NOT NULL CHECK (src_kind IN ('person', 'project', 'decision', 'requirement', 'research', 'segment')),
  src_id    text NOT NULL,
  dst_kind  text NOT NULL CHECK (dst_kind IN ('person', 'project', 'decision', 'requirement', 'research', 'segment')),
  dst_id    text NOT NULL,
  relation  text NOT NULL CHECK (length(relation) > 0)
);

CREATE INDEX IF NOT EXISTS ontology_edges_src_idx ON ontology_edges (org_id, src_kind, src_id);
CREATE INDEX IF NOT EXISTS ontology_edges_dst_idx ON ontology_edges (org_id, dst_kind, dst_id);

-- ---------------------------------------------------------------------------------------
-- claims + claim_segments -- the claim channel
-- ---------------------------------------------------------------------------------------
-- The five-state lifecycle belongs to 14-brain (phase-01); what belongs here is the shape the
-- Context Pack cites, and the one rule that must hold from the first row: a claim's
-- CONTRADICTING evidence is stored the same way as its supporting evidence.
--
-- Two columns (`supporting_ids`, `contradicting_ids`) would have made "filter the contradicting
-- ones out" a one-word edit. One table with a `stance` column makes dropping opposing evidence
-- require dropping evidence -- which is what R7 / I-12 is asking for.
CREATE TABLE IF NOT EXISTS claims (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text REFERENCES projects (id) ON DELETE SET NULL,
  statement  text NOT NULL CHECK (length(statement) > 0),
  -- Mirrors `contextPack.ClaimStatus`; asserted equal to the contract in the tests.
  status     text NOT NULL CHECK (status IN (
    'proposed', 'reviewed', 'accepted', 'contested', 'superseded'
  )),
  tsv        tsvector NOT NULL
);

CREATE INDEX IF NOT EXISTS claims_tsv_idx ON claims USING gin (tsv);
CREATE INDEX IF NOT EXISTS claims_scope_idx ON claims (org_id, project_id, status);

CREATE OR REPLACE FUNCTION claim_tokenize() RETURNS trigger AS $$
BEGIN
  NEW.tsv := wsx_tsvector(NEW.statement);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS claim_tokenize_trg ON claims;
CREATE TRIGGER claim_tokenize_trg
  BEFORE INSERT OR UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION claim_tokenize();

UPDATE claims SET statement = statement;

CREATE TABLE IF NOT EXISTS claim_segments (
  claim_id   text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  segment_id text NOT NULL REFERENCES segments (id) ON DELETE CASCADE,
  stance     text NOT NULL CHECK (stance IN ('supporting', 'contradicting')),
  PRIMARY KEY (claim_id, segment_id, stance)
);

CREATE INDEX IF NOT EXISTS claim_segments_segment_idx ON claim_segments (org_id, segment_id);

-- ---------------------------------------------------------------------------------------
-- RLS on every tenant table added here
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit() (0004) discovers these from the catalog the moment they exist,
-- so verify-rls.sh fails if this block is forgotten. `embedding_models` is absent from the
-- list on purpose -- it carries no org_id and declares that in its COMMENT above.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'segment_text', 'segment_embeddings', 'ontology_edges', 'claims', 'claim_segments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    -- current_setting(..., true) is NULL when unset, so an un-scoped retrieval query sees
    -- nothing (fail-closed) rather than every tenant's corpus. For a search index that is the
    -- difference between "no results" and a cross-tenant leak with a plausible-looking body.
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;

REVOKE ALL ON segment_text, segment_embeddings, ontology_edges, claims, claim_segments,
  embedding_models FROM app_rw;

-- The index is a rebuildable projection: re-ingestion replaces rows rather than adding a
-- version, so unlike `artifact_versions` these are fully mutable by the runtime role.
GRANT SELECT, INSERT, UPDATE, DELETE ON segment_text TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON segment_embeddings TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ontology_edges TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON claims TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_segments TO app_rw;
-- Read-only: registering a model is an operator action (it decides how every embedding in the
-- system is interpreted), not something a request should be able to do.
GRANT SELECT ON embedding_models TO app_rw;

COMMENT ON TABLE segment_text IS
  'Search projection of segment text. NOT canonical: the canonical extracted text is a '
  'derived_representations file in object storage, and this table can be rebuilt from it. '
  'PostgreSQL FTS cannot search object storage, which is the whole reason it exists.';

COMMENT ON COLUMN segment_embeddings.embedding IS
  'Unconstrained dimension by design: the dimension belongs to the embedding model, and no '
  'model is chosen in phase-00. Enforced against embedding_models by trigger. No ANN index '
  'exists yet -- see 0009 header and pgvector-permission-recall.test.ts.';
