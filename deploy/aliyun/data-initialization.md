# 数据依赖与管理员初始化

Starter 与 production 使用同一迁移、管理员和 readiness 路径。所有命令在预构建应用制品根目录执行，外层 provision 必须施加剩余总 deadline。这里的脚本失败返回非零；配置值、密码和数据库错误不会进入脚本的 JSON 结果。

## 前置条件

- PostgreSQL 16，支持 `vector` 扩展并允许迁移身份创建该扩展。普通 `postgres:16` 不包含它；Starter 应使用已固定 digest 的 pgvector 镜像。RDS 必须事先确认版本/扩展支持。
- 云端迁移前预建 `app_rw` 与 `app_diag_ro`，设置至少 16 字符的独立强密码，均不可具备 SUPERUSER、BYPASSRLS、CREATEDB、CREATEROLE。迁移脚本拒绝缺失/不安全角色，避免执行开发密码 seed。SQL 授权使用固定角色名，不能任意替换。
- migration 身份独立，能拥有应用表、运行 DDL 和授予上述运行角色所需权限。不能用 `app_rw` 或 `app_diag_ro` 迁移。运行 API 不接收 migration 密码。
- PostgreSQL 运行身份不拥有业务表，所有已启用 RLS 的表必须 FORCE RLS。
- Redis 开启认证；production 必须启用 TLS。production PostgreSQL 必须 verify-full，使用系统可信根或 `PGSSLROOTCERT` 的 PEM CA 文件。绝不使用 `rejectUnauthorized=false`。

## 密钥引用内容

机器定义唯一来源：[data-secrets.ts](../../packages/cloud-deploy/src/data-secrets.ts)。`databaseSecretRef` 的 JSON 包含 host、port、database、user=app_rw、password、diagnosticsUser=app_diag_ro、diagnosticsPassword，可选 caFile（容器内绝对路径）。`migrationSecretRef` 包含同 host/port/database、独立 user、password。`redisSecretRef` 包含 host、port、password、可选 username。`productionDataEnvironment` 校验它们并生成运行变量；返回值含密钥，不得写入公开 plan、日志或报告。

Starter 由 provision 稳定生成并持久化上述密码，重跑不得轮换。准备阶段预建角色后才执行 migration。生产诊断密码由 databaseSecretRef 显式提供，不隐式退回开发默认值。

## 命令与最小参数

1. `node --import tsx apps/api/src/infrastructure/db/migrate-cli.ts`
   - PGHOST、PGPORT、PGDATABASE、MIGRATION_DB_USER、MIGRATION_DB_PASSWORD、WORKSPACEX_DEPLOY_PROFILE。
   - production 增加 PGSSLMODE=verify-full；私有 CA 时提供 PGSSLROOTCERT。
   - 默认连接 5 秒、语句 30 秒、迁移锁 10 秒。PGCONNECT_TIMEOUT_MS、PGSTATEMENT_TIMEOUT_MS 可调，范围 1–300000 ms，不能无限等待。全部迁移时间仍受外层 provision 总 deadline 限制。
2. `node --import tsx apps/api/scripts/provision-admin.ts`
   - 相同 PG 连接/TLS，使用 APP_DB_USER=app_rw、APP_DB_PASSWORD；无需 migration、诊断、Redis 或 OSS 密码。
   - PROVISION_ADMIN_EMAIL、PROVISION_ADMIN_PASSWORD、PROVISION_ADMIN_NAME、PROVISION_ORG_NAME。
   - 首次使用既有一次性 bootstrap 契约，发布三个默认 Agent。重跑必须验证现有密码、已验证邮箱、唯一匹配组织及 admin 身份；只补齐 Agent，不改密码、不授予角色、不重开公共 bootstrap gate。Agent 发布失败会返回失败，后续重跑可修复。
3. `node --import tsx apps/api/scripts/data-readiness.ts`
   - 相同 APP PostgreSQL 连接；REDIS_HOST、REDIS_PORT、REDIS_PASSWORD，可选 REDIS_USERNAME。
   - production REDIS_TLS=true；Starter 默认 false，仅适用于受控私网。
   - 检查真实连接角色、RLS/所有权、制品全部迁移 checksum 和 Redis PING。仅通过 HTTP 200 或数据库 SELECT 1 不足以代表 readiness。

`data-readiness` 是本步骤依赖验收，不代表 Agent、Sandbox、OSS 或完整业务链已通过，也不自行宣称 cloudVerified。

## 已执行证据

隔离 pgvector PostgreSQL 16 + Redis 7.4.9：252 个空库迁移、迁移重跑零新增、100 ms 锁等待超时、管理员创建、两个并发重跑返回相同用户/组织、错管理员密码拒绝、依赖 readiness、错 Redis 密码拒绝均通过。复验命令：

```sh
WORKSPACEX_DATA_TEST=1 node --import tsx apps/api/scripts/verify-provision-data.ts
```

该命令要求显式提供独立测试 PG owner、APP_DB_PASSWORD 和 Redis 参数；自动创建随机测试数据库并在 finally 删除它。不能对生产实例运行。单元测试：`pnpm --filter @repo/api exec vitest run --config vitest.data.config.ts`。

真实 RDS/托管 Redis 的证书、权限与网络验收仍需部署目标；以上隔离测试不能替代它们。
