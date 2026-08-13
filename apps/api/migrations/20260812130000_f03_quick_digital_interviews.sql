DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='interview_sessions_id_org_uniq') THEN
    ALTER TABLE interview_sessions ADD CONSTRAINT interview_sessions_id_org_uniq UNIQUE(id,org_id);
  END IF;
END $$;

-- F02's compatibility trigger must not turn a catalogue-only capability fixture into a
-- relationally invalid expert profile. Production Agent creation writes `agents` first and
-- the listing second; the EXISTS keeps that supported order while preserving the FK as the
-- authority for what may be presented as a digital expert.
CREATE OR REPLACE FUNCTION ensure_digital_expert_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'agent' AND EXISTS (
    SELECT 1 FROM agents a WHERE a.org_id = NEW.org_id AND a.id = NEW.id
  ) THEN
    INSERT INTO digital_expert_profiles (org_id, agent_id, domains)
    VALUES (NEW.org_id, NEW.id, ARRAY['未分类']::text[])
    ON CONFLICT (org_id, agent_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS digital_quick_interviews (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_id text NOT NULL,
  expert_snapshot jsonb NOT NULL,
  start_request_id text NOT NULL,
  converted_interview_id text,
  PRIMARY KEY (org_id, interview_id),
  UNIQUE (org_id, start_request_id),
  FOREIGN KEY (interview_id, org_id) REFERENCES interview_sessions(id, org_id) ON DELETE CASCADE
);

ALTER TABLE interview_sessions DROP CONSTRAINT IF EXISTS interview_sessions_source_quick_interview_id_fkey;
ALTER TABLE interview_sessions DROP CONSTRAINT IF EXISTS interview_sessions_source_quick_same_org_fk;
ALTER TABLE interview_sessions ADD CONSTRAINT interview_sessions_source_quick_same_org_fk
  FOREIGN KEY (source_quick_interview_id, org_id) REFERENCES interview_sessions(id, org_id);
ALTER TABLE digital_quick_interviews DROP CONSTRAINT IF EXISTS digital_quick_converted_same_org_fk;
ALTER TABLE digital_quick_interviews ADD CONSTRAINT digital_quick_converted_same_org_fk
  FOREIGN KEY (converted_interview_id, org_id) REFERENCES interview_sessions(id, org_id);

CREATE TABLE IF NOT EXISTS digital_quick_messages (
  org_id text NOT NULL,
  interview_id text NOT NULL,
  id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  source_pointers text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, interview_id, ordinal),
  FOREIGN KEY (org_id, interview_id) REFERENCES digital_quick_interviews(org_id, interview_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS digital_interview_source_materials (
  org_id text NOT NULL,
  interview_id text NOT NULL,
  source_quick_interview_id text NOT NULL,
  source_message_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  source_pointers text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (org_id, interview_id, source_message_id),
  UNIQUE (org_id, interview_id, ordinal),
  FOREIGN KEY (interview_id, org_id) REFERENCES interview_sessions(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, source_quick_interview_id) REFERENCES digital_quick_interviews(org_id, interview_id),
  FOREIGN KEY (org_id, source_message_id) REFERENCES digital_quick_messages(org_id, id)
);

ALTER TABLE digital_quick_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_quick_interviews FORCE ROW LEVEL SECURITY;
ALTER TABLE digital_quick_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_quick_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE digital_interview_source_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_interview_source_materials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS digital_quick_interviews_tenant ON digital_quick_interviews;
CREATE POLICY digital_quick_interviews_tenant ON digital_quick_interviews
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS digital_quick_messages_tenant ON digital_quick_messages;
CREATE POLICY digital_quick_messages_tenant ON digital_quick_messages
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS digital_interview_source_materials_tenant ON digital_interview_source_materials;
CREATE POLICY digital_interview_source_materials_tenant ON digital_interview_source_materials
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON digital_quick_interviews, digital_quick_messages, digital_interview_source_materials FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON digital_quick_interviews, digital_quick_messages, digital_interview_source_materials TO app_rw;
SELECT kernel_apply_org_freeze_policies();
