-- F109 续：对话置顶服务端持久化（rev-uiux 差距分析 P1-4，人类直接指令 ad-hoc 落地，
-- 无 design-signoff.md —— 见 packages/contracts/src/chat.ts `ThreadCard.pinned` 头注、
-- docs/adr/ADR-101-provenance-event-type-missing-members.md 2026-09-03 追加段落）。
--
-- 取代 apps/web/lib/chat-pinned-threads.ts 的 localStorage 方案（该文件头注原话
-- 「跨设备需签核」——现在补上）。
--
-- Replayable：ADD COLUMN IF NOT EXISTS / DROP-then-ADD CHECK（同本仓既定写法）。

ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN chat_threads.pinned IS
  'F109 续（2026-09-03，ad-hoc，无 design-signoff.md）：服务端持久化的置顶态，取代
   apps/web/lib/chat-pinned-threads.ts 的 localStorage 方案。默认 false——既有线程
   迁移时全部未置顶，不假装历史数据本就置顶过。';

-- `provenance_events_type_check` 追加 `thread-pinned`/`thread-unpinned` 两个成员
-- （ADR-101 追加记录，Proposed / pending human ratification —— 见
-- `packages/contracts/src/provenance.ts` 自己的注释与 ADR-101 2026-09-03 追加段落）。
--
-- 携带此前每一次迁移已经追加过的全部成员（最近一次改动 CHECK 的是
-- `20260809150000_i638_activity_log_provenance.sql`）——DROP+ADD 若漏掉任何一个
-- 会静默把它从 CHECK 里撤销，正是既往迁移注释反复提醒的失败模式。
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
    'team-created', 'team-renamed', 'team-deleted',
    -- F109 续 (2026-09-03, ad-hoc, Proposed, 需人类追认 -- 见 ADR-101 追加记录)
    'thread-pinned', 'thread-unpinned'
  ));
END
$$;
