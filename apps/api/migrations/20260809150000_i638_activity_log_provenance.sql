-- #638 迭代 4: 六条写路径补 provenance 落库 —— 改名/换头像/改密码/建团队/改名团队/删团队。
--
-- `provenance_events_type_check` 追加 6 个成员，`provenance_events_target_kind_check`
-- 追加 2 个成员（ADR-101 追加记录，Proposed / pending human ratification —— 见
-- `packages/contracts/src/provenance.ts` 自己的注释与 `docs/adr/
-- ADR-101-provenance-event-type-missing-members.md` 的 #638 追加段落）。
--
-- 携带此前每一次迁移已经追加过的全部成员（最近一次改动 CHECK 的是
-- `20260802000000_f46_trash_queue_legalhold_retention.sql`）——DROP+ADD 若漏掉任何一个
-- 会静默把它从 CHECK 里撤销，正是 F137/F46 迁移注释反复提醒的失败模式。
--
-- Replayable: DROP+ADD for the CHECK (0027 起的既定写法)。

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
    'legal-hold-applied', 'legal-hold-released',
    'unauthorized-attempt',
    -- #638 迭代 4 (Proposed, 需人类追认 -- 见 ADR-101 追加记录)
    'profile-renamed', 'avatar-changed', 'password-changed',
    'team-created', 'team-renamed', 'team-deleted'
  ));

  ALTER TABLE provenance_events DROP CONSTRAINT IF EXISTS provenance_events_target_kind_check;
  ALTER TABLE provenance_events ADD CONSTRAINT provenance_events_target_kind_check CHECK (
    target_kind IN (
      'artifact', 'artifact-version', 'capability', 'membership', 'project', 'organization',
      'interview', 'thread', 'subject', 'asset',
      -- #638 迭代 4 (Proposed, 需人类追认)
      'account', 'team'
    ));
END
$$;
