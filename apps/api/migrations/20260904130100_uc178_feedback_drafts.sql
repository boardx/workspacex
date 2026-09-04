/*
 * UC-17.8 B1（2026-09-04 人类裁决）—— 反馈草稿真栈化：`product_feedback_drafts` +
 * `feedback_attachments.draft_id`。
 *
 * 契约：`packages/contracts/src/feedback-loop.ts` 的 `FeedbackDraft` 与六条 `*FeedbackDraft*` 操作。
 *
 * ## 为什么是一张新表，不是 `product_feedback` 加一个 `is_draft` 布尔
 *
 * 契约头注逐字：草稿没有状态机、没有票、没有 D3 可见性、没有 GitHub。合进 `product_feedback`
 * 会让那张表的每条不变量（正文非空 CHECK、不可变列触发器、`待处理` 起步的状态流水）都要
 * 加一句「草稿除外」——而草稿恰恰是**可以反复改正文**的东西，与「反馈是历史事实」正相反。
 *
 * ## 谁能读写：per-org RLS + **owner 谓词在应用层**
 *
 * 本仓所有租户表的 RLS 只按 `app.current_org` 判（见 `0023-f31-files-browser.sql` 的论证：
 * 每条既有写路径只设 org，一条按 user 键的 RESTRICTIVE policy 会让它们全部读到零行）。
 * 「只有 owner 能列/改/删/提交」这条规则因此由仓储的每一条 SQL 谓词 `owner_id = $n` 表达
 * （同 `pg-skill-trial-run-store.ts` 的 `actor_id = $3`、`pg-task-repository.ts` 的
 * `owner_user_id = $self`），并由 `tests/feedback/draft-repository-guard.test.ts` 解析源码
 * 守住——不是一句注释。
 *
 * ## 对话是一列 jsonb 数组（`chat`），不是一张子表
 *
 * 契约 `updateFeedbackDraft` 逐字：对话**追加不覆盖**。它只在草稿存续期间有意义，草稿提交
 * 时**不进反馈正文**、草稿删除时随之消失——它没有独立生命周期，也没有任何按条查询的需求，
 * 建子表只是为一个整取整存的列表多背一次 join。形状由契约 `FeedbackDraftChatTurn` 闭合。
 *
 * ## 附件：`draft_id` 是第二个可空挂靠点
 *
 * `feedback_attachments` 原本两态：未认领（`feedback_id IS NULL`）/ 已认领。这里多一态
 * 「挂在草稿上」（`feedback_id IS NULL AND draft_id IS NOT NULL`）。CHECK 禁止两者同时非空
 * ——一个附件同一时刻只属于一个东西。`ON DELETE SET NULL`：删草稿时附件回到未认领
 * （契约 `deleteFeedbackDraft` 逐字「回到未认领并随清理任务回收」）；这是数据库层的兜底，
 * 应用层 `releaseDraftAttachments` 是同一件事的显式版本，两者都在是为了 fake 仓储的单测能
 * 断言到这一步，而直连 SQL 删草稿时也不会留下悬空的 `draft_id`。
 *
 * Replayable：IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS，重放安全。
 */

CREATE TABLE IF NOT EXISTS product_feedback_drafts (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 草稿是提交人的私有物。不加 FK 到 credentials，同 product_feedback.submitted_by。
  owner_id        text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('缺陷', '需求')),

  target_kind     text NOT NULL CHECK (target_kind IN ('product', 'agent', 'skill')),
  target_agent_id text NULL,
  target_skill_id text NULL,

  -- ⚠ 允许空：草稿的意义正是「先占个位」。空正文在 `submitFeedbackDraft` 被 DRAFT_EMPTY 拒。
  detail          text NOT NULL DEFAULT '',
  structured      jsonb NULL,
  chat            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(chat) = 'array'),
  refine_seeded   boolean NOT NULL DEFAULT false,

  -- I-F1：客户端给的复现上下文，分列存，同 product_feedback。
  occurred_route  text NULL,
  app_version     text NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- 目标三列同生同死，同 product_feedback_target_pairing。
  CONSTRAINT product_feedback_drafts_target_pairing CHECK (
    (target_kind = 'agent') = (target_agent_id IS NOT NULL)
    AND (target_kind = 'skill') = (target_skill_id IS NOT NULL)
  )
);

/* 「我的草稿」是唯一的列表查询：按 owner、updated_at 倒序。 */
CREATE INDEX IF NOT EXISTS product_feedback_drafts_owner_idx
  ON product_feedback_drafts (org_id, owner_id, updated_at DESC);

ALTER TABLE feedback_attachments
  ADD COLUMN IF NOT EXISTS draft_id text NULL
    REFERENCES product_feedback_drafts (id) ON DELETE SET NULL;

ALTER TABLE feedback_attachments
  DROP CONSTRAINT IF EXISTS feedback_attachments_single_owner;
ALTER TABLE feedback_attachments
  ADD CONSTRAINT feedback_attachments_single_owner CHECK (
    NOT (feedback_id IS NOT NULL AND draft_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS feedback_attachments_draft_idx
  ON feedback_attachments (org_id, draft_id) WHERE draft_id IS NOT NULL;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE product_feedback_drafts ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE product_feedback_drafts FORCE ROW LEVEL SECURITY';
END
$$;

DROP POLICY IF EXISTS product_feedback_drafts_tenant ON product_feedback_drafts;
CREATE POLICY product_feedback_drafts_tenant ON product_feedback_drafts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON product_feedback_drafts FROM app_rw;
-- 草稿可改可删（契约 `updateFeedbackDraft` / `deleteFeedbackDraft` 硬删）——与 product_feedback
-- 「只有状态两列可改、不许删」正相反，这正是它们是两张表的理由。
GRANT SELECT, INSERT, UPDATE, DELETE ON product_feedback_drafts TO app_rw;

SELECT kernel_apply_org_freeze_policies();
