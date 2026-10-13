-- Explicit public exports, separate from the original private conversation.
CREATE TABLE IF NOT EXISTS chat_public_shares (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  created_by text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS chat_public_shares_thread_idx ON chat_public_shares(org_id, thread_id, created_by);
ALTER TABLE chat_public_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_public_shares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_public_shares_tenant ON chat_public_shares;
CREATE POLICY chat_public_shares_tenant ON chat_public_shares
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE ON chat_public_shares TO app_rw;

-- The anonymous directory contains only a hash and routing hints, never content.
-- Same boundary as org_invite_link_tokens: a hint is not an access grant.
CREATE TABLE IF NOT EXISTS chat_public_share_tokens (
  token_hash text PRIMARY KEY,
  share_id text NOT NULL UNIQUE REFERENCES chat_public_shares(id) ON DELETE CASCADE,
  org_id_hint text NOT NULL
);
COMMENT ON TABLE chat_public_share_tokens IS
  'kernel-no-tenant-data: Anonymous public share routing directory. Contains SHA256 hashes and tenant routing hints only; no message bodies, titles or usable bearer secrets. Access requires the matching active tenant snapshot.';
GRANT SELECT, INSERT ON chat_public_share_tokens TO app_rw;
SELECT kernel_apply_org_freeze_policies();
