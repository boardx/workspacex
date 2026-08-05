-- issue #465 -- the recording bundle's persistence, created only now and deliberately so.
--
-- `application/recording/ports.ts` (F69) states in as many words that it ships NO PostgreSQL
-- implementation, because `segments`/`tracks` would have been guessed at before F70-F73 had
-- shaped them. F70-F73 have since shipped. This migration is that deferred half, written
-- against the shape those features settled on, and it is scoped to exactly what the four
-- session-lifecycle routes need (start / ingest / end / materialize). It adds nothing for
-- the operations that still have no route.
--
-- ## What is NOT here, on purpose
--
-- · No speaker-channel / assignment / quote / annotation tables. Those bundles' use cases
--   exist (`assignment.ts`, `quotes.ts`, `ai-annotation.ts`) but their routes do not, and a
--   table with no writer is a schema commitment made on someone else's behalf -- the exact
--   mistake F69's header refused to make in the other direction.
-- · No recording-side artifact index. I-28 forbids it: materialisation registers through
--   `artifacts` / `artifact_versions`, the same rows the file browser already reads.
-- · No retention parameter table. `retention_policies` (F46) already holds that fact, and
--   `application/recording/retention-ports.ts` is explicit that a second store for "how many
--   days" would break the one invariant this bundle exists to keep.
--
-- ## Consent
--
-- `recording_consent_cells` IS a new fact store, and it is the one judgement call in this
-- file. The contract has `getConsentMatrix` (a READ) and `CONSENT_NOT_COMPLETED` (a gate)
-- but no operation that WRITES a cell, so where the matrix lives was undefined; without
-- somewhere to read it from, the gate can only be implemented as "always allow", which is
-- the gate not existing. The table is shaped exactly like `ConsentMatrixCell` in the
-- contract (participant x item x state) and nothing more, so when the authorization-writing
-- operation is specified it can write here rather than to a second copy.
--
-- ⚠ There is no `DEFAULT` on `state`. "We never asked this person" must not be storable as
--   anything, least of all as `granted`; absence of a row is the fail-closed case and the
--   application layer treats it as such.

/* ────────────────────────── ① sessions ────────────────────────── */

CREATE TABLE IF NOT EXISTS recording_sessions (
  id                    text NOT NULL,
  org_id                text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id            text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  source_type           text NOT NULL CHECK (source_type IN ('workshop', 'interview', 'thread')),
  source_ref_id         text NOT NULL,
  started_at            timestamptz NOT NULL,
  ended_at              timestamptz,
  duration_ms           bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  materialize_job_id    text,
  -- Resolved AT START (uc-5-1: 「生效保留期在开始时就解析出来并回给界面」), stored rather
  -- than re-resolved later: a session must be able to say how long it was allowed to keep
  -- what it recorded, even after the project's policy changes underneath it.
  retention_days        integer NOT NULL CHECK (retention_days > 0),
  retention_from        text NOT NULL CHECK (retention_from IN ('project', 'org')),
  retention_resolved_at timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL,
  created_by            text NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT recording_sessions_id_org_uniq UNIQUE (id, org_id),
  -- Ending is one event, not three columns that can disagree. A session with an `ended_at`
  -- and no `materialize_job_id` is a session nobody can materialise, and it would look
  -- finished.
  CONSTRAINT recording_sessions_end_is_atomic CHECK (
    (ended_at IS NULL AND duration_ms IS NULL AND materialize_job_id IS NULL) OR
    (ended_at IS NOT NULL AND duration_ms IS NOT NULL AND materialize_job_id IS NOT NULL)
  )
);

-- `SESSION_ALREADY_RECORDING` as a constraint, not only as a check in the use case. Two
-- concurrent `startRecording` calls for one thread are a race the application layer's
-- read-then-write cannot win on its own.
CREATE UNIQUE INDEX IF NOT EXISTS recording_sessions_one_live_per_source
  ON recording_sessions (org_id, source_ref_id) WHERE ended_at IS NULL;

/* ────────────────────────── ② tracks ────────────────────────── */

CREATE TABLE IF NOT EXISTS recording_tracks (
  id               text NOT NULL,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  session_id       text NOT NULL,
  -- Null for a room mic with no single owner (`application/recording/ports.ts`).
  participant_id   text,
  mic_state        text NOT NULL CHECK (mic_state IN ('granted', 'denied', 'paused')),
  -- The timeline `domain/recording/mic-state.ts` owns. Stored as its own shape rather than
  -- flattened into columns: `gapRanges` is a list and `openGapFromMs` is meaningful only
  -- together with it, and splitting them into a side table would let a gap exist without
  -- the track whose silence it describes.
  gap_ranges       jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_gap_from_ms bigint CHECK (open_gap_from_ms IS NULL OR open_gap_from_ms >= 0),
  PRIMARY KEY (id),
  CONSTRAINT recording_tracks_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT recording_tracks_session_fk FOREIGN KEY (session_id, org_id)
    REFERENCES recording_sessions (id, org_id) ON DELETE CASCADE,
  -- I-5: a `paused` track has an open gap, a `granted` one does not. Without this, a track
  -- can be recording while the timeline still claims un-captured time is accruing.
  CONSTRAINT recording_tracks_open_gap_iff_paused CHECK (
    (mic_state = 'paused') = (open_gap_from_ms IS NOT NULL)
  )
);

/* ────────────────────────── ③ segments ────────────────────────── */

CREATE TABLE IF NOT EXISTS recording_segments (
  id                 text NOT NULL,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  session_id         text NOT NULL,
  track_id           text NOT NULL,
  ordinal            integer NOT NULL CHECK (ordinal > 0),
  source_type        text NOT NULL CHECK (source_type IN ('workshop', 'interview', 'thread')),
  anchor_start_ms    bigint CHECK (anchor_start_ms IS NULL OR anchor_start_ms >= 0),
  anchor_end_ms      bigint CHECK (anchor_end_ms IS NULL OR anchor_end_ms >= 0),
  anchor_message_id  text,
  speaker_channel_id text,
  status             text NOT NULL CHECK (status IN ('partial', 'final', 'pending-manual', 'disputed')),
  low_confidence     boolean NOT NULL,
  -- ⚠ MASKED text. `domain/recording/pii-mask.ts` runs before this row is built (I-21), and
  --   there is deliberately no column here that could hold the original.
  text               text NOT NULL,
  pii_findings       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT recording_segments_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT recording_segments_session_fk FOREIGN KEY (session_id, org_id)
    REFERENCES recording_sessions (id, org_id) ON DELETE CASCADE,
  CONSTRAINT recording_segments_track_fk FOREIGN KEY (track_id, org_id)
    REFERENCES recording_tracks (id, org_id) ON DELETE CASCADE,
  -- The transcript's order is a stored fact, not "whatever the planner returned". A
  -- transcript that reorders between two reads is a different document each time.
  CONSTRAINT recording_segments_ordinal_uniq UNIQUE (org_id, session_id, ordinal),
  -- I-1 at the storage layer: exactly one anchor shape, never none. `transcribe()` already
  -- refuses an unanchored segment; this makes the refusal survive a future second writer.
  CONSTRAINT recording_segments_anchor_present CHECK (
    (anchor_message_id IS NOT NULL AND anchor_start_ms IS NULL AND anchor_end_ms IS NULL) OR
    (anchor_message_id IS NULL AND anchor_start_ms IS NOT NULL AND anchor_end_ms IS NOT NULL
     AND anchor_start_ms < anchor_end_ms)
  ),
  -- I-7: an overlap is never silently attributed to a channel.
  CONSTRAINT recording_segments_overlap_has_no_channel CHECK (
    status <> 'pending-manual' OR speaker_channel_id IS NULL
  )
);

/* ────────────────────────── ④ consent matrix ────────────────────────── */

CREATE TABLE IF NOT EXISTS recording_consent_cells (
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  source_ref_id  text NOT NULL,
  participant_id text NOT NULL,
  item           text NOT NULL CHECK (item IN ('record', 'transcript', 'ai_analysis')),
  state          text NOT NULL CHECK (state IN ('granted', 'denied', 'pending')),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, source_ref_id, participant_id, item)
);

/* ────────────────────────── ⑤ idempotency ────────────────────────── */

-- Every one of the four operations carries an `idempotencyKey` and can fail with
-- `IDEMPOTENCY_KEY_CONFLICT`, which only means something if the earlier request's payload
-- is still around to compare against. Same shape as `starter_pack_imports` (#412): the
-- digest decides replay-vs-conflict, and the stored result is what a replay returns, so a
-- retried `startRecording` cannot mint a second session.
CREATE TABLE IF NOT EXISTS recording_operation_idempotency (
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  operation       text NOT NULL CHECK (operation IN
    ('startRecording', 'ingestSegment', 'endRecording', 'materializeRecordingArtifacts')),
  idempotency_key text NOT NULL,
  payload_digest  text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  result_json     jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, operation, idempotency_key)
);

/* ────────────────────────── RLS ────────────────────────── */

ALTER TABLE recording_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE recording_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_tracks FORCE ROW LEVEL SECURITY;
ALTER TABLE recording_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE recording_consent_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_consent_cells FORCE ROW LEVEL SECURITY;
ALTER TABLE recording_operation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_operation_idempotency FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recording_sessions_tenant ON recording_sessions;
CREATE POLICY recording_sessions_tenant ON recording_sessions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS recording_tracks_tenant ON recording_tracks;
CREATE POLICY recording_tracks_tenant ON recording_tracks
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS recording_segments_tenant ON recording_segments;
CREATE POLICY recording_segments_tenant ON recording_segments
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS recording_consent_cells_tenant ON recording_consent_cells;
CREATE POLICY recording_consent_cells_tenant ON recording_consent_cells
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS recording_operation_idempotency_tenant ON recording_operation_idempotency;
CREATE POLICY recording_operation_idempotency_tenant ON recording_operation_idempotency
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON recording_sessions, recording_tracks, recording_segments,
  recording_consent_cells, recording_operation_idempotency FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON recording_sessions TO app_rw;
GRANT SELECT, INSERT, UPDATE ON recording_tracks TO app_rw;
-- Segments are append-only from the runtime's side: a transcript that can be edited in
-- place is not evidence. Corrections are a separate, still-unrouted operation
-- (`correctSegmentText`) which will need its own explicit grant when it lands.
GRANT SELECT, INSERT ON recording_segments TO app_rw;
GRANT SELECT, INSERT, UPDATE ON recording_consent_cells TO app_rw;
GRANT SELECT, INSERT ON recording_operation_idempotency TO app_rw;

-- F22's organization freeze and F124's project-archive freeze are both catalog-driven and
-- only see the tables that exist when they run, so both have to be re-applied here.
-- `kernel_apply_project_archive_policies()` matters for `recording_sessions` specifically:
-- it is the one table above with a single-column FK to `projects`, so without this call an
-- archived project would still accept new recordings -- and issue #342's own coverage gate
-- (`kernel_project_archive_coverage_gaps()`) would go red on a fresh apply.
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
