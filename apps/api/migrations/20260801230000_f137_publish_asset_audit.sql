-- F137: PublishAsset -- 三条独立禁用条件 (GATE_NOT_PASSED / GOVERNANCE_INCOMPLETE /
-- PREFLIGHT_HAS_BLOCKING_ITEM) + reviewDueAt 派生 + 发布写审计 (uc-23-4 R3/R7/R9)
--
-- `provenance_events` gains ONE more event type (`asset-published`) and ONE more target kind
-- (`asset`) -- ADR-101-style addition (Proposed, pending human ratification), same convention
-- 0027/20260801140000/20260801150000/20260801210000 already established: DROP+ADD the CHECK,
-- cite the contract's own comment for the "why", let
-- `apps/api/tests/files/provenance-enum-single-source.test.ts` gate both directions
-- mechanically (it reads the CHECK and the contract dynamically, no edit needed there).
--
-- Replayable: DROP+ADD for the CHECK (0027's own convention).

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
    -- F137 (Proposed, 需人类追认 -- 见 packages/contracts/src/provenance.ts 的长注)
    'asset-published',
    'unauthorized-attempt'
  ));

  ALTER TABLE provenance_events DROP CONSTRAINT IF EXISTS provenance_events_target_kind_check;
  ALTER TABLE provenance_events ADD CONSTRAINT provenance_events_target_kind_check CHECK (
    target_kind IN (
      'artifact', 'artifact-version', 'capability', 'membership', 'project', 'organization',
      'interview', 'thread', 'subject',
      -- F137 (Proposed, 需人类追认)：六种资产统一治理面的发布审计目标。
      'asset'
    ));
END
$$;
