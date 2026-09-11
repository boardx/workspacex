# Starter / production 配置入口

本切片实现配置校验和部署计划，跟踪 [#3414](https://github.com/boardx/workspacex/issues/3414)。尚不创建云资源、读取密钥、预热镜像、迁移数据库或启动应用。

| 档位 | 应用 | 数据库 / 会话 | 文件 |
|---|---|---|---|
| `starter` | 单 ECS | ECS PostgreSQL / Redis | OSS |
| `production` | 单副本 ECS 应用 | RDS PostgreSQL / 托管 Redis | OSS |

生产档需要提供备份保留期、日志保留期和告警引用，实际高可用配置及备份/告警生效情况由后续云预检确认。单副本应用不宣称高可用。

## 可运行命令

先在仓库运行 `pnpm install --frozen-lockfile`。从仓库根目录执行：

```bash
# 输出可编辑示例；示例中的资源、域名和版本仅为演示，不是真实云资源。
pnpm --silent deploy:config example starter > starter.json
pnpm --silent deploy:config example production > production.json

# 编辑示例后检查。成功返回 0；输入、文件或参数错误返回 2。
pnpm --silent deploy:config validate starter.json
pnpm --silent deploy:config validate production.json
```

文件结构：`schemaVersion: 1`、`environment`、`provision`。`environment.profile` 选择档位；Starter 的 PG/Redis 凭据以后由 prepare 生成，因此不接受生产连接字段；production 必须分别提供应用数据库、迁移和 Redis 引用。示例来自实际 Schema 对应的包代码，修改规则后测试必须保持有效。

两档公共配置：region/ECS/运行角色、OSS 桶/端点/前缀、HTTPS 地址和 TLS 引用。每次部署配置：固定语义版本、管理员邮箱、模型 URL/ID/密钥引用。Starter 另需数据卷路径和备份目标引用；production 另需 RDS/Redis 实例 ID、连接引用、保留期和告警引用。

暂接受 `env:VARIABLE_NAME` 或 `file:/absolute/path` 引用，校验器**不解析引用内容**。不接受数据库密码、API Key 或带明文凭据的 URL。实际引用解析器尚未实现；云密钥服务引用将在实现该解析器时扩展契约。不要在配置中填写真实秘密。

固定版本仍须由后续 manifest 解析器验证存在并固定 digest。`validate` 只检查格式及跨字段关系，不能证明版本已发布、资源存在、角色不同、备份已启用或五分钟达标。成功结果始终包含：

```json
{
  "ok": true,
  "plan": {
    "profile": "starter",
    "release": "1.0.0",
    "database": "ecs-postgresql",
    "redis": "ecs-redis",
    "objectStorage": "oss",
    "applicationReplicas": 1,
    "provisionDeadlineSeconds": 300,
    "cloudVerified": false,
    "status": "configuration-valid-cloud-preflight-required"
  }
}
```

`prepare` 和 `provision` 尚未提供 CLI 命令。不得把上述成功结果当作已部署。

## 契约及验证

运行时事实源为 `packages/cloud-deploy/src/config.ts`；`parameters.schema.json` 是生成的结构校验视图，禁止手工修改。JSON Schema 不表达 OSS 端点地域匹配和应用/迁移引用不同等跨字段规则，部署入口必须调用 `validateDeploymentConfig` 执行完整校验。

```bash
pnpm --filter @repo/cloud-deploy schema
pnpm --filter @repo/cloud-deploy build
pnpm --filter @repo/cloud-deploy lint
pnpm --filter @repo/cloud-deploy test
```

lint 检查生成物漂移，并将仓库外部于包的 Schema 文件纳入 Turbo 缓存输入。CLI 不回显提交值、额外字段名、JSON 解析片段或原始文件错误；拒绝超 64 KiB 文件及非普通文件。

RDS PostgreSQL 示例 ID 前缀依据 [DescribeDBInstances 官方示例](https://help.aliyun.com/en/rds/api-query-instances)。实际资源类型仍需云预检确认。

## 后续交付

1. prepare 的真实身份/资源/网络/制品预检及环境 profile。
2. OSS ObjectStore、合规清除和完整业务文件链路，保持写一次及租户权限语义。
3. 两档数据库/Redis 连接解析、初始化、Agent/沙箱和生产镜像。
4. 带总 300 秒 deadline 的 provision 与真实阿里云业务验收。
