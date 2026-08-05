-- #467 / #509: persistence for **in-thread temporary skill mounts** (contract bundle
-- `skills`, F65 -- `mountSkillToThread` / `unmountSkillFromThread`).
--
-- ## One table, keyed by thread -- because the port is
--
-- `ThreadMountStorePort` (`src/application/skill/ports.ts`) has exactly two methods and
-- both take a `threadId`. Invariant I-18 ("a temporary mount affects this conversation
-- only, never the blueprint, never another group's instance orchestration") is enforced
-- structurally there. This table is the storage half of the same shape: there is no
-- `project_id` and no `agenda_segment_id` column, so a mount written here cannot be read
-- back as a blueprint binding. Blueprint bindings live in the orchestration tables and
-- meet this one nowhere.
--
-- ## `removed_at`, not DELETE
--
-- I-19: unmounting does **not** retroactively rewrite the badges of messages already
-- produced under that mount. Keeping the row and stamping `removed_at` preserves the two
-- facts a retrospective needs -- that the mount existed, and when it stopped applying.
-- A DELETE would erase both. `app_rw` therefore gets UPDATE (to stamp `removed_at`) but
-- **no DELETE**: dropping the history requires a migration, i.e. a reviewable change.

CREATE TABLE IF NOT EXISTS thread_skill_mounts (
  mount_id    text NOT NULL,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id   text NOT NULL,
  skill_id    text NOT NULL,
  -- ⚠ Pinned at mount time and never recomputed: the mount records *which version was
  -- in effect*, so a later `publishNewVersion` does not silently change what a past
  -- conversation ran under (I-6).
  version_id  text NOT NULL,
  mounted_at  timestamptz NOT NULL,
  removed_at  timestamptz,
  PRIMARY KEY (mount_id),
  CONSTRAINT thread_skill_mounts_id_org_uniq UNIQUE (mount_id, org_id),
  CONSTRAINT thread_skill_mounts_skill_fk FOREIGN KEY (skill_id, org_id)
    REFERENCES skill_contracts (id, org_id) ON DELETE CASCADE
);

-- The read path is always "all mounts of one thread, oldest first" (`load(threadId)`).
CREATE INDEX IF NOT EXISTS thread_skill_mounts_thread_idx
  ON thread_skill_mounts (org_id, thread_id, mounted_at);

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE thread_skill_mounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_skill_mounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS thread_skill_mounts_tenant ON thread_skill_mounts;
CREATE POLICY thread_skill_mounts_tenant ON thread_skill_mounts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON thread_skill_mounts FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON thread_skill_mounts TO app_rw;

-- F22's catalog-driven organization freeze only sees tables that existed when it last ran.
SELECT kernel_apply_org_freeze_policies();
