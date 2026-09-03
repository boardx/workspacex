-- 给 `product_feedback_status_events` 补两列，让"这次转移有没有真的发邮件通知
-- 提交人、发的是什么"变成一条能读回来的历史，而不是只活在 best-effort 的
-- 一次性响应字段（`triageFeedback.out.notified`）里，响应之外无处可查。
--
-- 人类原话（后台看板反馈）：分诊的"邮件 update"要能在反馈详情里看到历史，
-- 不只是当次操作那一个布尔。
--
-- ⚠ 存的是**实际发出去那一刻**的主题（`email_subject`），不是"按当前模板重新算
--   一遍"——模板以后要是改了文案，历史记录不该跟着回溯性地变，否则"三周前
--   发给用户的到底是哪句话"这件事永远查不清楚。正文（`email_text`）同理留存，
--   给管理员核对"当时具体说了什么"用。
-- ⚠ `notified` 恒有值（`NOT NULL DEFAULT false`），不是可空——见
--   `triage-feedback.ts` 的既有纪律：通知是 best-effort，`notified=false` 就是
--   诚实的"这次没发成/没有可通知的邮箱"，不是"不知道"。
ALTER TABLE product_feedback_status_events
  ADD COLUMN IF NOT EXISTS notified      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_subject text NULL,
  ADD COLUMN IF NOT EXISTS email_text    text NULL;

COMMENT ON COLUMN product_feedback_status_events.notified IS
  '这次状态转移是否真的把邮件发出去了（best-effort，见 triage-feedback.ts 的 notifySubmitter）。';
COMMENT ON COLUMN product_feedback_status_events.email_subject IS
  '实际发出的邮件主题快照——不是按当前模板重新渲染，模板改了不影响历史记录。notified=false 时为 NULL。';
COMMENT ON COLUMN product_feedback_status_events.email_text IS
  '实际发出的邮件正文快照，同 email_subject 的理由。notified=false 时为 NULL。';
