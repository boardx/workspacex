-- F98: 联系方式遮盖/查看留痕/导出排除 + [AI 建议人选]候选态（uc-6-7 R5/R8/AC3/AC7）
--
-- Two independent pieces:
--
--   1. `provenance_events` gains ONE more event type (`contact-revealed`) and ONE more
--      target kind (`subject`) -- ADR-101-style addition (Proposed, pending human
--      ratification), same convention 0027/0033 already established: DROP+ADD the CHECK,
--      cite the contract's own comment for the "why", let
--      `apps/api/tests/files/provenance-enum-single-source.test.ts` gate both directions
--      mechanically (it reads the CHECK and the contract dynamically, no edit needed there).
--   2. `interview_subjects.contact_cipher` now holds a JSON-encoded `SealedContact` envelope
--      (ciphertext + algorithm + keyId + sealedAt) written by a real `ContactCipher`,
--      replacing F97's placeholder (plaintext written into the same column). The column's
--      type does not change (still `text`) -- only what F98's application code puts in it
--      and how `findContactForReveal` reads it back out. This migration only updates the
--      column's own documentation to say so; no ALTER is needed for a `text` column to hold
--      a longer string.
--
-- Replayable: DROP+ADD for the CHECK (0027's own convention).

/* ────────── provenance_events: +1 event type, +1 target kind (uc-6-7 R8/AC7) ────────── */

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
    -- F98 (Proposed, 需人类追认 -- 见 packages/contracts/src/provenance.ts 的长注)
    'contact-revealed',
    'unauthorized-attempt'
  ));

  ALTER TABLE provenance_events DROP CONSTRAINT IF EXISTS provenance_events_target_kind_check;
  ALTER TABLE provenance_events ADD CONSTRAINT provenance_events_target_kind_check CHECK (
    target_kind IN (
      'artifact', 'artifact-version', 'capability', 'membership', 'project', 'organization',
      'interview', 'thread',
      -- F98 (Proposed, 需人类追认)：「这个访谈对象的联系方式被谁查看过」的检索面。
      'subject'
    ));
END
$$;

/* ────────── interview_subjects.contact_cipher: 文档更新，形状不变 ────────── */

COMMENT ON COLUMN interview_subjects.contact_cipher IS
  'F98: JSON-encoded SealedContact envelope (ciphertext + algorithm + keyId + sealedAt), '
  'produced by domain/interview/contact-vault.ts''s sealContact() via an injected '
  'ContactCipher. Replaces F97''s placeholder (plaintext written here). The only reader is '
  'application/interview/reveal-contact.ts (revealContact), which writes a '
  '''contact-revealed'' provenance event BEFORE decrypting.';
