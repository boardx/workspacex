-- Upgrade the original client-metadata-only recovery table. Existing requests cannot be
-- authenticated retroactively, so they remain as denied audit rows and can never be replayed.
CREATE TABLE IF NOT EXISTS whiteboard_quarantine_access_receipts (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  actor_id text NOT NULL,
  session_fingerprint text NOT NULL CHECK (session_fingerprint ~ '^[a-f0-9]{64}$'),
  epoch integer NOT NULL CHECK (epoch > 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  CHECK (expires_at > issued_at),
  PRIMARY KEY (org_id, receipt_id),
  UNIQUE (org_id, board_id, actor_id, session_fingerprint, epoch, receipt_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whiteboard_quarantine_access_actor
  ON whiteboard_quarantine_access_receipts(org_id, actor_id, board_id, issued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS whiteboard_quarantine_access_active_scope
  ON whiteboard_quarantine_access_receipts(org_id, board_id, actor_id, session_fingerprint, epoch)
  WHERE active;

ALTER TABLE whiteboard_quarantine_recovery_requests ADD COLUMN IF NOT EXISTS access_receipt_id uuid;
ALTER TABLE whiteboard_quarantine_recovery_requests ADD COLUMN IF NOT EXISTS request_hash text;
UPDATE whiteboard_quarantine_recovery_requests
  SET status='denied',reviewed_at=COALESCE(reviewed_at,now()),request_hash=COALESCE(request_hash,repeat('0',64))
  WHERE access_receipt_id IS NULL OR request_hash IS NULL;
ALTER TABLE whiteboard_quarantine_recovery_requests ALTER COLUMN request_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whiteboard_quarantine_recovery_access_once
  ON whiteboard_quarantine_recovery_requests(org_id, requested_by, access_receipt_id)
  WHERE access_receipt_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whiteboard_quarantine_recovery_hash') THEN
    ALTER TABLE whiteboard_quarantine_recovery_requests ADD CONSTRAINT whiteboard_quarantine_recovery_hash
      CHECK (request_hash ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whiteboard_quarantine_recovery_proof_required') THEN
    ALTER TABLE whiteboard_quarantine_recovery_requests ADD CONSTRAINT whiteboard_quarantine_recovery_proof_required
      CHECK (status='denied' OR access_receipt_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whiteboard_quarantine_recovery_access_fk') THEN
    ALTER TABLE whiteboard_quarantine_recovery_requests ADD CONSTRAINT whiteboard_quarantine_recovery_access_fk
      FOREIGN KEY (org_id, board_id, requested_by, session_fingerprint, epoch, access_receipt_id)
      REFERENCES whiteboard_quarantine_access_receipts(org_id, board_id, actor_id, session_fingerprint, epoch, receipt_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE whiteboard_quarantine_access_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_quarantine_access_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_quarantine_access_tenant ON whiteboard_quarantine_access_receipts;
CREATE POLICY whiteboard_quarantine_access_tenant ON whiteboard_quarantine_access_receipts
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_quarantine_access_receipts FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON whiteboard_quarantine_access_receipts TO app_rw;
SELECT kernel_apply_org_freeze_policies();
