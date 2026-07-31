-- F35: malware-scan quarantine trail (uc-22-2 E2 / R7 / V4).
--
-- ## Why a dedicated table instead of `provenance_events`
--
-- `provenance_events` (0005/0013) is the shared append-only audit trail, and its `type`
-- CHECK is a byte-for-byte copy of the CONTRACT's `ProvenanceEventType` enum
-- (`admin-audit-access-visible-to-lead.test.ts` asserts the two match member for member).
-- Adding a malware-specific member there means also adding it to that contract enum, and
-- this feature does not own that bundle's vocabulary -- doing so here would be exactly the
-- "one fact declared in two places" pattern this repo has already drifted on five times
-- (AGENTS.md). A malware rejection is also not the same KIND of fact as those events: it
-- describes bytes that were REFUSED -- no artifact, no artifact_version, nothing in the
-- `target_kind` closed set (`artifact` / `artifact-version` / `capability` / `membership` /
-- `project` / `organization`) legitimately names a thing that was never created.
--
-- What E2 actually asks for -- "a record exists, is not downloadable, names the file/hash/
-- verdict/time/uploader, and raises an alert" -- is fully expressed by this table on its
-- own: there is deliberately no object-storage key column anywhere below, so "not
-- downloadable" is not a flag to check, it is a column that does not exist.
--
-- Replayable: IF NOT EXISTS / OR REPLACE throughout (migrate:check force-replays every file
-- ignoring the version table).

CREATE TABLE IF NOT EXISTS malware_quarantine_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id    text,
  -- Untrusted input (R7 ②: "文件名同样是不可信输入") -- stored as opaque text, never
  -- interpreted, never used to build a path.
  filename      text NOT NULL,
  content_hash  text NOT NULL,
  scan_verdict  text NOT NULL,
  uploaded_by   text NOT NULL,
  scanned_at    timestamptz NOT NULL DEFAULT now(),
  -- Whether the security-alert side effect actually fired. Recorded rather than assumed:
  -- a row with `alerted = false` is a distinguishable, queryable "the file was caught but
  -- nobody was told" state instead of a silent one.
  alerted       boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS malware_quarantine_records_org_idx
  ON malware_quarantine_records (org_id, scanned_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = 'malware_quarantine_records'
  ) THEN
    RAISE EXCEPTION 'malware_quarantine_records did not get created';
  END IF;
END
$$;

ALTER TABLE malware_quarantine_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE malware_quarantine_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS malware_quarantine_records_tenant ON malware_quarantine_records;
CREATE POLICY malware_quarantine_records_tenant ON malware_quarantine_records
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- Append-only from the application's perspective: a scan conclusion, once recorded, is not
-- editable and the row is not something a normal request path deletes (E2: "上传恶意文件
-- 必须留痕，不得因为拒绝而抹掉记录"). No UPDATE/DELETE grant at all -- narrower than
-- provenance_events' trigger-based approach, and sufficient here because nothing needs to
-- delete an individual row outside of whole-tenant teardown (which goes through the table
-- owner, same as every other tenant table).
REVOKE ALL ON malware_quarantine_records FROM app_rw;
GRANT SELECT, INSERT ON malware_quarantine_records TO app_rw;
