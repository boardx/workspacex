-- F164 / #972 -- user-owned realtime transcription metadata and capture aggregation.
-- Transcript text remains exclusively in recording_segments.

CREATE OR REPLACE FUNCTION kernel_valid_personal_transcription_tags(value text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(value) <= 5
     AND NOT EXISTS (
       SELECT 1 FROM unnest(value) AS tag
        WHERE tag IS NULL OR tag <> btrim(tag) OR char_length(tag) NOT BETWEEN 1 AND 20
     );
$$;

CREATE TABLE IF NOT EXISTS personal_transcriptions (
  id            text NOT NULL,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  owner_user_id text NOT NULL,
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  tags          text[] NOT NULL DEFAULT '{}'::text[],
  status        text NOT NULL DEFAULT 'idle'
                CHECK (status IN ('idle', 'recording', 'completed', 'failed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT personal_transcriptions_id_org_uniq UNIQUE (id, org_id)
);

ALTER TABLE personal_transcriptions
  DROP CONSTRAINT IF EXISTS personal_transcriptions_tags_check;
ALTER TABLE personal_transcriptions
  DROP CONSTRAINT IF EXISTS personal_transcriptions_tags_valid_check;
ALTER TABLE personal_transcriptions
  ADD CONSTRAINT personal_transcriptions_tags_valid_check
  CHECK (kernel_valid_personal_transcription_tags(tags));

CREATE INDEX IF NOT EXISTS personal_transcriptions_owner_recent_idx
  ON personal_transcriptions (org_id, owner_user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS personal_transcriptions_tags_idx
  ON personal_transcriptions USING gin (tags);

-- Personal captures deliberately have no project. Existing carriers remain project-bound.
ALTER TABLE recording_sessions ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE recording_sessions DROP CONSTRAINT IF EXISTS recording_sessions_source_type_check;
ALTER TABLE recording_sessions ADD CONSTRAINT recording_sessions_source_type_check
  CHECK (source_type IN ('workshop', 'interview', 'thread', 'personal'));
ALTER TABLE recording_sessions DROP CONSTRAINT IF EXISTS recording_sessions_project_scope_check;
ALTER TABLE recording_sessions ADD CONSTRAINT recording_sessions_project_scope_check
  CHECK (
    (source_type = 'personal' AND project_id IS NULL) OR
    (source_type <> 'personal' AND project_id IS NOT NULL)
  );

ALTER TABLE recording_segments DROP CONSTRAINT IF EXISTS recording_segments_source_type_check;
ALTER TABLE recording_segments ADD CONSTRAINT recording_segments_source_type_check
  CHECK (source_type IN ('workshop', 'interview', 'thread', 'personal'));

-- A partial FK cannot express "only when source_type=personal". The trigger makes the
-- cross-table owner invariant storage-enforced without constraining legacy source_ref ids.
CREATE OR REPLACE FUNCTION kernel_validate_personal_recording_session()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_type = 'personal' AND NOT EXISTS (
    SELECT 1 FROM personal_transcriptions p
     WHERE p.id = NEW.source_ref_id
       AND p.org_id = NEW.org_id
       AND p.owner_user_id = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'personal recording source must belong to created_by in the same organization'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recording_sessions_personal_owner_guard ON recording_sessions;
CREATE TRIGGER recording_sessions_personal_owner_guard
  BEFORE INSERT OR UPDATE OF source_type, source_ref_id, org_id, created_by
  ON recording_sessions
  FOR EACH ROW EXECUTE FUNCTION kernel_validate_personal_recording_session();

CREATE OR REPLACE FUNCTION kernel_guard_personal_transcription_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'personal transcription identity and owner are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personal_transcriptions_identity_guard ON personal_transcriptions;
CREATE TRIGGER personal_transcriptions_identity_guard
  BEFORE UPDATE OF id, org_id, owner_user_id ON personal_transcriptions
  FOR EACH ROW EXECUTE FUNCTION kernel_guard_personal_transcription_identity();

ALTER TABLE personal_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_transcriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_transcriptions_tenant ON personal_transcriptions;
CREATE POLICY personal_transcriptions_tenant ON personal_transcriptions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON personal_transcriptions FROM app_rw;
GRANT SELECT, INSERT ON personal_transcriptions TO app_rw;
GRANT UPDATE (name, tags, status, updated_at) ON personal_transcriptions TO app_rw;

SELECT kernel_apply_org_freeze_policies();
