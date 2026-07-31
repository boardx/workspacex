-- 0033 F34: 空态/依赖失败/无权限/完整性校验失败 + 契约态（改名重定向）
-- uc-22-1 R4/R7, contracts/files/usecases.md `renameArtifact` / `resolveArtifactAlias`.
--
-- Two independent pieces, in one file because both are small and both belong to F34:
--
--   1. `provenance_events_type_check` gains `integrity-check-failed` (V8·22-1, ADR-101-style
--      addition -- see the enum's own comment in packages/contracts/src/provenance.ts and the
--      addendum in docs/adr/ADR-101-provenance-event-type-missing-members.md, Proposed,
--      pending human ratification).
--   2. `artifact_aliases`: the table that makes N-23 ("目录结构与文件命名一旦对外可见即为契约")
--      more than a comment. See the table's own header below for why it stores only the OLD
--      name, never a chain of intermediate names.
--
-- Replayable: DROP+ADD for the CHECK (0027's own convention), CREATE TABLE IF NOT EXISTS for
-- the new table, migrate:check force-replays each file ignoring the version table.

/* ────────── provenance_events: +1 member (V8·22-1) ────────── */

DO $$
BEGIN
  ALTER TABLE provenance_events DROP CONSTRAINT IF EXISTS provenance_events_type_check;
  ALTER TABLE provenance_events ADD CONSTRAINT provenance_events_type_check CHECK (type IN (
    'ingested', 'transformed', 'generated', 'human-edited', 'pinned', 'bound', 'unbound',
    'superseded', 'evidence-withdrawn',
    'capability-added', 'capability-updated', 'capability-disabled', 'role-changed',
    'team-changed', 'admin-project-access', 'local-export',
    'downloaded',
    'project-created', 'project-archived', 'project-unarchived', 'agenda-segment-state-changed',
    'thread-created', 'thread-renamed', 'thread-deleted',
    -- F34 (Proposed, 需人类追认 -- 见 ADR-101 追加记录)
    'integrity-check-failed',
    'unauthorized-attempt'
  ));
END
$$;

/* ────────── artifact_aliases (N-23 / V11·22-1) ────────── */

-- Records only the artifact's PREVIOUS name at the moment of a rename, mapped to the
-- artifact id. It deliberately does NOT record the new name (that lives in `artifacts.title`,
-- which is the single current-state fact) and does NOT chain (path1 -> path2 -> path3).
--
-- Why that is sufficient for chained renames: `resolveArtifactAlias` always reads the
-- artifact's CURRENT `title` as `currentPath` at resolve time, rather than following a chain
-- of alias rows. So renaming A -> B -> C leaves two rows (`old_path in {A, B}`, both pointing
-- at the same `artifact_id`), and looking up EITHER old name lands on the live `title` (C).
-- Storing `new_path` per row would be a second declaration of "what is it called now" that
-- could drift from `artifacts.title` the moment a later rename forgot to update it.
CREATE TABLE IF NOT EXISTS artifact_aliases (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Denormalised from `artifacts.project_id` at write time rather than joined at read time:
  -- `resolveArtifactAlias`'s input is `{ projectId, path }` (uc-22-1 R7's "把一个视图发给同事"
  -- form assumes a project-scoped path), and an artifact's `project_id` can in principle
  -- change (F45's cascade), which must not retroactively break an OLD alias's project scope.
  project_id   text,
  artifact_id  text NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  old_name     text NOT NULL,
  reason       text NOT NULL,
  changed_by   text NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  -- Two different renames of two different artifacts to the same eventual name must not
  -- collide on their OLD name within one project -- but the same artifact can be renamed
  -- back and forth (A -> B -> A), which a plain UNIQUE(project_id, old_name) would forbid on
  -- the second A. changed_at breaks that tie without weakening the lookup: resolution always
  -- wants the MOST RECENT alias row for a given old name (see the index below).
  CONSTRAINT artifact_aliases_uniq UNIQUE (org_id, project_id, old_name, changed_at)
);

CREATE INDEX IF NOT EXISTS artifact_aliases_lookup_idx
  ON artifact_aliases (org_id, project_id, old_name, changed_at DESC);

/* ─────────────────────────── RLS ─────────────────────────── */

-- 与 0003 / 0022 / 0025 / 0027 同一形状：租户表一律 ENABLE + FORCE + 单条 org_id 策略。
DO $$
BEGIN
  ALTER TABLE artifact_aliases ENABLE ROW LEVEL SECURITY;
  ALTER TABLE artifact_aliases FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS artifact_aliases_tenant ON artifact_aliases;
  CREATE POLICY artifact_aliases_tenant ON artifact_aliases
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));
END
$$;

-- 只增不改不删：一次改名的历史事实一旦写入就不再变化（同 provenance_events 的 append-only 精神,
-- 但这张表连 SELECT-then-decide 都不需要，见 renameAndAlias 只 INSERT 不 UPDATE 这张表)。
GRANT SELECT, INSERT ON artifact_aliases TO app_rw;

-- ⚠ 必须显式调用一次，不能指望 0014 自己扫到这张新表——同 0019/0027 等每次新增租户表的成例。
SELECT kernel_apply_org_freeze_policies();
