-- 项目中枢 R5 补丁（2026-09-27，用户直接交办 ad-hoc）：`provenance_events_type_check` 追加
-- `thread-visibility-changed`（`mutateThread` `op: "setVisibility"` 的审计事件）。
--
-- 契约 `packages/contracts/src/provenance.ts` 已随 R5 加了这个成员，迁移漏了——CI 的
-- `tests/files/provenance-enum-single-source.test.ts`（契约→SQL 双向对账）与
-- `tests/kernel/admin-audit-access-visible-to-lead.test.ts` 抓到：真库上改可见范围的审计
-- INSERT 被 CHECK 拒绝，接口 500（`tests/project/project-permission-chain.test.ts` 同样复现）。
-- ADR-101 2026-09-27 追加段记录（Proposed，需人类追认）。
--
-- Replayable：DROP-then-ADD CHECK（同本仓既定写法）。携带此前每一次迁移已经追加过的全部成员
-- （最近一次改动 CHECK 的是 `20260903161538_f109_thread_pinned.sql`）——漏掉任何一个会静默把它
-- 从 CHECK 里撤销。
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
    'thread-pinned', 'thread-unpinned',
    -- 项目中枢 R5 (2026-09-27, ad-hoc, Proposed, 需人类追认 -- 见 ADR-101 追加记录)
    'thread-visibility-changed'
  ));
END
$$;
