-- 全局通知中心（contracts/notifications.ts）。一行 = 一条推给某个用户的收据。
-- org_id 为 NULL 的行是跨组织的个人通知（例如"给你发了一封邮件"），在任意组织下都可见。
CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('task','email','system')),
  title text NOT NULL CHECK(length(title)<=500),
  body text NOT NULL CHECK(length(body)<=4000),
  thread_id text,
  -- 同一事实只推一次（例如 run:<id>:succeeded），重复 publish 落到 ON CONFLICT DO NOTHING。
  source_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_source_key ON user_notifications(user_id,source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_notifications_unread ON user_notifications(user_id,created_at DESC) WHERE read_at IS NULL;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_notifications_tenant ON user_notifications;
CREATE POLICY user_notifications_tenant ON user_notifications
 USING(org_id IS NULL OR org_id=current_setting('app.current_org',true))
 WITH CHECK(org_id IS NULL OR org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE ON user_notifications TO app_rw;
SELECT kernel_apply_org_freeze_policies();
