# 托管数据资源只读预检

`verifyManagedDataPreflight(expected, executor?, {timeoutMs, signal?})` 定义在 `packages/cloud-deploy/src/managed-data-preflight.ts`。expected 必须包含 region、rdsInstanceId、redisInstanceId、backupRetentionDays，以及已解析密钥中的 postgresHost/redisHost；资源地址必须匹配，避免检查一个实例却连接另一个实例。

默认 executor 使用预装 `aliyun` CLI、数组参数和 shell=false。三个只读调用并行、共享给定超时预算，外层 provision 的 AbortSignal 可终止子进程。身份由 CLI 已配置的 RAM 凭据提供，代码不读取或输出 AccessKey。执行错误、权限错误、非 JSON 响应和取消只返回固定 reason；报告不包含原始 stdout/stderr、地址或密码。

当前支持的生产姿态是已测试 PostgreSQL 16 高可用系列、Redis 7 标准主备双副本。其他版本或拓扑需要补充明确兼容性和 HA 证据，不能凭实例名、PING 或可用率数字放行。预检检查实例可用状态、匹配资源地域与内网地址、RDS备份保留天数与非空合法备份周期；高级备份策略拒绝使用可能不生效的旧保留字段。

机器返回 `{passed, scope: 'managed-data-control-plane', checks}`，checks 包括 rds、backup、redis。该通过仅代表云控制面配置符合支持范围，**不代表**数据库认证、TLS证书、vector扩展、网络连通、已完成备份恢复或业务链验收；继续执行实际 data-readiness 与业务探针。

依据的官方接口：

- [RDS DescribeDBInstanceAttribute](https://help.aliyun.com/zh/rds/developer-reference/api-rds-2014-08-15-describedbinstanceattribute)：Items.DBInstanceAttribute，资源和地域、Running/Primary、PostgreSQL版本、HighAvailability、VPC/Unlock、内网地址。
- [RDS DescribeBackupPolicy](https://help.aliyun.com/en/rds/developer-reference/api-rds-2014-08-15-describebackuppolicy)：BackupRetentionPeriod、PreferredBackupPeriod 和 AdvancedBackupPolicyEnabled。
- [Redis DescribeInstanceAttribute](https://www.alibabacloud.com/help/zh/redis/developer-reference/api-r-kvstore-2015-01-01-describeinstanceattribute-redis)：Instances.DBInstanceAttribute，standard、double、master-slave、Normal 和 VPC密码认证。缺失或未知双副本证据会失败。
- [官方 CLI 示例](https://www.alibabacloud.com/help/en/redis/developer-reference/cli-integration-example)：CLI 服务名为 r-kvstore。

只读最小权限为 rds:DescribeDBInstanceAttribute、rds:DescribeBackupPolicy、kvstore:DescribeInstanceAttribute，限定目标资源。实际云调用尚未执行；解析/命令构造/错误处理的反证测试可在无云配置下运行：`pnpm --filter @repo/cloud-deploy test`。
