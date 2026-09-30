# 完整只读迁移快照（schemaVersion 1，#4828）

`{readOnly:true,ledger:[...]}` 已停用，不能根据可解析 JSON 或行数“看起来合理”证明完整。生产元数据仅放 root 私有文件；不得把原始快照、连接身份或用户数据贴到 CI/GitHub。测试 fixture 中的身份和账本为 synthetic。

## 采集前提与单一来源

可信 caller 从受保护的配置与实时 Describe 身份构造独立 `expected-source-binding.json`，不能从待验证快照复制。其 schemaVersion=1，source 有 accountId、regionId、dbInstanceId、database、user、endpointSha256、serverAddressSha256、port；cloud 有 ecsInstanceId、invokeId、commandId、querySha256。host/服务器地址仅存 SHA256，不放密码或DSN。预期user是实际审计连接用户，不是app账号。querySha256绑定审核过的采集程序和SQL，不用输出行数回填来源。

同一个 PostgreSQL `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` 中：从 SQL读取 current_database/current_user/inet_server_addr/inet_server_port、transaction_read_only、transaction_isolation，核验连接与预期来源。独立执行 `SELECT count(*)::text FROM public._kernel_migrations`，再取完整 `(name,checksum)` 行；不能用 rows.length冒充SQLCOUNT，不要 LIMIT/OFFSET/时间戳截取。结束显式ROLLBACK，异常也ROLLBACK；不改账本、不执行迁移。数据库INSTANCE归属由外部Describe及受保护endpoint绑定，不能仅靠SQL里自填instanceID。

SQL同时计算**独立**账本摘要：按name的ASCII顺序排序，将每行写成精确 `{"name":"<name>","checksum":"<checksum>"}`，用逗号拼接且数组外包 `[]`；UTF8字节SHA256。空账本摘要为SHA256(`[]`)。可用 `encode(sha256(convert_to('[' || coalesce(string_agg(format('{"name":"%s","checksum":"%s"}',name,checksum),',' ORDER BY name COLLATE "C"),'') || ']','UTF8')),'hex')`。先验证name仅ASCII安全文件名、checksum小写64hex，不能让引号等改变canonical格式。摘要必须从原SQL rows计算，不能从人工复制或错误zip后的映射重新算。COUNT、ledger、摘要属于同一只读snapshot。

## 两层完整传输

SQL输出为严格对象：schemaVersion=1、kind=`cn-migration-ledger-output`、querySha256、readOnly=true、transactionIsolation=`repeatable read`、source（与expected完全相同且连接字段来自实测）、independentSqlCount整数、ledger完整{name,checksum}数组、ledgerSha256。源数据库count是独立证据，不允许只从数组长度生成。

输出JSON gzip后base64，stdout唯一一行：`WSX_CN_MIGRATION_SNAPSHOT_V1=<gzip-base64>`。压缩减少云助手Output限制风险，仍必须实际验证 Dropped=0。云助手 [DescribeInvocationResults官方契约](https://help.aliyun.com/zh/ecs/developer-reference/api-ecs-2014-05-26-describeinvocationresults) Output默认base64，超过24KB会Dropped；请求显式ContentEncoding=Base64。保存完整成功响应bytes，不截JSON片段，不位置zip；单invoke、command、ECS filter返回唯一结果且TotalCount=1、NextToken空。

外层严格对象：schemaVersion=1、kind=`cn-readonly-migration-snapshot`、capturedAt UTC、source、fullResponseBase64（完整providerJSON字节base64）、fullResponseSha256。validator验证完整response hash→provider成功/exit0/Dropped0/身份→Output严格base64 UTF8→唯一prefix→gzip≤8MiB→严格SQL对象→独立count=实际rows→unique名字→独立canonical摘要。fullResponse≤2MiB，gzip压缩块和stdout≤24KiB；任一缺字段/编码损坏/尾随日志/多结果/分页/截断/重复/name-checksum错位/identity不同均fail closed。

旧 `CN_LEDGER_FRESH_GZIP` 或旧snapshot不会自动升级；必须用新协议重新真实只读采集。不能把旧产物转换成新格式并填count/digest/身份自证。外层HASH证明传输一致性，不是provider签名；独立sourcebinding和信任采集入口仍是必需前提，不能把任意用户JSON当真实生产证明。

## 验证与计划入口

文件必须普通非symlink、0600、当前可信调用用户所有；root运行时要求root:root。生产由root可信caller保存在受保护目录，两个输入都不放public artifacts。CLI只输出稳定错误码，不输出Zod详情/原始JSON；读取失败退出2。在已有deployment lock下运行：

```bash
node --import tsx packages/cloud-deploy/src/cn-migration-plan-cli.ts \
  <frozen-checkout> <exact-target-sha> <exact-baseline-sha> \
  <private-snapshot.json> <expected-source-binding.json> [legacy-evidence.json]
```

计划绑定snapshot、完整response、sourcebinding和ledger摘要/SQLcount/采集时间到planSha256。snapshot成功仅证明采集完整；canonical源码、drift、out-of-order、risk gates保持原逻辑，plan不能授权migration/activation。失败时不构建/迁移，先重新采集与诊断。不固定上次count；COUNT变化应改变证据，不能称新行都是漏行。

synthetic rehearsal也改为同一新协议输入，并在report参数前增加expected-source-binding路径。它仍拒绝production profile/remote Docker；不执行生产写库，不能用synthetic prefix宣称真实数据演练通过。

## 事故防复发

名字与hash必须从同一row对象读；禁止分别提取两列后zip。供应商输出Dropped不是可选字段。保存full response，先decode全部，再核验独立COUNT与SQL摘要。对不同来源/不同transaction拼接的摘要必须拒绝。最新真实source元数据保持私有，GitHub仅发脱敏校验结论和测试证据。
