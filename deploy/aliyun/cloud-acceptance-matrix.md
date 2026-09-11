# Starter / Production 云部署验收矩阵

本矩阵区分代码完成、本机验证和真实云验收。绿色表示实现完成并附 commit；紫色表示所列验收范围已通过；红色表示失败、缺少必要外部输入或需要用户决定。禁止用本机 fixture、配置校验成功或 prepare 收据，把真实云部署节点改为紫色。

## 最小输入

两档均使用 `deploymentConfigSchema` 和不可变 `releaseManifestSchema`，不新增隐式密码参数。示例中的地址/ID必须换成真实资源；配置文件只能存 secret reference，不能嵌入 Secret 值。

| 输入类别 | 两档共有 | Starter 补充 | Production 补充 |
|---|---|---|---|
| 身份与区域 | `regionId`、`ecsInstanceId`、`runtimeRole` | 同左 | 同左 |
| OSS 主存储 | `ossBucket`、`ossEndpoint`、`ossPrefix` | 私有、版本控制从未启用；角色可读写部署前缀 | 同左 |
| 入口 | `publicUrl`、`tlsSecretRef`；真实 DNS、已签发域名证书及匹配私钥 | prepare 渲染器使用 HTTPS 443 | 同左 |
| 业务初始化 | `release`、`adminEmail`、`modelProfile.baseUrl/modelId/apiKeySecretRef` | 同左 | 同左 |
| 数据资源 | — | 新的专用 `dataVolumePath`、`backupTargetRef` | `rdsInstanceId`、`redisInstanceId`、`databaseSecretRef`、`migrationSecretRef`、`redisSecretRef` |
| 运维策略 | — | backup target 的私有 OSS bucket/prefix 和 ECS role | `backupRetentionDays`；该字段不自动证明策略真实存在 |
| 发布清单 | release、完整 `sourceRevision`、目标 `platform`、Web/API/Agent/Sandbox/PG/Redis 的 digest 镜像 | 预热并核验 6 个镜像 | 预热并核验 4 个应用镜像；清单结构仍保留 6 个字段 |
| 执行参数 | prepare 的 `checkoutDirectory/runtimeDirectory`；provision 的 `projectName/runtimeDirectory/agentEnvironmentSecretRef`；request 的 `configFile/releaseFile` | 同左 | 同左 |

Secret payload 以相应 schema 为准：

- `tlsSecretRef`：`certificatePem` 和 `privateKeyPem`。证书内容、私钥、密码、API key、license、连接 URI 均不得进入验收公开证据。
- Starter `backupTargetRef`：`backend=oss`、`region`、`bucket`、区域 HTTPS `endpoint`、独立 `prefix`、`authMode=ecs-role`、`roleName`；region 和 roleName 必须分别匹配部署的 regionId 和 runtimeRole。见 [备份目标与传输](./starter-backup-restore.md)。
- Production `databaseSecretRef`：host/port/database、固定 `user=app_rw` 和 password、`diagnosticsUser=app_diag_ro` 和 diagnosticsPassword；自有 CA 不在系统根证书库时提供 `caFile`。
- Production `migrationSecretRef`：相同 host/port/database、独立迁移 user/password，不能复用 app_rw 或 app_diag_ro。
- Production `redisSecretRef`：host/port、password，可选 username。生产连接必须使用 TLS。
- Starter `agentEnvironmentSecretRef`：只需 `LANGGRAPH_CLOUD_LICENSE_KEY`。Agent、Memory、PG、Redis 的独立稳定密码与 URI 由部署生成；不能要求用户另建外部 Starter PG。
- Production `agentEnvironmentSecretRef`：`DATABASE_URI`、`REDIS_URI`、`LANGGRAPH_CLOUD_LICENSE_KEY`、`databaseCaFile`、`memoryCaFile`、`MEMORY_STORE_DATABASE_URL`、`MEMORY_STORE_MIGRATION_DATABASE_URL`。Agent、Memory、API使用隔离数据库；Memory固定运行角色 memory_rw、迁移角色 memory_owner。三条 PG URI 只允许恰好一个 `sslmode=verify-full` 查询参数，拒绝身份覆盖参数；Redis URI要求 `rediss:`，CA文件由部署映射，不在输入 URI 中嵌入主机文件路径。app、diagnostics、migration、graph、memory runtime、memory owner 六个数据库身份的密码必须全局互异。

Production Agent payload 的当前运行契约在 `runtime-bundle.ts` 的
`productionAgentSecretSchema`；基础数据 payload 在 `data-secrets.ts`。如果这些
schema 改变，必须同时更新本表和对应反证，不能仅改文档让未实现的参数看似可用。

## 准备到部署的交界

| 检查项 | Starter | Production | 可接受证据 / 不可替代项 |
|---|---|---|---|
| 输入结构、互斥字段、区域和 digest | 必须 | 必须 | schema 实际验证；示例地址不算资源证据 |
| 干净 checkout 与 manifest SHA 一致 | 必须 | 必须 | Git SHA/status；规范安全文件从同 SHA 的 Git object 提取 |
| root 路径信任 | 必须 | 必须 | 外部先验证启动包；prepare递归检查checkout并把结果写入收据。runtime、配置/secret 文件及既有祖先无符号链接、由 root 拥有且不可被 group/other 写；服务 UID 只允许拥有指定数据叶目录 |
| prepare receipt 与文件完整性 | 必须 | 必须 | receipt/specHash、canonical seccomp/AppArmor、Nginx/证书文件实际哈希均一致；篡改文件及重写 receipt 仍必须失败 |
| 专用本机数据目录归属 | PG/Redis目录与 receipt 的安装 ID/specHash marker 一致 | 不创建本地 PG/Redis数据目录 | 不采用外来目录、符号链接或伪造归属 marker |
| AppArmor | 专用 profile enforce | 专用 profile enforce | 加载后的内核 profile 状态；文件存在本身不算 enforce |
| 镜像准备 | 6 个镜像 | 4 个应用镜像 | 本机 RepoDigests、平台和应用 revision label；不能仅凭 pull 退出码 |
| Nginx 入口安装 | 人工审核安装至目标实例 | 同左 | 目标实例配置测试、定向 reload、域名路由；不覆盖其它站点 |
| TLS 入口核验 | 实际域名/CA验证、匹配配置 leaf | 同左 | provision 的真实 TLS请求；prepare只验证本地证书，不替代入口 |
| PG/Redis数据面 | 实际认证、角色边界、迁移清单、Redis PING | 同左，另加证书链 | 不能用 SELECT 1 代替角色/迁移完整性 |
| 托管控制面 | 不适用 | RDS PG16/运行主实例/HA/VPC，备份保留；Redis7/运行/HA/认证/VPC | 实际资源 ID/区域/endpoint 对应官方响应；仅 PING 不能证明 HA |
| Agent 与 Memory | 独立数据库、许可、运行/迁移权限、真实服务启动 | 同左及各托管连接 TLS | setup脚本、真实 Agent readiness 和 Memory反证；有 URI 不等于服务可用 |
| 业务探针 | 管理员幂等、真实业务链、OSS 写入读回及规定隔离反证 | 同左 | 必须执行正式实现；不能替换为 no-op 或 HTTP 200 常量 |
| 备份恢复 | 私有 OSS传输读回；新目录/新数据库恢复且不覆盖已有对象 | 托管备份策略 + 真实独立恢复验收 | 本机PG恢复/SDK回环只证明其本机范围，不等同RDS/OSS真实恢复 |

`prepare-host` 的成功收据状态是
`files-ready-ingress-installation-required`，CLI仍返回
`readyForProvision=false`、`cloudVerified=false`。这表示文件准备完成且入口尚未
由该命令安装；它既不是一项部署失败，也不是整套部署通过。

provision 的 preflight 必须调用只读 `verifyPreparedHost`，独立从 canonical
Git对象、输入配置与TLS secret重新计算期望值，再校验收据和实际文件。
`integrityVerified=true` 后仍须做真实 ECS身份、入口TLS、数据面和业务核验。
完整性校验不得创建文件、修复哈希或加载 profile。输入 SHA、证书或文件变更时
应显式准备新的受控状态；不能自动接受修改后的 receipt。

## 两档各三轮真实云计时

每档需要三轮成功记录，合计六轮；不能用多次本机计时、平均值或最快一轮替代。
准备阶段的软件安装、资源创建、证书签发、镜像构建/下载、入口安装必须先完成；
没有完成前置条件的尝试记录为前提未满足，不算成功样本，也不能被悄悄丢弃。

| 轮次 | 起点 | 本轮必须证明 |
|---|---|---|
| 1 | 已满足前提的新验收部署，业务数据库尚未初始化 | 全部正式阶段一次完成，管理员/默认Agent创建，所有readiness和业务探针通过 |
| 2 | 同部署、同配置/manifest和同一稳定 secret目录直接重跑 | 所有阶段仍执行；迁移/管理员/默认Agent幂等，数据保留，不轮换密码 |
| 3 | 在专用验收部署先记录一次受控失败/取消，证明任务清理并按既定流程解除不确定状态后重跑 | 正式重跑在预算内完成，数据与身份保持一致，无遗留任务或越权；失败尝试及恢复操作单独保留，不冒充成功轮次 |

禁止为凑第三轮而直接删除锁。发生不确定状态时先核对准确的任务容器、进程及
secret临时文件；只有对应恢复流程允许时才能解除锁。不得对共享生产数据库
执行破坏性重置或故障注入。

每轮保存一个不可变证据目录，至少包含：

1. 原始 `ProvisionReport`：attemptId、startedAt、durationMs、status、lockRetained、8个阶段顺序/状态/用时；成功必须所有阶段恰好一次 passed、总 durationMs≤300000、lockRetained=false。
2. 外部观察的开始/结束UTC时间和 `commandWallMs`，单列CLI读取/校验及终态报告fsync时间。当前代码的300秒硬预算只覆盖实际动作和中间报告；用户侧“五分钟完成”还要求每轮 `commandWallMs≤300000`。两项必须同时通过，不得藏进某阶段或用平均数掩盖超时。
3. config/manifest/prepare receipt 的 SHA256、sourceRevision、目标平台、全部要求的镜像 digest；保存非秘密原件及区域/实例标识，禁止复制runtime env或secret文件。
4. 准备完整性结果、AppArmor enforce、实际ECS身份/role、TLS证书公开指纹、目标域名，以及 Production托管资源控制面判定摘要。
5. 数据迁移/角色、真实Agent/Memory与业务探针的结构化结果；管理员和默认Agent的稳定ID可以记录，认证token、请求Authorization头、密码和连接URI不得记录。
6. 轮2/轮3与轮1的身份/数据一致性对比、失败重试和清理证据。备份文件只保留校验和/大小/私有对象ID；数据文件本身留在授权的私有目标。

运行前还必须确认该发布镜像包含这些命令与探针；对旧镜像在宿主临时挂入新代码
不是发布验收。任何阶段失败、缺阶段、预算超限、哈希不匹配、清理不确定或证据
缺失，都保持未通过。真实云三轮尚未执行时，矩阵的云验收栏必须保持待验收。

## 当前可独立运行的交界验证

```sh
pnpm --filter @repo/cloud-deploy exec vitest run test/prepare-host.test.ts --maxWorkers=1 --minWorkers=1
pnpm --filter @repo/cloud-deploy typecheck
```

这些测试覆盖两档的完整性成功、修改安全文件并伪造收据、未完成收据、入口文件
篡改、Starter归属marker错误、私有文件、重跑和外来profile拒绝。它们使用模拟
主机命令与临时证书，不安装Linux服务，不访问云，不计入上述六轮真实云样本。
