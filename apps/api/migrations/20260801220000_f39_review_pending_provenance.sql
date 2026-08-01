-- F39: REVIEW_PENDING 人工复核 + AI 补齐缺料 (uc-22-2 R3 步骤 11 / R8 / A4 / V13)
--
-- 唯一的 schema 改动：`provenance_events_type_check` 追加 `review-accepted` /
-- `review-rejected` 两个成员（ADR-101 先例，2026-08-01 F39 追加记录）——
-- `resolveReviewPending`（application/files/resolve-review-pending.ts）的接受/拒绝
-- 处置需要写审计（R8「处置意见都会写入审计」），既有封闭枚举里没有能表达
-- "对一份 REVIEW_PENDING 材料的复核处置" 的成员。
--
-- 本 feature 的其余部分（PII 五类检出、ReviewGate 的机密/PII 判定、AI 补料的
-- provenance.json 七键）全部是纯领域/应用层逻辑，不需要新表或新列：
--   - 机密标记复用 0023 已有的 `artifacts.confidential`；
--   - REVIEW_PENDING / READY 复用 F36 既有的 `ingestion_status` 枚举与
--     `ingestion_outbox` 状态机（`enqueue`/`claimForVersion`/`completeAndAdvance`）；
--   - AI 补料复用 F04 `MATERIALIZATION_PLAN["ai-generated"]` 既有的两文件计划。
-- 复核处置本身（谁在何时接受/拒绝、理由）的持久化留给后续 controller 落地时选择
-- 表结构；本迁移只开这一个必需的枚举口子，避免"先造表、门控却指向另一张"的漂移。
--
-- Replayable: DO $$ ... $$ 块可重复执行（DROP + ADD 同一个约束名）。

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
    'deletion-requested',
    -- F39 (Proposed, 需人类追认 -- 见 ADR-101 2026-08-01 F39 追加记录)
    'review-accepted', 'review-rejected'
  ));
END
$$;
