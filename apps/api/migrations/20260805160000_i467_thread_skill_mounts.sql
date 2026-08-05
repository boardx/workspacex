-- #467: storage for **per-thread temporary Skill mounts** (contract bundle `skills`, F65).
--
-- ## Why a new table instead of widening `skill_mounts.target_kind`
--
-- `20260804031000_wave2_skill_starter_import.sql:59` has
--
--     target_kind text NOT NULL CHECK (target_kind IN ('repository', 'project'))
--
-- and #509 proposed adding `'thread'` to that closed set. **That would be wrong**, for the
-- same structural reason #459 gave when it refused to widen `skills.status`: that table
-- belongs to the **file-package** model. Its rows carry `mount_path`, `enabled`, and foreign
-- keys into `skills` / `skill_versions` -- a mounted Skill there is *a directory grafted at a
-- path*. A thread mount is a different fact: *this conversation may currently use this Skill
-- version*. It has no path, no enable flag, and it is removed by timestamp rather than by
-- deletion (I-19/V3: unmounting must not retroactively change badges on past messages).
--
-- Widening the CHECK would give one table two meanings for `target_id` and force every reader
-- to know which model a row came from. So thread mounts get their own table, shaped 1:1 to the
-- contract type `ThreadSkillMount` and to `ThreadMountStorePort` (`load` / `save`).
--
-- ⚠ This is **additive**: no existing constraint, row, or grant changes. The closed set stays
--    exactly as it was, so nothing that reads `skill_mounts` needs re-review.
--
-- ## Why `removed_at` instead of DELETE
--
-- I-19/V3: unmounting does **not** retroactively strip the Skill badge from messages that were
-- generated while it was mounted. A deleted row cannot answer "was this mounted at 14:03?", so
-- removal is a timestamp. `activeMounts()` (domain) is the single place that turns the stored
-- rows into "currently mounted", and `listThreadSkillMounts` is the only read that exposes it.

CREATE TABLE IF NOT EXISTS thread_skill_mounts (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id        text NOT NULL,
  skill_id         text NOT NULL,
  -- The mounted **version**, not the Skill: I-18 pins a conversation to what it actually ran
  -- with, so publishing a new version must not silently change a live thread.
  version_id       text NOT NULL,
  mounted_by       text NOT NULL,
  mounted_at       timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz
);

-- One **active** mount per (thread, skill): mounting the same Skill twice is not a second
-- fact, it is the same fact. Partial on `removed_at IS NULL` so a Skill can be mounted,
-- removed, and mounted again later -- the history stays, only the live row is unique.
CREATE UNIQUE INDEX IF NOT EXISTS thread_skill_mounts_active_uniq
  ON thread_skill_mounts (org_id, thread_id, skill_id)
  WHERE removed_at IS NULL;

-- The read path is always "everything for this thread" (`ThreadMountStorePort.load`).
CREATE INDEX IF NOT EXISTS thread_skill_mounts_thread_idx
  ON thread_skill_mounts (org_id, thread_id);

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE thread_skill_mounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_skill_mounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS thread_skill_mounts_tenant ON thread_skill_mounts;
CREATE POLICY thread_skill_mounts_tenant ON thread_skill_mounts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON thread_skill_mounts FROM app_rw;
-- UPDATE is needed for exactly one column transition: `removed_at` NULL -> now(). There is no
-- DELETE grant, which is the structural half of I-19/V3 -- dropping mount history in place
-- would require a migration, i.e. a change someone reviews, rather than one more `DELETE`
-- in a repository nobody re-reads.
GRANT SELECT, INSERT, UPDATE ON thread_skill_mounts TO app_rw;

-- F22 的组织冻结是**按 catalog 推导**的，而它只看得见「上次运行时已存在」的表。
-- 新建一张带租户外键的表而不重跑这个 helper，那张表就会缺 INSERT/UPDATE/DELETE
-- 三条 RESTRICTIVE 策略 —— 一个已冻结的组织仍然能往里写。
--
-- ⚠ 这一条不是我想起来加的，是 `org-disabled-readonly.test.ts` 里那条
--   「每一张带租户外键的表都有三条 RESTRICTIVE 策略」把它打红逼出来的。
--   #459 的迁移末尾逐字有同一句 —— 规则写在那儿没拦住我，**门拦住了**。
SELECT kernel_apply_org_freeze_policies();
