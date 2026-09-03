-- 2026-09-02 独立审查 P0(第三轮,PR #2508):`20260902130000` 那版触发器只拿
-- `OLD.notified = false` 当"还没回填过"的判据——这站不住:
--
--   1. `markStatusEventNotified(false, null, null)`(邮件失败/没有可通知的邮箱那
--      条路径)回填之后,`notified` 还是 `false`。行的状态与刚插入时**分不出来**,
--      于是同一行可以被反复 UPDATE 任意次——"通知结果只能回填一次"这条不变量
--      在"回填成了 false"这个分支上完全没被强制,`false→false` 那条路径此前
--      也确实没有反证(只测过 true→再次 UPDATE 被拒)。
--   2. 触发器从没要求 `notified=false ⇒ subject/text 恒 NULL`——application 层
--      (`notifySubmitter`)确实总是这么调,但那只是"目前唯一的调用方守规矩",
--      数据库层没有真的堵住"notified=false 却带着一段邮件正文"这种损坏数据。
--
-- 两个问题的根因相同:拿一个业务意义上的布尔(是否发出通知)兼职"这一行有没有
-- 被回填过"的哨兵,而 false 恰好是这个布尔的合法终态之一,不能拿来判断"有没有
-- 发生过"。修法是把这两件事拆成两列:新增 `notification_settled_at`,专职
-- "回填这个动作本身发生过没有",与 `notified` 的真假值完全无关。
ALTER TABLE product_feedback_status_events
  ADD COLUMN IF NOT EXISTS notification_settled_at timestamptz NULL;

COMMENT ON COLUMN product_feedback_status_events.notification_settled_at IS
  '`markStatusEventNotified` 回填过一次即非 NULL(与 notified 的真假值无关,
   专职"回填动作本身发生过没有"——见触发器 fb2_status_events_append_only)。
   插入时(transitionStatusWithEvent)恒为 NULL:此时还没跑 notifySubmitter。';

CREATE OR REPLACE FUNCTION fb2_status_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     -- 只有从未回填过的行才能被这次 UPDATE 命中,且这次 UPDATE 必须把它标记为
     -- 已回填——与 `notified` 最终落地是 true 还是 false 无关,堵住上面①那条口子。
     AND OLD.notification_settled_at IS NULL
     AND NEW.notification_settled_at IS NOT NULL
     -- notified=false ⇒ 不能带着一段邮件文案——堵住上面②那条口子,在数据库层
     -- 强制契约头注声明的那条不变量,不只是信任调用方守规矩。
     AND (NEW.notified OR (NEW.email_subject IS NULL AND NEW.email_text IS NULL))
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
