# Starter / production 初始化前提与参数

本文件说明当前代码接口。真实云计时尚未验收；进度以 `cloud-provision-progress.md` 为准。

## 初始化前必须完成

两档共用：同地域阿里云 ECS、私有 OSS 桶、实例 RAM 角色、HTTPS 域名与反代、模型服务与凭据、已签发证书。OSS 桶须从未启用版本控制，应用不能回退到本地文件。ECS 上预装 Linux、Git、Node 22、pnpm 9.15、Docker、Compose ≥2.30、AppArmor 和 `apparmor_parser`；production 另需 Aliyun CLI 的只读资源检查权限。

使用发布 commit 的干净 checkout 作为部署驱动；该 HEAD 必须等于 release manifest 的 `sourceRevision`。提前安装驱动依赖，并构建/下载全部指定架构镜像，得到真实仓库 digest。provision 只核验缓存，不会拉镜像、构建或安装依赖。目标 Docker daemon 架构必须等于 manifest，不接受仿真构建的五分钟承诺。

prepare-host 会完成以下应用专属主机设置。checkout、配置/secret 文件以及目标路径的全部既有祖先必须由 root 拥有，且不可被 group/other 写入，也不能包含符号链接。其父目录须预先存在，目标 runtimeDirectory 和 Starter dataVolumePath 应使用尚未创建的新路径；不要提前手工建立目标目录或加载同名 AppArmor profile：

- 创建 root 私有 runtimeDirectory（0700），写入仓库 Sandbox 的 `docker-seccomp.json`，加载 `workspacex-native-sessions` AppArmor enforcing profile。
- Starter 创建专用 `dataVolumePath/postgres` 和 `/redis` 持久目录；PostgreSQL 镜像须为 16 且具有仓库迁移所需 pgvector，Redis 为 7。应用表和管理员仍在 provision 中创建，不提前迁移以规避计时。
- HTTPS 反代 `/` 到本机 3000；`/api/copilotkit` 及子路径优先到 Web；其余 `/api/` 剥前缀到本机 3200，支持 WebSocket Upgrade 和长连接。Web 容器内部通过 `API_INTERNAL_URL=http://api:3200` 访问 API。
- production 的 RDS/Redis 已运行、同地域 VPC 可达、高可用、认证和 TLS 配置正确。RDS 为 PostgreSQL 16，应用/诊断/迁移角色分离；备份策略保留天数满足配置。当前只支持能够明确核验的经典备份策略。
- Agent 官方生产服务需要有效 LangGraph Server 许可。是否采用既有许可或开发自建服务仍待用户选择；不会购买许可或把开发服务器冒充生产服务。

在 ECS root 身份下先运行 `pnpm --filter @repo/cloud-deploy prepare-host <config> <manifest> <checkout> <runtime>`。该命令生成私有运行目录、安全配置、证书、Nginx 配置和可复核收据，并预热 manifest 中的固定 digest。它不会修改系统 Nginx；运维人员安装生成的入口配置并完成定向 reload 后，provision 再核对线上 TLS、ECS 身份和准备收据。

这些是环境准备条件，不是要求把密码发到聊天中。角色访问优先；其余配置用环境变量名或私有文件引用。

## 参数入口

部署业务配置以 `packages/cloud-deploy/src/config.ts` 及其生成的 JSON Schema 为准。可用 `pnpm --silent deploy:config example starter` 或 `example production` 生成两档结构，再运行 `validate`。例子中的资源名称只展示格式，不能证明资源存在。

| 范围 | 参数 |
|---|---|
| 共用环境 | `regionId`、`ecsInstanceId`、`runtimeRole`、`ossBucket`、`ossEndpoint`、`ossPrefix`、`publicUrl`、`tlsSecretRef` |
| Starter | `dataVolumePath`、`backupTargetRef` |
| production | `rdsInstanceId`、`redisInstanceId`、`databaseSecretRef`、`migrationSecretRef`、`redisSecretRef`、`backupRetentionDays` |
| 每次安装 | `release`、`adminEmail`、`modelProfile.baseUrl`、`modelProfile.modelId`、`modelProfile.apiKeySecretRef` |

告警联系人和按天日志保留不属于这条最小安装路径，已从必填 Schema 删除。容器采用 Docker local 日志驱动，每个服务最多 5 个 10 MiB 日志文件；这是大小上限，不承诺按天留存。`backupTargetRef` 保留并执行真实写入/读回预检；自动备份调度单独配置，不能仅凭手工备份通过宣称定时任务已运行。

## 受保护引用的实际内容

引用格式为 `env:VARIABLE_NAME` 或 `file:/absolute/private-file`。文件须是无符号链接的私有普通文件、非空、≤64 KiB；变量值不能含 NUL。真实值仅进入必要服务的私有 env 文件，不输出到 plan、报告或进程参数。

| 引用 | 内容 |
|---|---|
| `modelProfile.apiKeySecretRef` | 模型 API key 原始字符串 |
| `backupTargetRef` | Starter 受保护 JSON：`backend:"oss"`、`region`、`bucket`、`endpoint`、`prefix`、`authMode:"ecs-role"`、`roleName`。region/roleName 必须匹配当前部署。备份桶要求私有且从未启用版本控制；预检标记留给备份保留策略处理，不删除备份对象。 |
| `tlsSecretRef` | JSON：`certificatePem`（叶证书在前的完整链）、`privateKeyPem`；验证配对、域名、有效期和线上叶证书一致。不会传输私钥。 |
| `databaseSecretRef` | JSON：`host`、`port`（默认5432）、`database`、`user:"app_rw"`、`password`、`diagnosticsUser:"app_diag_ro"`、`diagnosticsPassword`，可选 `caFile`。 |
| `migrationSecretRef` | 同一实例/数据库的 `host`、`port`、`database`、独立 `user`、`password`；不得使用应用/诊断角色。 |
| `redisSecretRef` | JSON：`host`、`port`（默认6379）、`password`，可选 `username`；production 强制 TLS。 |
| Starter Agent secret | JSON：仅 `LANGGRAPH_CLOUD_LICENSE_KEY`。独立 `agent_server/workspacex_agent`、`memory_rw`、`memory_owner/workspacex_memory` 角色、数据库和稳定密码由初始化生成。 |
| production Agent secret | JSON：`DATABASE_URI`、`REDIS_URI`、`LANGGRAPH_CLOUD_LICENSE_KEY`、`databaseCaFile`、`MEMORY_STORE_DATABASE_URL`、`MEMORY_STORE_MIGRATION_DATABASE_URL`、`memoryCaFile`。Graph、Memory runtime（固定 `memory_rw`）和 Memory migration（固定 `memory_owner`）身份必须分离，且数据库不得与应用库复用。三条 PG URI 只允许恰好一个 `sslmode=verify-full` 查询参数，拒绝重复 TLS 参数和 `user/dbname/host/port/password` 覆盖；Redis URI 为 `rediss://`。两个 CA 分别复制为 Agent 的 `/run/agent-certs/ca.pem` 与 `memory-ca.pem`。运行服务只获得 Memory 业务表 DML，迁移 owner 只进入一次性准备任务。 |

生产数据库的 `caFile` 被复制到 API/迁移容器的 `/run/certs/ca.pem`。Agent 使用单独的 `/run/agent-certs/` 只读挂载，不能直接读取主机 CA 路径，也不能在常驻环境中取得 Memory owner URI。

production 的 app、diagnostics、migration、graph、memory runtime、memory owner 六个数据库身份必须使用全局互异密码；仅更换用户名而复用密码不能通过初始化。

生成的管理员密码、数据库密码和应用加密密钥存于 `runtimeDirectory/secrets/`，并发重跑保持不变。损坏或不可读时失败，不悄悄生成新密钥。应将稳定密钥作为独立受保护备份保存；数据库 dump 不包含它们。

## 一条 provision 命令

将不含秘密值的请求保存为专用 JSON 文件，例如：

```json
{
  "configFile": "/etc/workspacex/deployment.json",
  "releaseFile": "/etc/workspacex/release.json",
  "options": {
    "projectName": "workspacex",
    "runtimeDirectory": "/var/lib/workspacex-runtime",
    "agentEnvironmentSecretRef": "file:/etc/workspacex/agent-server-secret.json"
  }
}
```

从准备好的发布 checkout，以 ECS root 身份运行：

```sh
pnpm --filter @repo/cloud-deploy provision /etc/workspacex/provision-request.json
```

执行最终预检 → 服务密钥 → 依赖 → 迁移 → 管理员/默认 Agent → 服务启动 → 实际运行版本与就绪 → OSS 和登录/文件/Agent/模型/沙箱业务探针。任何步骤失败都不能输出成功。

每次执行保留独立报告。超时、取消或无法证明任务容器清理时保留部署锁；不根据 PID 消失或锁文件年龄自动解锁。必须先确认该次容器/进程已经停止，再按报告处理。不会自动删除整个 Compose 栈或用户数据。

`durationMs` 是完成业务动作和中间阶段报告的时刻；最终报告 fsync、超时安全清理可能稍后结束。真实五分钟验收必须另计从命令提交到进程返回的 `commandWallMs`，并要求每轮 `durationMs≤300000` 且 `commandWallMs≤300000`。按验收矩阵，每档保存三轮结果：全新安装、同配置幂等重跑、受控失败清理后的恢复重跑；当前没有宣称该验收通过。
