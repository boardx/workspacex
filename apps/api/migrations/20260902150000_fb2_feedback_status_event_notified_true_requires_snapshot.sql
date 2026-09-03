-- 2026-09-02 独立审查 P1(第四轮,PR #2508):触发器只强制了
-- `notified=false ⇒ subject/text 恒 NULL` 这一半,没强制对称的另一半——
-- `notified=true` 时允许 subject/text 仍是 NULL。产品语义是"真的发出去的
-- 通知,历史里能看到发的是什么"(见 `listFeedbackStatusEvents` 契约头注),
-- 一条 `notified=true` 却没有快照的行违反这条语义,而应用层
-- (`notifySubmitter`)确实总是成对给,但同 `20260902140000` 那次的教训一样——
-- "目前唯一的调用方守规矩"不是数据库层的强制。
--
-- 直接把上一版的单向蕴含改成双向:notified 与"有没有快照"必须同步,不能有
-- 「有 notified 结论、无发出内容」或反过来的那种半吊子行。
CREATE OR REPLACE FUNCTION fb2_status_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.notification_settled_at IS NULL
     AND NEW.notification_settled_at IS NOT NULL
     -- notified 与"是否带着快照"必须同步:true ⇒ 两列都非空,false ⇒ 两列都是
     -- NULL——不允许"发了但没记下发的是什么"或"没发却带着一段文案"这两种半吊子行。
     AND (
       (NEW.notified AND NEW.email_subject IS NOT NULL AND NEW.email_text IS NOT NULL)
       OR (NOT NEW.notified AND NEW.email_subject IS NULL AND NEW.email_text IS NULL)
     )
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
