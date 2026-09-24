CREATE TABLE whiteboard_comments (
  org_id text NOT NULL, board_id uuid NOT NULL, id uuid NOT NULL, author_id text NOT NULL,
  request_id uuid NOT NULL, object_id text, text text NOT NULL CHECK(length(text) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,board_id,id),
  UNIQUE(org_id,board_id,author_id,request_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE whiteboard_private_drafts (
  org_id text NOT NULL, board_id uuid NOT NULL, user_id text NOT NULL,
  text text NOT NULL CHECK(length(text)<=20000), PRIMARY KEY(org_id,board_id,user_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE whiteboard_votes (
  org_id text NOT NULL, board_id uuid NOT NULL, id uuid NOT NULL, title text NOT NULL,
  quota integer NOT NULL CHECK(quota BETWEEN 1 AND 100), duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 1 AND 86400), object_ids jsonb NOT NULL,
  deadline timestamptz NOT NULL, closed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(org_id,board_id,id), FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE whiteboard_ballots (
  org_id text NOT NULL, board_id uuid NOT NULL, vote_id uuid NOT NULL, user_id text NOT NULL,
  request_id uuid NOT NULL, object_id text NOT NULL, count integer NOT NULL CHECK(count BETWEEN 1 AND 100),
  PRIMARY KEY(org_id,board_id,vote_id,user_id,request_id),
  FOREIGN KEY(org_id,board_id,vote_id) REFERENCES whiteboard_votes(org_id,board_id,id) ON DELETE CASCADE
);
CREATE TABLE whiteboard_timers (
  org_id text NOT NULL, board_id uuid NOT NULL, deadline timestamptz,
  PRIMARY KEY(org_id,board_id), FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['whiteboard_comments','whiteboard_private_drafts','whiteboard_votes','whiteboard_ballots','whiteboard_timers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (org_id = current_setting(''app.current_org'', true)) WITH CHECK (org_id = current_setting(''app.current_org'', true))', t);
    EXECUTE format('REVOKE ALL ON %I FROM app_rw', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
  END LOOP;
END $$;
SELECT kernel_apply_org_freeze_policies();
