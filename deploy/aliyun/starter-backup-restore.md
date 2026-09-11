# Starter PostgreSQL 备份与恢复

本命令使用目标 Starter PostgreSQL 容器内的 PostgreSQL 16 客户端。ECS 上需要 Node/tsx、Docker 和访问该部署专属容器的权限；容器应包含 `timeout`、`psql`、`pg_dump`、`pg_restore`。这不是生产 RDS 恢复验收，也不属于初次 provision 的 300 秒计时。

## 前置参数

- WORKSPACEX_DEPLOY_PROFILE=starter。
- STARTER_POSTGRES_CONTAINER：该部署自己的 PostgreSQL 容器名，不能使用任意共享实例。
- PGUSER：Starter migration owner，通常 postgres。
- PGPASSWORD：从该部署稳定 owner secret 载入；不要放在命令参数或日志中。
- PGDATABASE：备份时为源数据库，恢复时为**新的、尚不存在且不同于源库的名字**。

命令仅通过容器内 127.0.0.1:5432 连接 PG。Docker argv 只包含 PGPASSWORD 的变量名；密码值通过子进程环境注入，数据库错误及原始 stderr 不输出到 JSON 日志。

## 备份

```sh
node --import tsx packages/cloud-deploy/src/starter-backup-cli.ts backup /private/backup/unique-attempt
```

目标目录必须为空且权限 0700。结果为权限 0600 的 `database.dump`（custom archive）和 `manifest.json`（SHA256、字节数、源数据库名、PG主版本、时间），只有数据及目录 fsync 成功才返回 ok。已有目录内容或重复执行不会覆盖原备份；失败保留部分制品供诊断，下一次使用新目录。

pg_dump 提供数据库一致快照；它不备份集群角色密码。请独立保全部署稳定 secrets，尤其 MODEL_CREDENTIAL_KEY，否则即使数据库恢复，已有加密凭据也可能无法解密。此命令不上传 OSS；远端备份上传与保留清理必须使用已经配置且经过验收的备份通道。

## 恢复

将 PGDATABASE 设为新的恢复库名；容器可为原 Starter 的专属实例，也可为另一个已准备好角色与 vector 扩展支持的专属实例。

```sh
node --import tsx packages/cloud-deploy/src/starter-backup-cli.ts restore /private/backup/unique-attempt
```

先验证 manifest、文件权限、SHA256、源/目标/客户端主版本均为 16，再执行 CREATE DATABASE 作为原子存在性检查。已存在的目标立即失败；没有 DROP、--clean 或对现有数据库的覆写。pg_restore 在单事务中执行，保留 ACL/RLS，将所有权归于目标 migration owner。目标实例须预先准备 app_rw、app_diag_ro 等备份中使用的角色；缺失时失败，不静默省略授权。失败留下新建的空/未完成恢复库，供显式诊断处理，不自动连接为业务库。

恢复成功后继续运行目标部署的 data-readiness、管理员/业务探针，并由部署流程明确切换连接；本脚本不修改 API 配置。

## 验证

已在独立 PostgreSQL 16 + vector 容器执行：252 个真实迁移备份恢复、业务 fixture 数据一致、FORCE RLS保留；已有目标再次恢复被拒绝且原数据未变化；同名源库拒绝；篡改dump在CREATE DATABASE之前被checksum拒绝。

隔离测试入口：`WORKSPACEX_DATA_TEST=1 node --import tsx packages/cloud-deploy/test/starter-backup-live.ts`，需提供本任务专用容器及PG owner连接参数。测试创建随机库并清理，禁止指向生产环境。

依据：[PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)。真实生产云恢复尚未验收。

## OSS backup target and transfer

`backupTargetRef` resolves through deployment's protected `env:`/`file:` reference loader
into this strict JSON payload (`packages/cloud-deploy/src/backup-target.ts`):

```json
{
  "backend": "oss",
  "region": "cn-hangzhou",
  "bucket": "workspacex-backups",
  "endpoint": "https://oss-cn-hangzhou-internal.aliyuncs.com",
  "prefix": "backups/my-installation",
  "authMode": "ecs-role",
  "roleName": "workspacex-backup"
}
```

Provision projects the resolved payload as `STARTER_BACKUP_TARGET_JSON` in private
`backup.env`; it is not a CLI argument. The role obtains short-lived credentials via
IMDSv2 using the existing OSS credential provider. No AccessKey is accepted by this
schema. Endpoint must be the selected region's Alibaba OSS HTTPS endpoint. Use a
separate backup bucket/prefix and an ECS role with `oss:GetBucketAcl`,
`oss:GetBucketVersioning`, `oss:PutObject`, and `oss:GetObject` scoped to that target.
Do not grant this workflow delete or bucket-policy mutation permissions. This first
implementation requires a **private bucket with versioning never enabled**: enabled
and suspended versioning both invalidate the write-once header, so both are rejected.
Every upload explicitly sets the object's ACL to private as well.

After producing a local backup using the command above, run inside the API image,
with `WORKSPACEX_DEPLOY_PROFILE=starter` and the protected environment loaded:

```sh
node --import tsx apps/api/scripts/starter-backup-oss.ts upload /private/backup/new-run
node --import tsx apps/api/scripts/starter-backup-oss.ts download /private/backup/new-download <backup-uuid>
```

Upload returns a UUID. Save that ID with the operational backup record. An optional
UUID argument permits the caller to choose it before execution. Every ID starts with
a write-once reservation; interrupted IDs cannot be resumed or replaced. A retry uses
a new ID. There is deliberately no automatic cleanup or prefix-delete operation.

The archive is transferred as at most 10,000 fixed 8 MiB parts (maximum approximately
78 GiB). Each part is uploaded with Content-MD5 and SHA256 metadata, then read back and
compared to the local SHA256. The complete archive SHA256 must match the original
PostgreSQL manifest. A remote completion manifest is written and read back only after
all checks pass. The client reuses the production `ali-oss` SDK and `OssObjectStore`
write-once/version/ACL checks. An upload failure leaves uncommitted parts for explicit
operator diagnosis; it does not report completion.

Download accepts only a UUID, not arbitrary object keys. It derives every part key
within that backup ID, validates part sizes and SHA256 plus the full archive checksum,
and creates only a **new** 0700 directory with 0600 files. A restore-compatible local
manifest appears only after all downloaded bytes have been verified and synced.
Then run the existing `restore` command with a new database name. Existing directories
and databases are never overwritten. Back up the API database and the isolated Agent
database separately; these operations do not claim a cross-database atomic snapshot.

Verification: cloud-deploy counterexamples exercise multipart round trips, corrupt
source/readback/download bytes, duplicate IDs, existing directories and hostile target
or manifest paths. The API loopback HTTP fixture uses the actual SDK, its V4 signer and
XML error decoder, validates private/write-once/integrity headers, and rejects public
and versioned targets. These are implementation/protocol tests, **not real OSS cloud
acceptance**. A real role-authenticated upload/download/new-database restore is still
required in the target region before that cloud acceptance is marked passed.

Official semantics: [OSS PutObject](https://www.alibabacloud.com/help/en/oss/developer-reference/putobject)
and [object ACL precedence](https://www.alibabacloud.com/help/zh/oss/developer-reference/putobjectacl).
