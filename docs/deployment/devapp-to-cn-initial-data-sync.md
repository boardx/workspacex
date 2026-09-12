# Devapp → 中国生产首次数据同步

该流程只用于第一次建立中国生产数据。每次运行使用新的 UUID `migrationId` 和空目标数据库；已存在的收据或目标数据库一律拒绝复用。工具入口 `initialProductionSyncPlan` 默认只生成不含凭据的 dry-run 计划。目标数据库凭据必须来自 `env:` 或权限为 `0600` 的绝对 `file:` 引用。Devapp 源直接使用已有 PostgreSQL 容器和 `/opt/workspacex/objects`，不读取、复制或打印 Devapp 的部署密钥。

当前 Devapp 的配置模板如下；容器、数据库名和对象目录必须按现场核对后填写，不能把密码写入该文件。

```json
{
  "schemaVersion": 1,
  "migrationId": "00000000-0000-4000-8000-000000000000",
  "sourceDatabase": {
    "mode": "devapp-docker",
    "container": "workspacex-postgres-1",
    "database": "workspacex",
    "user": "postgres"
  },
  "targetDatabaseSecretRef": "file:/etc/workspacex-cn/target-db.json",
  "sourceObjects": {
    "mode": "filesystem",
    "root": "/opt/workspacex/objects"
  },
  "targetOss": { "bucket": "workspacex-cn-files", "prefix": "objects/prod" },
  "workDirectory": "/var/lib/workspacex-sync",
  "schemaRevision": "填入40位发布commit SHA",
  "keyMigration": { "mode": "rotate-required" }
}
```

## 操作顺序

1. 在与发布 SHA 相同的迁移版本上创建目标空库。记录 source schema revision、`pg_current_wal_lsn()`、源表计数和迁移 ID。
2. 使用 `docker exec -i <container> pg_dump --format=custom --serializable-deferrable --lock-wait-timeout=10000` 生成一致性 dump。dump 只经 stdout 写入宿主机权限 `0600` 的新文件，不经过 shell、命令参数或日志；记录文件大小和 SHA-256。
3. 对目标空库运行 `pg_restore --exit-on-error --single-transaction --no-owner`。禁止 `--clean`、覆盖已有数据库或在失败后自动重试同一目标库。
4. 使用 `ossutil sync /opt/workspacex/objects oss://<target-bucket>/<prefix> --delete` 将 Devapp 文件目录同步到新私有桶，生成包含 `key/size/sha256` 的 baseline inventory。`ossutil` 必须使用实例 RAM 角色或受保护的配置文件获取凭据，禁止将 AccessKey 放入参数。数据库中的 `artifact_versions.object_storage_key` 和 `derived_representations.object_storage_key` 保持原 key 语义；目标 prefix 映射必须在复制器中完成，不能改写数据库行。
5. 进入写入冻结窗口，再执行 OSS delta 同步并生成 source/target final inventory。`verifyOssInventory` 要求对象 key、长度和 SHA-256 集合完全相同；版本控制、公开 ACL 或额外对象均不允许据此标记通过。
6. 验证所有外键、关键引用与内容摘要后再解除冻结。写入只读收据；相同 migration ID 不得再次导入。

## 数据库验收

- `pg_constraint` 中所有外键必须 `convalidated=true`，并以 `SET CONSTRAINTS ALL IMMEDIATE` 验证导入事务。
- 比较源/目标逐表 row count、主键有序集合哈希和 schema revision。
- 验证 `canvas_template_bindings` 指向存在的模板版本、组织、议程和 workshop。
- 验证 `skills/skill_versions/skill_version_files/skill_mounts` 以及 `skill_contracts/skill_contract_versions/current_version_id` 没有 orphan；重新计算每个 skill 文件和版本声明的 digest。
- 验证 `mcp_tools/mcp_server_secrets/current_review_id` 与 server、review snapshot、credential revision 可以解析；对一个只读工具执行受控探针。
- 对所有非空 object-storage key 与最终 OSS inventory 做双向 anti-join；抽样通过业务 API 打开画布模板、挂载 Skill、读取文件和列出工具。

## 密钥边界

同步工具只检测 `mcp_server_secrets`、模型凭据等密文是否存在，不输出、解密或自动重加密。配置必须二选一：

- `same-key-confirmed`：具名操作者确认目标运行时使用相同 `key_id` 和解密主密钥；收据记录确认人和 key ID。
- `rotate-required`：生产环境重新录入并轮换凭据。检测到密文时，只有收据 `keyDecision=rotated` 才能通过。

生产数据库连接、OSS 凭据、密文内容和主密钥不得出现在命令参数、dry-run、日志、inventory 或收据中。

## CLI

```bash
pnpm --filter @repo/cloud-deploy initial-production-sync -- /etc/workspacex-cn/initial-sync.json dry-run
pnpm --filter @repo/cloud-deploy initial-production-sync -- /etc/workspacex-cn/initial-sync.json database-dump
pnpm --filter @repo/cloud-deploy initial-production-sync -- /etc/workspacex-cn/initial-sync.json database-restore
pnpm --filter @repo/cloud-deploy initial-production-sync -- /etc/workspacex-cn/initial-sync.json oss-baseline
pnpm --filter @repo/cloud-deploy initial-production-sync -- /etc/workspacex-cn/initial-sync.json oss-delta --write-freeze-confirmed
pnpm --filter @repo/cloud-deploy initial-production-sync -- /etc/workspacex-cn/initial-sync.json evidence /etc/workspacex-cn/initial-sync-evidence.json
pnpm --filter @repo/cloud-deploy initial-production-sync -- /etc/workspacex-cn/initial-sync.json accept /etc/workspacex-cn/initial-sync-acceptance.json
```

CLI 直接以数组参数调用 Docker、PostgreSQL 16 客户端和 `ossutil`，不经过 shell。Docker 源模式不需要数据库口令；远程数据库源模式下的 PG host、用户和口令只进入子进程环境。它以 `state.json` 恢复已完成阶段，以独占 `sync.lock` 阻止并发运行；目标数据库只要存在一张非系统表就拒绝 restore。文件系统到 OSS 同样执行 baseline 和冻结后的 delta 两阶段，delta 必须显式传入写冻结确认参数。

`evidence` 的输入只引用已经生成的 inventory，不包含数据库凭据：

```json
{
  "sourceSnapshot": "冻结窗口记录的 pg_current_wal_lsn()",
  "sourceOssInventoryFile": "/var/lib/workspacex-sync/source-final-inventory.json",
  "targetOssInventoryFile": "/var/lib/workspacex-sync/target-final-inventory.json",
  "secretCiphertextsDetected": true,
  "keyDecision": "rotated"
}
```

两个 inventory 文件必须符合 `{schemaVersion:1,bucket,prefix,objects:[{key,size,sha256}]}`，其中摘要来自真实对象字节。生成器重新只读查询冻结后的 Devapp 容器和目标数据库：覆盖 `public` 中全部普通表/分区表的逐表行数；有主键的表另比较按主键排序的确定性摘要；逐条检查所有已声明外键是否已 validated 且没有 orphan。它随后按 key、size、SHA-256 比较两个 OSS inventory，并据此生成 acceptance draft。任何缺失、格式错误或差异都会失败或把对应布尔值写为 `false`，不能产生假 `true`。

当前 `criticalReferencesValid` 的机械含义是“目标库所有已声明外键均 validated 且无 orphan，并且没有外键表达的 `skill_contracts.current_version_id` 也能解析到同组织、同 Skill 的版本”。其他没有数据库外键表达的业务引用、Skill 文件 digest 重算、对象内容的 inventory 生成，以及密文轮换本身仍由操作步骤提供证据；生成器不会把这些工作自动视为通过。逐表主键摘要证明身份集合一致，不能证明同一主键下每个非主键字段的字节完全一致。

`evidence` 输出的是 `{acceptance,evidence}`。先保存完整报告并审核，再仅提取 `.acceptance` 为上面 `accept` 命令的输入；若任何布尔门为 `false`，严格 acceptance schema 会拒绝它。完整报告应按迁移记录留存，不能只保留最终布尔值。

## 收据完成条件

收据必须绑定 migration ID、schema SHA、源 snapshot、dump SHA-256，并证明数据库 restore、FK、关键引用、两轮 OSS 同步、最终 inventory 和密钥决策全部通过。任一项失败时保留失败现场用于诊断，删除目标数据库和目标 prefix 后使用新的 migration ID 重来。
