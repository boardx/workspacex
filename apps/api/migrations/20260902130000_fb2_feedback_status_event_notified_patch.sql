-- 2026-09-02 独立审查 P0（PR #2508）：`triageFeedback` 原来分两次独立事务
-- (`updateStatus` 一次 `withTenant`，`appendStatusEvent` 另一次) 写"状态变了"
-- 与"这次转移发生过"这两件事——前者成功、后者失败会让状态真的变了，但**这条
-- 历史事实本身**在流水里永久缺失，不是缺一部分细节。
--
-- 应用层的修法（同一提交里的 `transitionStatusWithEvent`）是把 UPDATE
-- product_feedback 与 INSERT product_feedback_status_events 收进同一次
-- `withTenant`（= 同一个数据库事务），流水行落库时 `notified` 先诚实地写
-- `false`（这一刻还没发邮件，见 `notifySubmitter` 必须在状态落库之后才跑的
-- 既有纪律）。邮件结果出来之后，`markStatusEventNotified` 只回填那一行的
-- `notified`/`email_subject`/`email_text` 三列——这次 UPDATE 撞的正是
-- `fb2_status_events_append_only` 触发器（原样 `BEFORE UPDATE ... RAISE
-- EXCEPTION`，不分列），所以这条迁移把触发器函数改成**只放行这一种形状的
-- UPDATE**：
--
--   1. 只碰 notified / email_subject / email_text 三列，其余列（含
--      from_status / to_status / reason / actor_id / created_at）逐列
--      `IS NOT DISTINCT FROM` 校验必须原样不变；
--   2. 只能从 `notified = false` 那一行状态回填一次（`OLD.notified = false`）——
--      既是"通知结果只该被记一次"的业务语义，也顺带堵掉"反复覆写历史"的口子。
--
-- 除此之外的任何 UPDATE、以及全部 DELETE（组织被清档那条既有例外不变），
-- 仍然照原样被拒——append-only 的核心承诺（转移本身/理由/经手人不可篡改）
-- 没有被这条迁移放宽，放宽的只是"通知结果"这一个此前设计时漏掉的正当写路径。
CREATE OR REPLACE FUNCTION fb2_status_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.notified = false
     AND NEW.id = OLD.id
     AND NEW.org_id = OLD.org_id
     AND NEW.feedback_id = OLD.feedback_id
     AND NEW.from_status IS NOT DISTINCT FROM OLD.from_status
     AND NEW.to_status = OLD.to_status
     AND NEW.reason IS NOT DISTINCT FROM OLD.reason
     AND NEW.actor_id = OLD.actor_id
     AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'product feedback status events are append-only';
END;
$$ LANGUAGE plpgsql;

-- 表级 GRANT 本来就没有 UPDATE（迁移 20260815140000 只给了 SELECT, INSERT）——
-- 触发器只裁决"这次 UPDATE 的形状对不对"，GRANT 裁决"这个角色能不能发起
-- UPDATE"，两道闸门缺一不可（同 error_logs 那次 SECURITY DEFINER 的教训：
-- 只加一道闸门等于没加）。
GRANT UPDATE ON product_feedback_status_events TO app_rw;
