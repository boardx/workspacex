# 聚合预检机器契约（schemaVersion 2）

`validate_preflight.py` 接受一个不含密钥的 UTF-8 JSON 对象，按 `phase` 分两次验证同一个 exact `sourceSha`、`baselineSha`、`release` 和 `attemptId`。构建前 `phase=prebuild`、`buildStarted=false`；四个镜像构建且 seal 完成后、流量激活前 `phase=preactivate`、`buildStarted=true`。`ready=true` 只允许进入该阶段的下一步：prebuild 允许开始构建，preactivate 允许进入激活门。

## Attempt 身份与不可变存储

`attemptId` 是一次发布尝试的身份，不是 source SHA 的别名。它必须匹配 `^[a-z0-9][a-z0-9._-]{0,127}$`。同一 SHA 在收据过期或环境发生变化后允许新建新 attempt；新 attempt 必须使用新 `attemptId`，重新执行两阶段预检，不能刷新、覆盖或复用旧 attempt 的证据。

生产主机按 `/etc/workspacex-cn/preflights/<sourceSha>/<attemptId>/prebuild.json` 与 `preactivate.json` 保存输入，最终收据按相同目录保存。目录与文件均 create-once；同一 attempt 只允许 byte-identical 重放。preactivate 必须内嵌本 attempt 的完整 prebuild 输入，并携带该输入 canonical JSON 的 SHA-256。路径中的 SHA 只负责聚类，`attemptId` 才区分同 SHA 的多次尝试。任何 attempt 交叉、覆盖已有非同字节文件或从 `<SHA>.prebuild.json` 这种 SHA-only 路径读取都必须红退。

## 顶层与时效

两阶段顶层都必须有 `issuedAt`、`expiresAt`，格式严格为 UTC `YYYY-MM-DDTHH:MM:SSZ`。收据签发时间不能超过验证器时钟未来 5 分钟，必须已生效、未过期，TTL 必须大于零且不超过一小时。prebuild 不能包含 `prebuildEvidence` 或 `prebuildReceiptSha256`。preactivate 必须携带完整的 prebuild 输入 JSON 到 `prebuildEvidence`，以及 prebuild 输出的 `receiptSha256` 到 `prebuildReceiptSha256`；验证器重新计算 canonical JSON SHA-256、重跑 prebuild 全部检查，要求它仍 `ready=true`，四项身份完全相同、preactivate 签发时间不早于 prebuild。任何缺失、篡改、过期或阶段倒序都 schema 红退。

prebuild 必须提供验证脚本 `REQUIRED` 集合中的全部 20 项检查；preactivate 另加 `build.target_images`，共 21 项。每项是 `{"status":"passed","evidenceSha256":"64 位小写 hex","metadata":{...}}`；失败项需附非空稳定 `code`。未知或缺失检查拒绝，证据 hash 对脱敏原始 probe 输出计算。`BOOTSTRAP_*`、`STABLE_SECRET_*` 失败码以及两项 metadata 字段使用脚本的 allowlist。

## 关键 metadata

| 检查 | prebuild：只有源码/输入，无目标镜像 | preactivate：四个目标镜像已构建 |
|---|---|---|
| `source.exact_sha` | `requestedSha`、`repositoryHead`、`mirrorHead` 必须逐项等于顶层 `sourceSha` | 同左，不能用布尔 `exact=true` 代替三个动态事实 |
| `toolchain.browser_runtime` | `browserExecutable` 必须是绝对 POSIX 路径，且 `playwrightResolved=true`、`launchPassed=true` | 同左；证据必须来自候选 release tree 实际解析 Playwright 并启动该系统浏览器 |
| `runtime.release_lock` / `runtime.no_orphans` | 锁 metadata 的 `attemptId` 必须等于顶层 attempt 且 `heldByAttempt=true`；孤儿检查必须 `scanPassed=true,count=0` | 同左，每次验证都读取动态事实 |
| `config.release_manifest.metadata` | `{"kind":"source-plan","sourceSha":"exact 40hex","release":"固定版本"}`；禁止 `imageDigest`/`imageDigests` | `kind=sealed-images`，并有 exact `imageDigests` 映射，键必须恰为 `api`、`web`、`agent`、`sandbox` |
| `config.durable_profiles` | ASR、GitHub issue、平台超级管理员三项必须分别为 true | 同左；聚合布尔 `requiredReferencesPresent=true` 不足以定位漏项 |
| `bootstrap.compatibility.metadata` | 只读事务、零生产写入、`sourceEntrypoint=true`、输入/schema/权限/状态/Agent seed/单记录均验证；禁止 `imageEntrypoint` | 同样的只读 DB 检查，但必须是目标镜像的 `imageEntrypoint=true`；禁止源码入口替代 |
| `build.affected_services` | `diffComputed=true`，metadata 的 baseline/source SHA 必须等于顶层身份，服务只能是四服务的无重复子集 | 同左 |
| `deploy.trusted_copy` | `hashesMatch=true` 且 `checkedEntrypoints>0` | 同左 |
| `network.dependencies` | `probed=true` 且 ACR、OSS、RDS、Redis 四项 live probe 分别为 true | 同左 |
| `build.target_images` | 禁止出现；不能伪称目标镜像已存在 | 必填；`metadata.services` 的键必须恰为四服务，每项都含同一个 exact `sourceSha`、合法 `sha256:64hex` digest、`entrypointVerified=true`；四个 digest 必须逐项等于 sealed manifest 的 `imageDigests` |

### managed-data 两种权限模式

无论模式为何，`cloud.managed_data_permissions.metadata` 都必须有 `liveDescribePassed=true`，且 `passedActions` 不重不漏地包含 `rds:DescribeDBInstanceAttribute`、`rds:DescribeDBInstanceSSL`、`rds:DescribeDBInstanceIPArrayList`、`rds:DescribeBackupPolicy`、`redis:DescribeInstanceAttribute`、`redis:DescribeInstanceSSL`。

临时授权模式再要求 `mode=temporary-policy`、`temporaryPolicyExpires=true`、`cleanupRegistered=true`。持久授权模式再要求 `mode=persistent-resource-scoped-read-only`、`resourceScoped=true`、`readOnlyActionsOnly=true`。持久模式只证明策略形状还不够，仍必须在本 attempt 中实时调用六项 Describe；临时模式缺到期或清理登记也不能通过。

上述身份、权限、运行时和网络 metadata 使用字段 allowlist；token、password、原始 provider 响应或其它未知字段会被 schema 拒绝。`status=passed` 只表达 probe 结论，不能替代这些可反证字段，也不能由控制器直接常量生成。

## 输出协议

`bootstrap.compatibility` 的 DB probe 应在构建前检查输入和只读数据库兼容性；构建后重新执行镜像入口和 DB probe，尤其在迁移/激活前。镜像 digest 必须来自可鉴权的 registry manifest，不能用源码 hash 冒充。preactivate 阶段还需 canonical Prepare/影子业务与浏览器验收，独立于本 JSON 结构。

成功或 blocker 只向 stdout 写一行 `CN_RELEASE_PREFLIGHT_JSON={...}`，内含 `phase`、`ready`、`checkedCount`、`blockers`、四项身份、`issuedAt`、`expiresAt` 和对原始输入 canonical JSON 计算的 `receiptSha256`。诊断写 stderr。成功退出 0；blocker 退出 1；schema 错误退出 2。调用方解析固定前缀，不能假设 pnpm 或 shell stdout 只有 JSON。
