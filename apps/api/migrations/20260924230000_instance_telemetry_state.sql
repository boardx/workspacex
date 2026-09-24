-- D9 —— 客户实例侧运行信号上报（超级实例 S3）的实例级状态，单行表。
--
-- * `install_secret`：安装时生成的随机密钥，**只在本机**。上报的 `instanceId` 是它的 SHA-256，
--   不从主机名、域名或组织名派生（契约 `InstanceId`）。
-- * 四项同意各一列，互相独立（不坍缩成一个布尔）。出厂默认值不写在这里的 DEFAULT——由应用在
--   首次建行时按契约 `TELEMETRY_CONSENT_DEFAULTS` 写入，避免同一事实在 SQL 与契约各写一份。
-- * `last_*`：最近一次上报尝试的原样报告体与结果——「看看发了什么」读的就是它。
--
-- ⚠ 无 `org_id`：这是实例级配置，不属于任何租户（同 `service_uptime_checks`）。
CREATE TABLE IF NOT EXISTS instance_telemetry_state (
  singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  install_secret     text NOT NULL CHECK (install_secret ~ '^[0-9a-f]{64}$'),
  consent_health      boolean NOT NULL,
  consent_usage       boolean NOT NULL,
  consent_diagnostics boolean NOT NULL,
  consent_benchmark   boolean NOT NULL,
  last_attempted_at  timestamptz NULL,
  last_outcome       text NULL CHECK (last_outcome IS NULL OR last_outcome IN ('sent', 'failed', 'invalid')),
  last_omitted       jsonb NULL,
  last_report        jsonb NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON instance_telemetry_state FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON instance_telemetry_state TO app_rw;

COMMENT ON TABLE instance_telemetry_state IS
  'kernel-no-tenant-data: 实例级运行信号上报状态（D9，单行），无 org_id（实例配置,不属于任何租户）。'
  '读写经 HTTP 层 PlatformOperatorGuard 保护，见 interface/controllers/system-telemetry.controller.ts。';
