-- issue #2645 —— 运营状态屏「服务中断时长与可用性可视化」。后台定时 worker
-- （`infrastructure/system/service-uptime-poll-worker.ts`）每 60 秒 ping 一次探活目标
-- （默认是 Dev app，见 `DEV_APP_UPTIME_URL`），把结果写成一行,`GET /system/uptime`
-- 读最近若干行折成红绿 bar + 精确可用性百分比。
--
-- ⚠ Deliberately NO `org_id`——同 `error_logs`（20260901024515）一个理由：这是
--   基础设施自我观测,不是租户业务数据,不属于任何一个组织。`kernel_tenant_table_audit`
--   需要下面的 COMMENT 豁免声明。
CREATE TABLE IF NOT EXISTS service_uptime_checks (
  id BIGSERIAL PRIMARY KEY,
  -- 被探活的目标标识（如 'dev_app'）——现在只有一个探活目标,但表结构不假设"只会有一个"。
  service TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  is_up BOOLEAN NOT NULL,
  -- 探活请求耗时,诊断用,可为空（连接失败时测不出有效延迟）。
  latency_ms INTEGER,
  -- 粗粒度失败原因（'timeout' / 'http_502' / 网络错误消息前 500 字符），is_up = true 时为空。
  error TEXT
);

-- 读侧的查询形状：按 service 取最近 N 条,时间倒序。
CREATE INDEX IF NOT EXISTS service_uptime_checks_service_checked_at_idx
  ON service_uptime_checks (service, checked_at DESC);

-- 保留期housekeeping（`recordServiceUptimeCheck` 每 200 次顺手扫一次）按 checked_at 删,
-- 走的还是上面那个复合索引的前缀,不需要单独一个。

-- `app_rw`（运行时应用身份）读写这张表：内容是探活结果的时间序列,敏感度与
-- `platform_admins` 同级（"谁能看见"已经由 HTTP 层的 `PlatformOperatorGuard` 把住,
-- 不是需要像 `error_logs` 诊断正文那样再单独隔离一个只读角色的内容）。
REVOKE ALL ON service_uptime_checks FROM app_rw;
GRANT SELECT, INSERT, DELETE ON service_uptime_checks TO app_rw;
GRANT USAGE ON SEQUENCE service_uptime_checks_id_seq TO app_rw;

COMMENT ON TABLE service_uptime_checks IS
  'kernel-no-tenant-data: 服务可用性探活的时间序列（issue #2645），无 org_id（基础设施自我观测,'
  '不属于任何租户）。app_rw 持有 SELECT/INSERT/DELETE——读侧受 HTTP 层 PlatformOperatorGuard '
  '保护，见 interface/controllers/system-uptime.controller.ts。';
