-- F46: 待删除队列（合规角色）+ legal hold 施加/解除 + 留存参数（项目级覆盖）+
-- 物理删除 worker 的回执落点 (uc-22-4 R3.c/R3.d, N-18/N-19/N-20)
--
-- ## What this migration adds, and why each piece is the minimum for F46's scope
--
--   1. `provenance_events_type_check` gains `legal-hold-applied` / `legal-hold-released`
--      (ADR-101-style addition, Proposed / pending human ratification -- see
--      `packages/contracts/src/provenance.ts`'s own comment and the ADR-101 doc's 2026-08-02
--      F46 addendum). Carries forward every member added by every migration up to and
--      including `20260801230000_f137_publish_asset_audit.sql` -- a DROP+ADD that dropped one
--      of those would silently un-declare it, exactly the failure mode F137's own migration
--      comment warns about.
--
--   2. `retention_policies` -- the persistence for `setRetentionPolicy`'s PROJECT-level
--      override (D-14: "组织默认由管理员配；项目级覆盖由项目负责人配"). One row per project
--      that has ever called `setRetentionPolicy`; a project with no row simply has no
--      override, and `getRetentionPolicy` falls back to `files.DEFAULT_RETENTION_PARAMS`
--      entirely in application code (`domain/files/retention-policy.ts`'s
--      `resolveRetentionParams`). Columns are NULLABLE per-field -- `setRetentionPolicy.in.
--      params` is `RetentionParams.partial()`, so a project may override only
--      `trashGraceDays` and leave the other four inheriting the org default; a NOT NULL
--      column would force every field to be decided the moment ANY one of them is.
--      ⚠ No org-level table here: this contract's `setRetentionPolicy` takes only
--      `projectId`, never `orgId` -- the org-wide default is `DEFAULT_RETENTION_PARAMS`,
--      a single constant, not a per-org row (see that const's header for why: an org-level
--      admin operation to override it is out of this bundle's signed scope).
--
--   3. `deletion_receipts` -- `getDeletionReceipt`'s persistence, written once by the
--      physical-delete worker at the moment `deletion_tasks.status` flips to `'done'`
--      (N-18: `receiptId` non-null IFF physical deletion completed). Deliberately does NOT
--      duplicate `coverage` (the six-category cascade outcome) -- that already lives in
--      F45's `deletion_cascade_results`, joined by `task_id` at read time; a second copy
--      here would be exactly the "same fact declared twice" failure AGENTS.md flags.
--
-- Explicitly NOT here: the actual object-store bytes (existing `ObjectStore`/`FsObjectStore`
-- own those; this migration only records WHAT was purged and WHEN, per N-19's disclosure
-- requirement).
--
-- Replayable: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS, DROP+ADD for the CHECK.

/* ────────── ① provenance_events: +2 members (ADR-101, F46 addendum) ────────── */

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
    'contact-revealed',
    'approval-requested', 'approval-decided',
    'deletion-requested',
    'review-accepted', 'review-rejected',
    'asset-published',
    'unauthorized-attempt',
    -- F46 (Proposed, 需人类追认 -- 见 ADR-101 2026-08-02 F46 追加记录)
    'legal-hold-applied', 'legal-hold-released'
  ));
END
$$;

/* ────────── ② retention_policies -- project-level override of O-01's five params ────────── */

CREATE TABLE IF NOT EXISTS retention_policies (
  project_id     text PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  material_days     integer CHECK (material_days IS NULL OR material_days > 0),
  derived_days      integer CHECK (derived_days IS NULL OR derived_days > 0),
  log_days          integer CHECK (log_days IS NULL OR log_days > 0),
  trash_grace_days  integer CHECK (trash_grace_days IS NULL OR trash_grace_days > 0),
  backup_days       integer CHECK (backup_days IS NULL OR backup_days > 0),
  updated_by     text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

/* ────────── ③ deletion_receipts -- N-18/N-19's persistence ────────── */

CREATE TABLE IF NOT EXISTS deletion_receipts (
  task_id               text PRIMARY KEY REFERENCES deletion_tasks (id) ON DELETE CASCADE,
  org_id                text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  object_refs           text[] NOT NULL,
  hashes                text[] NOT NULL,
  deleted_at            timestamptz NOT NULL,
  executor              text NOT NULL,
  -- 🔴 N-19: 必填非空——「无」是诚实答案，字段消失读起来像「已全部覆盖」。
  uncoverable_statement text NOT NULL CHECK (length(uncoverable_statement) > 0),
  -- Snapshot of `deleteImpact.exportedOutOfOrg` AT THE MOMENT the receipt was issued (the
  -- live query could answer differently later if a NEW export happens after physical
  -- deletion -- a receipt is a point-in-time attestation, not a live view).
  exported_out_of_org   jsonb NOT NULL DEFAULT '[]'::jsonb
);

/* ─────────────────────────── RLS ─────────────────────────── */

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['retention_policies', 'deletion_receipts']
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

GRANT SELECT, INSERT, UPDATE ON retention_policies TO app_rw;
-- Append-only: a receipt is a fact issued once (N-18); nothing about it is editable after.
GRANT SELECT, INSERT ON deletion_receipts TO app_rw;

-- ⚠ 必须显式调用一次，不能指望旧迁移自己扫到这两张新表——同 0019/0027/0033/
-- 20260801210000 等每次新增租户表的成例。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE retention_policies IS
  'F46: project-level override of the O-01 five retention params (D-14). No row = no '
  'override; the org-wide default is files.DEFAULT_RETENTION_PARAMS, a single constant, '
  'not a second table.';
COMMENT ON TABLE deletion_receipts IS
  'F46: getDeletionReceipt persistence, written once by the physical-delete worker at the '
  'moment a deletion_tasks row flips to status=''done'' (N-18). coverage is NOT duplicated '
  'here -- read deletion_cascade_results by task_id (F45).';
