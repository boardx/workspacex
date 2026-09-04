/*
 * UC-17.8 D1 + D3（2026-09-04 人类裁决）—— 反馈的结构化补充字段 + 附件类型放宽。
 *
 * 契约：`packages/contracts/src/feedback-loop.ts` 的 `FeedbackStructured` / `FeedbackAttachmentMime`。
 * 依据：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md` §0.1。
 *
 * ## D1：`product_feedback.structured jsonb NULL`
 *
 * 一列 jsonb 而不是每字段一列——与 I-F1（反对「什么都能塞的 jsonb 口袋」）并不冲突：
 * 这一列的形状由契约 `FeedbackStructured`（`.strict()`，按 `kind` 定键集）闭合，写入侧
 * 经 zod 校验后才落库，排查时每个键都有名字。按 `kind` 扩字段 = 契约加一个键，不是一次迁移。
 *
 * ⚠ 它是**不可变列**：结构化字段是正文的补充，与正文同一条纪律（反馈是历史事实，提交人
 *   事后不能改）。`fb2_product_feedback_immutable_columns()` 逐列列出不可变列（见
 *   `20260815140000` 头注「逐列列出，不用通用 row diff」——正是为了让加列的人**显式**决定
 *   新列属于哪一边），本迁移 `CREATE OR REPLACE` 那个函数把 `structured` 加进名单。
 *   只在 INSERT 时写；任何 UPDATE 碰它一律被拒。
 *
 * ## D3：`feedback_attachments.content_type` 的 CHECK 从三种图片扩到六种
 *
 * 白名单的**唯一事实源**是契约 `FeedbackAttachmentMime`；这里的 CHECK 是它在数据库层的
 * 投影（同 `kind IN ('缺陷','需求')` 的既有写法），不是第二份白名单——契约加类型时
 * 这里必须跟着扩，否则应用层放行、数据库拒绝，会以 500 的形状暴露出来而不是静默放过。
 *
 * Replayable：IF NOT EXISTS / OR REPLACE / DROP CONSTRAINT IF EXISTS，重放安全。
 */

ALTER TABLE product_feedback
  ADD COLUMN IF NOT EXISTS structured jsonb NULL;

CREATE OR REPLACE FUNCTION fb2_product_feedback_immutable_columns() RETURNS trigger AS $$
BEGIN
  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.org_id          IS DISTINCT FROM OLD.org_id
     OR NEW.submitted_by    IS DISTINCT FROM OLD.submitted_by
     OR NEW.kind            IS DISTINCT FROM OLD.kind
     OR NEW.target_kind     IS DISTINCT FROM OLD.target_kind
     OR NEW.target_agent_id IS DISTINCT FROM OLD.target_agent_id
     OR NEW.target_skill_id IS DISTINCT FROM OLD.target_skill_id
     OR NEW.target_label    IS DISTINCT FROM OLD.target_label
     OR NEW.title           IS DISTINCT FROM OLD.title
     OR NEW.detail          IS DISTINCT FROM OLD.detail
     -- UC-17.8 D1：结构化补充字段与正文同一条纪律，只在 INSERT 写。
     OR NEW.structured      IS DISTINCT FROM OLD.structured
     OR NEW.occurred_route  IS DISTINCT FROM OLD.occurred_route
     OR NEW.app_version     IS DISTINCT FROM OLD.app_version
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  THEN
    -- ⚠ github_issue_url / github_issue_number / github_issue_claimed_at 故意不在名单里
    --   （`20260830120000` / `20260831010000` 加的可写回列）。
    -- ⚠ 异常文案保留原有前缀（`product-feedback-persistence.test.ts` 的正则锚定它）。
    RAISE EXCEPTION 'product_feedback: only status/status_reason are mutable (plus github_issue_url/github_issue_number, added 2026-08-30; structured is immutable, added 2026-09-04)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 建表时的 CHECK 是匿名约束，名字由 PG 派生（`feedback_attachments_content_type_check`）。
-- 先按派生名删，再以显式名字重建，之后每次扩类型只需改这一处。
ALTER TABLE feedback_attachments
  DROP CONSTRAINT IF EXISTS feedback_attachments_content_type_check;
ALTER TABLE feedback_attachments
  DROP CONSTRAINT IF EXISTS feedback_attachments_content_type_allowed;
ALTER TABLE feedback_attachments
  ADD CONSTRAINT feedback_attachments_content_type_allowed CHECK (
    content_type IN (
      'image/png', 'image/jpeg', 'image/webp',
      'application/pdf', 'text/plain', 'text/markdown'
    )
  );
