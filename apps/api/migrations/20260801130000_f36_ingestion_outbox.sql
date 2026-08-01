-- F36: transactional outbox + job table for the nine-state ingestion pipeline
-- (uc-22-2 R8, architecture 第三节 "可重放、幂等异步状态机").
--
-- ## What already existed before this file (F31/F35), and what this adds
--
-- `artifacts.ingestion_status` (0023) is already the ONLINE state machine value; F35 already
-- writes `STORED` there in the same transaction as the artifact row. What was still missing
-- is everything AFTER `STORED`: a durable, replayable record of "what async work is left to
-- do for this version" that survives a worker process dying mid-step.
--
-- `ingestion_outbox` is that record. One row = one pending/in-flight transition for one
-- artifact_version. The row is written in the SAME transaction as the write that makes it
-- true (see `PgArtifactRepository.createVersion`'s `enqueueIngestionOutbox` branch) -- that
-- is the "transactional" half of "transactional outbox": a worker can never observe a STORED
-- version with no outbox row to pick it up, because both are the same COMMIT.
--
-- `ingestion_history` is the append-only "which states has this version actually visited"
-- trail `getIngestionRun.history` (packages/contracts/src/files.ts) reads.
--
-- ## Idempotency, structurally
--
-- `ingestion_outbox_uniq_active` (UNIQUE on `artifact_version_id, step`) means re-enqueuing
-- the same step is `ON CONFLICT DO NOTHING` at the call site, not a second race for the same
-- work. The OTHER half -- a crashed worker re-running a step it already half-applied -- is
-- not this table's job: it is `segments_uniq_ordinal` (0006) that the worker relies on to
-- detect "this segment already exists, skip" when a step is replayed (see
-- `apps/api/src/application/files/ingestion-worker.ts`).
--
-- Replayable: IF NOT EXISTS / OR REPLACE throughout (migrate:check force-replays every file
-- ignoring the version table).

CREATE TABLE IF NOT EXISTS ingestion_outbox (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  artifact_id         text NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  artifact_version_id text NOT NULL REFERENCES artifact_versions (id) ON DELETE CASCADE,
  -- The state this job is working TOWARDS, not the state the version is currently in --
  -- i.e. a row with step = 'SEGMENTED' means "run the work that takes this version from
  -- EXTRACTED to SEGMENTED". REVIEW_PENDING and READY are both reachable as a "step" because
  -- INDEXED forks into one or the other (uc-22-2 R3 step 11).
  step                text NOT NULL CHECK (step IN (
    'EXTRACTED', 'SEGMENTED', 'ENRICHED', 'INDEXED', 'REVIEW_PENDING', 'READY'
  )),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed')),
  attempts            integer NOT NULL DEFAULT 0,
  last_error          text,
  -- Claim marker. A worker is considered dead (and its claim stale/replayable) once
  -- `locked_at` is older than the worker's own staleness window -- see
  -- `ingestion-worker.ts`'s `STALE_CLAIM_MS`, kept there rather than as a second copy of the
  -- same number here.
  locked_by           text,
  locked_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Re-enqueuing a step that already has a pending/processing/failed row for this version is
  -- a no-op (`ON CONFLICT (artifact_version_id, step) DO NOTHING`), not a second job racing
  -- the first -- this is the row that makes replay "pick the existing job back up" rather
  -- than "create a duplicate one".
  CONSTRAINT ingestion_outbox_uniq_active UNIQUE (artifact_version_id, step)
);

CREATE INDEX IF NOT EXISTS ingestion_outbox_claim_idx
  ON ingestion_outbox (status, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS ingestion_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  artifact_version_id text NOT NULL REFERENCES artifact_versions (id) ON DELETE CASCADE,
  status              text NOT NULL,
  occurred_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_history_version_idx
  ON ingestion_history (org_id, artifact_version_id, occurred_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ingestion_outbox') THEN
    RAISE EXCEPTION 'ingestion_outbox did not get created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ingestion_history') THEN
    RAISE EXCEPTION 'ingestion_history did not get created';
  END IF;
END
$$;

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE ingestion_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ingestion_outbox_tenant ON ingestion_outbox;
CREATE POLICY ingestion_outbox_tenant ON ingestion_outbox
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE ingestion_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ingestion_history_tenant ON ingestion_history;
CREATE POLICY ingestion_history_tenant ON ingestion_history
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- The worker deletes a job row once it has advanced the version past that step (the queue
-- drains rather than accumulating a 'done' row per step forever), so DELETE is granted here
-- unlike the append-only quarantine/alias tables elsewhere in this bundle.
REVOKE ALL ON ingestion_outbox FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ingestion_outbox TO app_rw;

REVOKE ALL ON ingestion_history FROM app_rw;
GRANT SELECT, INSERT ON ingestion_history TO app_rw;

-- 新增租户表之后必须重新调用一次 F22 的三条冻结策略,否则组织冻结对这两张新表不生效
-- (同 F34/F35 的成例)。
SELECT kernel_apply_org_freeze_policies();
