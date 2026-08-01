-- 20260801190000 F45: 删除影响面预览 + 二次确认 + 六类级联失效 + 两级 SLA
-- (contracts/files usecases.md `previewDeleteImpact`/`requestDeletion`/`getDeletionTask`,
--  requirements/22-files/uc-22-4-版本-派生物与删除传播.md R3.c/R7/R12 V4-V7)
--
-- ## What this migration adds, and why each piece is the minimum for F45's scope
--
--   1. `artifacts.deleted_at` -- the ONE flag cascade ① ("浏览器条目消失") flips. It is read
--      by `wsx_visible_artifacts()` (0023), which is ALSO the predicate F32's download path
--      joins through (`pg-download-grant-repository.ts`'s `findVisibleVersion`). One column,
--      one function edit, and "浏览器里那份消失" + "每一个 version 的 download URL 返回
--      404" (V4·22-4) become the SAME fact rather than two flags that can drift apart.
--   2. `legal_holds` -- `requestDeletion`'s `LEGAL_HOLD_ACTIVE` check needs a real table to
--      check against. `applyLegalHold`/`releaseLegalHold` (the operations that WRITE this
--      table) are F46's job (`feature_list.json` F46: "legal hold"); F45 only needs to be
--      able to ask "is one active right now", the same way F14's migration needed
--      `project_participants.withdrawn_at` before F45/F46 owned the engine that acts on it.
--   3. `deletion_tasks` / `deletion_cascade_results` -- the five-step task `getDeletionTask`
--      reads (F46 exposes `getDeletionTask`/`listTrashQueue`; F45 is the writer that creates
--      the row and records the SIX logical-cascade outcomes synchronously, R3.c step 9).
--   4. `context_packs.invalidated_at` -- cascade ⑥ needs somewhere to record "this pack must
--      not be served again" without touching `recorded`/`content_hash` (I-7: a pinned pack's
--      recorded inputs are frozen; invalidation is an ANNOTATION next to the snapshot, the
--      same shape `withdraw-evidence.ts` already uses for artifact versions -- see that
--      file's header for why "annotate next to" and not "mutate" is the rule here too).
--   5. `provenance_events_type_check` gains `deletion-requested` -- ADR-101's established
--      precedent for a signed enum missing a member a new feature's audit trail needs; see
--      the ADR's 2026-08-01 (F45) addendum and `packages/contracts/src/provenance.ts`.
--
-- Explicitly NOT here (F46's scope, per feature_list.json): `applyLegalHold`/
-- `releaseLegalHold` write paths, `listTrashQueue`/`retryCascade`/`revokeDeletion`, the
-- physical-delete worker, and `getDeletionReceipt`'s `receipt_id` becoming non-null.
--
-- Replayable: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE,
-- `migrate:check` force-replays each file ignoring the version table.

/* ────────── ① artifacts.deleted_at + the ONE predicate that reads it ────────── */

ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS artifacts_deleted_idx ON artifacts (org_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Re-declared with ONE added predicate (`a.deleted_at IS NULL`) inside the `bound` CTE.
-- Everything else is byte-for-byte 0023's body -- see that file for the scope logic itself.
CREATE OR REPLACE FUNCTION wsx_visible_artifacts(p_project_id text, p_requester_team_id text)
RETURNS TABLE (artifact_id text, scope text, owner_team_id text)
LANGUAGE sql
STABLE
AS $$
  WITH bound AS (
    SELECT a.id AS artifact_id,
           array_agg(DISTINCT b.owner_team_id) FILTER (WHERE b.scope = 'team-only') AS teams
      FROM artifacts a
      LEFT JOIN acl_bindings b
             ON b.org_id = a.org_id
            AND b.object_kind = 'artifact'
            AND b.object_id = a.id
     WHERE a.project_id = p_project_id
       -- F45 (V4·22-4): a logically-deleted artifact is not visible through the ONE
       -- predicate F31/F32/F34 all share -- so it disappears from the browser AND every
       -- one of its versions' download URLs answers ARTIFACT_NOT_FOUND, by construction.
       AND a.deleted_at IS NULL
     GROUP BY a.id
  ),
  effective AS (
    SELECT artifact_id,
           CASE WHEN teams IS NULL THEN 'org-wide' ELSE 'team-only' END AS scope,
           CASE
             WHEN teams IS NULL THEN NULL
             WHEN array_length(teams, 1) = 1 THEN teams[1]
             ELSE '__unsatisfiable__'
           END AS owner_team_id
      FROM bound
  )
  SELECT e.artifact_id, e.scope, e.owner_team_id
    FROM effective e
   WHERE e.scope = 'org-wide'
      OR (p_requester_team_id IS NOT NULL AND p_requester_team_id = e.owner_team_id);
$$;

/* ────────── ② legal_holds -- read-side for requestDeletion's LEGAL_HOLD_ACTIVE ────────── */

CREATE TABLE IF NOT EXISTS legal_holds (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  artifact_id  text NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  reason       text NOT NULL CHECK (length(reason) > 0),
  applied_by   text NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  -- NULL = still active. Released holds are kept (append-mostly), not deleted -- "解除同样
  -- 全程留痕" (usecases.md `releaseLegalHold`) needs the history, not just the current state.
  released_by  text,
  released_at  timestamptz,
  release_reason text,
  CONSTRAINT legal_holds_release_all_or_none CHECK (
    (released_by IS NULL AND released_at IS NULL AND release_reason IS NULL)
    OR (released_by IS NOT NULL AND released_at IS NOT NULL AND release_reason IS NOT NULL)
  )
);

-- At most one ACTIVE hold per artifact -- a second `applyLegalHold` while one is already
-- active would either silently no-op or produce two holds that release independently,
-- neither of which the contract (`holdId, appliedBy, appliedAt`) can express.
CREATE UNIQUE INDEX IF NOT EXISTS legal_holds_active_uniq
  ON legal_holds (org_id, artifact_id) WHERE released_at IS NULL;

/* ────────── ③ deletion_tasks / deletion_cascade_results ────────── */

CREATE TABLE IF NOT EXISTS deletion_tasks (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  artifact_id  text NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  requested_by text NOT NULL,
  -- 🔴 D-39 / usecases.md 「agent 不得发起删除」: recorded so an audit query can confirm no
  -- task was ever created by an agent actor, without having to cross-reference a separate
  -- actor registry.
  actor_kind   text NOT NULL CHECK (actor_kind IN ('user', 'agent')),
  reason       text NOT NULL CHECK (length(reason) >= 4),
  -- NULL = full deletion. Non-null = A3's partial withdrawal ("撤回「AI 分析」不删录音");
  -- the scope-to-cascade-subset mapping is T-8, unruled (`files.KNOWN_CONTRACT_GAPS`
  -- references it) -- this column only STORES what the caller asked for.
  scope        text,
  -- `files.operations.getDeletionTask.out.status`. F45 writes 'pending' at creation and
  -- 'running'/'partial-failure' once the synchronous logical cascade has run
  -- (`domain/files/deletion-cascade.ts`'s `deriveLogicalCascadeStatus`); F45 NEVER writes
  -- 'done' -- that is the physical-delete worker's (F46) transition, gated on a real receipt.
  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'partial-failure')),
  requested_at timestamptz NOT NULL,
  logical_invalidation_deadline timestamptz NOT NULL,
  physical_deletion_deadline    timestamptz NOT NULL,
  -- N-18: non-null IFF physical deletion has completed. F45 never sets this (it has no
  -- physical-delete worker); the column exists now so F46 does not need a second migration
  -- to add the field `getDeletionTask.out.receiptId` already promises.
  receipt_id   text,
  CONSTRAINT deletion_tasks_deadlines_ordered
    CHECK (requested_at <= logical_invalidation_deadline
       AND logical_invalidation_deadline <= physical_deletion_deadline),
  -- N-17, at the schema level: a task cannot claim 'done' without a receipt, and cannot claim
  -- 'partial-failure' WITH one (a receipt for a task that N-17 says must not have one yet).
  CONSTRAINT deletion_tasks_receipt_iff_done CHECK (
    (status = 'done') = (receipt_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS deletion_tasks_artifact_idx ON deletion_tasks (org_id, artifact_id);
CREATE INDEX IF NOT EXISTS deletion_tasks_status_idx ON deletion_tasks (org_id, status);

CREATE TABLE IF NOT EXISTS deletion_cascade_results (
  task_id    text NOT NULL REFERENCES deletion_tasks (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Mirrors `files.CascadeKind` member-for-member (asserted in
  -- `deletion-cascade-kind-enum.test.ts`) -- six values, no more, no fewer.
  kind       text NOT NULL CHECK (kind IN (
    'browser-entry', 'derived-files', 'pgvector', 'fts-segments', 'ontology-edges',
    'context-pack-cache'
  )),
  result     text NOT NULL CHECK (result IN ('ok', 'failed', 'pending')),
  detail     text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, kind)
);

/* ────────── ④ context_pack_invalidations -- cascade ⑥, annotated NEXT TO, never IN ────────── */
--
-- A COMPANION table, not a column on `context_packs`. `context_pack_pin_is_final()` (0016)
-- refuses ANY `UPDATE ... SET` on a PINNED run, unconditionally -- "its recording, hash and
-- pin are write-once" (I-7). An `invalidated_at` COLUMN on that table would be unwritable for
-- exactly the packs I-7 most needs to protect (the pinned ones a decision actually cites),
-- discovered by running this migration's first draft against a pinned fixture row. Same
-- discipline `withdraw-evidence.ts` already uses for `artifact_versions` (see that file's
-- header): the fact goes NEXT TO the frozen row, in a table that is not itself frozen.

CREATE TABLE IF NOT EXISTS context_pack_invalidations (
  pack_id        text PRIMARY KEY REFERENCES context_packs (run_id) ON DELETE CASCADE,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  invalidated_at timestamptz NOT NULL DEFAULT now(),
  reason         text NOT NULL
);

/* ────────── ⑤ provenance_events: +1 member (ADR-101, F45 addendum) ────────── */

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
    'integrity-check-failed',
    'unauthorized-attempt',
    'contact-revealed',
    'approval-requested', 'approval-decided',
    -- F45 (Proposed, 需人类追认 -- 见 ADR-101 2026-08-01 追加记录)
    'deletion-requested'
  ));
END
$$;

/* ─────────────────────────── RLS ─────────────────────────── */

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legal_holds', 'deletion_tasks', 'deletion_cascade_results', 'context_pack_invalidations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON legal_holds TO app_rw;
GRANT SELECT, INSERT, UPDATE ON deletion_tasks TO app_rw;
GRANT SELECT, INSERT, UPDATE ON deletion_cascade_results TO app_rw;
-- Append-only: an invalidation is a fact, not a state to be edited back out.
GRANT SELECT, INSERT ON context_pack_invalidations TO app_rw;

-- ⚠ 必须显式调用一次，不能指望旧迁移自己扫到这三张新表——同 0019/0027/0033 等每次新增
-- 租户表的成例。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON COLUMN artifacts.deleted_at IS
  'F45: non-null means logically deleted (cascade ①). Read by wsx_visible_artifacts(), so '
  'the browser, download, rename and search paths all lose the row through the ONE predicate '
  'rather than four independent checks that could drift.';
COMMENT ON TABLE deletion_tasks IS
  'F45 writes rows with status pending|running|partial-failure (never done -- that is the '
  'physical-delete worker''s transition, F46, gated on receipt_id).';
COMMENT ON TABLE context_pack_invalidations IS
  'F45 cascade ⑥. A row here, never a column on context_packs -- 0016''s pin trigger refuses '
  'any UPDATE on a pinned run, so invalidation is annotated next to the frozen row rather '
  'than mutating it (same discipline as application/artifact/withdraw-evidence.ts).';
