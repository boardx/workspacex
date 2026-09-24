-- ADR-114 online migration journal. Content bytes remain in the legacy tables
-- until a verified candidate has been atomically published and cleanup finishes.
ALTER TABLE whiteboard_content_heads DROP CONSTRAINT IF EXISTS whiteboard_content_heads_content_state_check;
ALTER TABLE whiteboard_content_heads ADD CONSTRAINT whiteboard_content_heads_content_state_check
  CHECK (content_state IN ('legacy','building','verifying','active','rollback','failed'));

CREATE TABLE IF NOT EXISTS whiteboard_content_migrations (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  job_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'enrolled' CHECK (state IN ('enrolled','candidate_ready','verified','cutover','cleaning','completed')),
  source_epoch integer NOT NULL CHECK (source_epoch > 0),
  source_head_seq bigint NOT NULL CHECK (source_head_seq BETWEEN 0 AND 9007199254740991),
  source_fencing_token bigint NOT NULL CHECK (source_fencing_token >= 0),
  candidate_manifest_key text,
  candidate_manifest_digest text,
  candidate_manifest_plain_digest text,
  candidate_manifest_size_bytes bigint,
  candidate_tenant_key_version integer,
  candidate_schema_version integer,
  candidate_protocol_version integer,
  candidate_head_seq bigint,
  cleanup_through_seq bigint NOT NULL DEFAULT 0 CHECK (cleanup_through_seq BETWEEN 0 AND 9007199254740991),
  cutover_at timestamptz,
  retirement_not_before timestamptz,
  retirement_proof_digest text CHECK (retirement_proof_digest IS NULL OR retirement_proof_digest ~ '^[a-f0-9]{64}$'),
  retirement_started_at timestamptz,
  retirement_epoch integer CHECK (retirement_epoch IS NULL OR retirement_epoch > 0),
  retirement_head_seq bigint CHECK (retirement_head_seq IS NULL OR retirement_head_seq BETWEEN 0 AND 9007199254740991),
  retirement_manifest_digest text CHECK (retirement_manifest_digest IS NULL OR retirement_manifest_digest ~ '^[a-f0-9]{64}$'),
  retirement_checkpoint_digest text CHECK (retirement_checkpoint_digest IS NULL OR retirement_checkpoint_digest ~ '^[a-f0-9]{64}$'),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (org_id,board_id),
  UNIQUE (org_id,job_id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboard_content_heads(org_id,board_id) ON DELETE CASCADE,
  CHECK (
    (state = 'enrolled' AND candidate_manifest_key IS NULL AND candidate_manifest_digest IS NULL AND candidate_manifest_plain_digest IS NULL AND candidate_manifest_size_bytes IS NULL AND candidate_tenant_key_version IS NULL AND candidate_schema_version IS NULL AND candidate_protocol_version IS NULL AND candidate_head_seq IS NULL)
    OR
    (state <> 'enrolled' AND candidate_manifest_key IS NOT NULL AND length(candidate_manifest_key) BETWEEN 1 AND 512 AND candidate_manifest_digest ~ '^[a-f0-9]{64}$' AND candidate_manifest_plain_digest ~ '^[a-f0-9]{64}$' AND candidate_manifest_size_bytes > 0 AND candidate_tenant_key_version > 0 AND candidate_schema_version > 0 AND candidate_protocol_version > 0 AND candidate_head_seq = source_head_seq)
  ),
  CHECK ((state = 'completed' AND completed_at IS NOT NULL) OR (state <> 'completed' AND completed_at IS NULL))
  ,CHECK (
    (state IN ('enrolled','candidate_ready','verified') AND cutover_at IS NULL AND retirement_not_before IS NULL AND retirement_proof_digest IS NULL AND retirement_started_at IS NULL AND retirement_epoch IS NULL AND retirement_head_seq IS NULL AND retirement_manifest_digest IS NULL AND retirement_checkpoint_digest IS NULL)
    OR
    (state = 'cutover' AND cutover_at IS NOT NULL AND retirement_not_before IS NOT NULL AND retirement_proof_digest IS NULL AND retirement_started_at IS NULL AND retirement_epoch IS NULL AND retirement_head_seq IS NULL AND retirement_manifest_digest IS NULL AND retirement_checkpoint_digest IS NULL)
    OR
    (state IN ('cleaning','completed') AND cutover_at IS NOT NULL AND retirement_not_before IS NOT NULL AND retirement_proof_digest ~ '^[a-f0-9]{64}$' AND retirement_started_at IS NOT NULL AND retirement_epoch > 0 AND retirement_head_seq >= 0 AND retirement_manifest_digest ~ '^[a-f0-9]{64}$' AND retirement_checkpoint_digest ~ '^[a-f0-9]{64}$')
  )
);

CREATE INDEX IF NOT EXISTS whiteboard_content_migrations_jobs
  ON whiteboard_content_migrations(org_id,state,updated_at,board_id);
ALTER TABLE whiteboard_content_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_migrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_content_migrations_tenant ON whiteboard_content_migrations;
CREATE POLICY whiteboard_content_migrations_tenant ON whiteboard_content_migrations
  USING (org_id=current_setting('app.current_org',true))
  WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_content_migrations FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_content_migrations TO app_rw;
-- The runtime role may retire only the legacy body. Actor/update/request
-- receipt metadata remains immutable and replayable.
GRANT UPDATE(update) ON whiteboard_updates TO app_rw;
