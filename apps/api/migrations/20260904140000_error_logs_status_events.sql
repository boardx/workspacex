-- `system_error_status_events` -- UC-17.8 B3.3：系统异常状态流水，同 `product_feedback_status_events`
-- 的形状（每次真实状态转移落一行），但比它窄得多——`error_logs`（见迁移
-- `20260901024515_error_logs.sql` 头注）没有提交人要通知、不建 GitHub issue，这张表只记
-- 「什么时候、谁、把状态从哪改到哪、理由是什么」，不带邮件/issue 那一整套副作用。
--
-- ## 为什么这张表可以直接 GRANT 给 `app_rw`，不用像 `error_logs` 那样走 SECURITY DEFINER 函数
--
-- `error_logs` 限制 `app_rw` 直读的是 `msg`/`detail`——那是异常的**诊断内容**，可能带着
-- 客户数据/内部路径。这张表只有状态字符串、理由文本、actorId、时间戳，与
-- `product_feedback_status_events`（`app_rw` 可直接读写）同一敏感度，不属于"诊断内容"
-- 那条边界，没有理由额外包一层 SECURITY DEFINER 函数。
--
-- ## 为什么 `error_log_id` 不是外键约束到 `error_logs.id` 上做级联
--
-- `error_logs` 没有为这张新表预留级联删除的语义（它自己也没有删除接口，只有
-- `sweepExpiredErrorLogs` 的保留期清理）。加 FK 会让"先决定谁能删 error_logs"这个
-- 未决问题提前耦合进这张表。索引已经够查询用，先不加 FK 约束。
CREATE TABLE IF NOT EXISTS system_error_status_events (
  id TEXT PRIMARY KEY,
  error_log_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_error_status_events_error_log_id_idx
  ON system_error_status_events (error_log_id, created_at);

GRANT INSERT, SELECT ON system_error_status_events TO app_rw;

COMMENT ON TABLE system_error_status_events IS
  'kernel-no-tenant-data: 系统异常（error_logs）的状态流水，同 error_logs 一样没有 org_id——'
  '异常本身就是平台级的，不是租户数据。app_rw 直接持有 INSERT/SELECT（不像 error_logs 的'
  'msg/detail 那样受限——这张表不含诊断内容）。';
