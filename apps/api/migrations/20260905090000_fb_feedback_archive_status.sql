/*
 * issue #2681 —— 运营收件箱新增 `已归档` 状态。
 *
 * 只放宽 CHECK 约束，不动状态机（状态机在 `apps/api/src/domain/feedback/product-feedback.ts`，
 * 只允许 `已修复` / `不做` → `已归档` → `待处理`）。这里没有别的选择——`status`/`from_status`/
 * `to_status` 三列在 `20260815140000_fb2_product_feedback.sql` 里是列级 CHECK，没有显式命名，
 * Postgres 按 `<table>_<column>_check` 的默认规则命名，所以 DROP/ADD 用的是这个默认名。
 */

ALTER TABLE product_feedback
  DROP CONSTRAINT IF EXISTS product_feedback_status_check,
  ADD CONSTRAINT product_feedback_status_check
    CHECK (status IN ('待处理', '已进入迭代', '已修复', '不做', '已归档'));

ALTER TABLE product_feedback_status_events
  DROP CONSTRAINT IF EXISTS product_feedback_status_events_from_status_check,
  ADD CONSTRAINT product_feedback_status_events_from_status_check
    CHECK (from_status IN ('待处理', '已进入迭代', '已修复', '不做', '已归档')),
  DROP CONSTRAINT IF EXISTS product_feedback_status_events_to_status_check,
  ADD CONSTRAINT product_feedback_status_events_to_status_check
    CHECK (to_status IN ('待处理', '已进入迭代', '已修复', '不做', '已归档'));
