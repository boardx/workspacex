-- FB-5 —— 反馈附件（图片）。见 contracts/feedback-loop.ts `uploadFeedbackAttachment` 头注。
--
-- 两段生命周期：上传时 `feedback_id IS NULL`（先传字节，还不知道挂在哪条反馈上，
-- 同 chat 附件 pending 的既有形状）；`submitFeedback` 成功后按 `attachmentIds`
-- 认领（UPDATE ... WHERE id = ANY($1) AND org_id = $2 AND uploaded_by = $3 AND
-- feedback_id IS NULL），认领失败（别人的 id / 已被认领 / 已过期清理）不阻塞
-- 反馈本身提交成功——见 `submit-feedback.ts` 头注，best-effort 同状态变更邮件、
-- GitHub issue 状态同步同一条纪律。
--
-- ⚠ 这一轮**没有脱敏**（人类 2026-09-02 明确裁决：先出功能）。EXIF 元数据剥离 /
--   完整内容脱敏都没有做——registered as 已知限制，见该 issue 的应用层文件头注。
--   `product_feedback` 的下游今天没有任何自动转发给开发 Agent 的链路（FB-4 未建），
--   真建那条链路之前，这里必须先补上脱敏这一步。

CREATE TABLE IF NOT EXISTS feedback_attachments (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  uploaded_by  text NOT NULL,
  -- NULL = 已上传字节、尚未挂在任何一条反馈上（认领窗口）。
  feedback_id  text REFERENCES product_feedback (id) ON DELETE CASCADE,
  object_key   text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8 * 1024 * 1024),
  sha256       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_attachments_feedback_idx
  ON feedback_attachments (org_id, feedback_id);

-- 认领时按 (org_id, uploaded_by, id) 精确匹配未认领的行——见上方生命周期说明。
CREATE INDEX IF NOT EXISTS feedback_attachments_unclaimed_idx
  ON feedback_attachments (org_id, uploaded_by) WHERE feedback_id IS NULL;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE feedback_attachments ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE feedback_attachments FORCE ROW LEVEL SECURITY';
END
$$;

DROP POLICY IF EXISTS feedback_attachments_tenant ON feedback_attachments;
CREATE POLICY feedback_attachments_tenant ON feedback_attachments
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON feedback_attachments FROM app_rw;
-- UPDATE 只用于认领（`feedback_id` 由 NULL 变为一个值）——没有任何调用点会改别的列
-- 或把已认领的行改回 NULL，那条纪律在应用层（一次 WHERE feedback_id IS NULL 的
-- UPDATE），不在这里额外加触发器锁列，与 `product_feedback` 的两列锁列触发器
-- 是不同量级的保护（那两列在整个反馈生命周期里会被反复合法改写；这里只认领一次）。
GRANT SELECT, INSERT, UPDATE ON feedback_attachments TO app_rw;

SELECT kernel_apply_org_freeze_policies();
