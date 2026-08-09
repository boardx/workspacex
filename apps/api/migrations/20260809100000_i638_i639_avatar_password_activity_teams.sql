-- #638/#639 iteration 2 -- self-service profile (avatar/password/activity) + team CRUD.
--
-- Two independent, additive changes:
--   1. `user_avatars`      PG metadata row for `uploadOwnAvatar` (object storage holds the bytes).
--   2. `credentials`       +avatar_artifact_id / +avatar_url, so `updateOwnProfile` has somewhere
--                          to persist the artifact it was handed (delta self-service-profile §1).
--
-- ## What this migration does NOT do, and why -- `teams_org_name_uniq`
--
-- The team-crud delta's background section (SHA 76480df9, 2026-08-07) states the
-- `UNIQUE (org_id, name)` constraint "needs a migration to add" and that
-- `pg-team-repository.ts` references a constraint name that "was never created". That
-- turned out to be stale by the time this iteration actually ran: `grep -rl
-- teams_org_name_uniq apps/api/migrations` finds `20260731085758_f11_admin_invite_dual_
-- review.sql`, which already has `CREATE UNIQUE INDEX IF NOT EXISTS teams_org_name_uniq
-- ON teams (org_id, name)` -- predating this delta. So the enforcement mechanism
-- `createTeam`/`renameTeam` need for `TEAM_NAME_CONFLICT` (catching the `23505` from this
-- exact index name, same as F11's `mutateTeam` idempotent-replay path already does) was
-- already live. Adding a second `ALTER TABLE ... ADD CONSTRAINT teams_org_name_uniq` here
-- fails with "relation already exists" (a plain `CREATE UNIQUE INDEX`, unlike a table
-- constraint, leaves no `pg_constraint` row to guard against with an `IF NOT EXISTS`
-- check) -- caught during real Postgres testing, not left for the next person to hit.
-- Recorded here rather than silently dropped so the delta's background section is not
-- read as still-accurate.

/* ────────── ① user_avatars ────────── */

CREATE TABLE IF NOT EXISTS user_avatars (
  artifact_id  text PRIMARY KEY,
  user_id      text NOT NULL,
  object_key   text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5 * 1024 * 1024),
  sha256       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_avatars_user_idx ON user_avatars (user_id, created_at DESC);

COMMENT ON TABLE user_avatars IS
  'kernel-no-tenant-data: an avatar belongs to the ACCOUNT (credentials.user_id), same as '
  'display_name -- it exists before and across organizations (O-12), so there is no org_id '
  'column to scope it by. Ownership is enforced at the application layer '
  '(updateOwnProfile checks avatarArtifactId belongs to the calling userId), not by RLS.';

/* ────────── ② credentials: avatar columns ────────── */

DO $$
BEGIN
  BEGIN
    ALTER TABLE credentials ADD COLUMN avatar_artifact_id text REFERENCES user_avatars (artifact_id);
  EXCEPTION
    WHEN duplicate_column THEN NULL;
  END;
  BEGIN
    ALTER TABLE credentials ADD COLUMN avatar_url text;
  EXCEPTION
    WHEN duplicate_column THEN NULL;
  END;
END $$;

/* ────────── ③ grants ────────── */

GRANT SELECT, INSERT ON user_avatars TO app_rw;
