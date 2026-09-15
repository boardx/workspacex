# Bootstrap compatibility preflight

## 目的

当前 canonical provision 的顺序是 `migrate → bootstrap`。`migrate` 成功后，bootstrap 才首次执行 `scripts/provision-admin.ts`，此时才发现镜像入口、环境输入、schema、权限、存量管理员身份或 Agent seed 闭包不兼容，会留下“迁移已执行但发布回滚”的高成本失败。

本 preflight 分两阶段把这些兼容性判断移到发布构建前和镜像 seal 后、prepare/activate 前。它对生产数据库只读，不创建账号、组织、成员、Agent 或版本，不修改密码，不取得 advisory write lock。

## 运行边界

1. 构建前用 exact source tree 的 side-effect-free 入口和将用于 bootstrap 的同一份环境映射；此时不得要求或宣称目标 API image digest。镜像 seal 后，再使用 exact 目标 API image digest 检查真实镜像入口及相同输入。秘密只通过临时 `--env-file` 注入，永不进入 argv/stdout。
2. 镜像静态检查使用 `--network=none --read-only --pull=never`。不能直接 import `scripts/provision-admin.ts`，因为该文件有 top-level 执行和写库副作用。
3. 数据库检查使用 app runtime 身份，连接建立后第一条事务语句必须是 `BEGIN TRANSACTION READ ONLY`，随后验证 `SHOW transaction_read_only = on`。设置短 `statement_timeout`，最后无条件 `ROLLBACK`。
4. probe 进程结束后检查临时容器和 env 文件均已删除；无法证明清理时返回 `BOOTSTRAP_PROBE_CLEANUP_UNPROVEN` 并保留 release lock。
5. 输出只允许一条 `CN_BOOTSTRAP_COMPAT_JSON=<json>`；诊断只写 stderr 且只包含稳定 code。

## 检查闭包

### A. 源码入口与目标镜像入口

- prebuild：exact source tree 的静态入口和依赖闭包与冻结 SHA 一致；目标 image 尚未存在，不能填 `imageEntrypoint`；
- preactivate：目标 image digest、平台和 `org.opencontainers.image.revision` 与 sealed release manifest 一致，填 `imageEntrypoint`；
- `scripts/provision-admin.ts`、`tsx`、`@repo/contracts`、bootstrap application/repository 模块和三个 Agent seed repository 在镜像内可读；
- 单独的 side-effect-free compatibility 入口可以加载上述模块；禁止通过运行真实 bootstrap 入口来证明“可加载”；
- 当前 runtime Node 版本和 module resolution 可执行一个无网络、无数据库的 import smoke。

### B. 输入契约

使用真实环境变量名和脱敏替身执行 `auth.operations.bootstrapFirstUser.in.safeParse`。检查：管理员邮箱格式、密码策略、显示名、组织名、部署 profile、默认 Agent model ID 和 PostgreSQL TLS 路径。只输出每个字段是否通过，不输出值。

秘密文件检查只验证存在、regular file、非 symlink、owner/mode 和能被目标容器读取；不得读取后回显。compatibility evidence 中管理员邮箱仅保存规范化值的 SHA-256。

### C. 数据库 schema 与权限

在只读事务中通过 `to_regclass`、`information_schema.columns`、`pg_constraint`、`has_table_privilege` 和 `has_function_privilege` 检查 bootstrap 真实写路径依赖：

- `auth_bootstrap_state`、`credentials`、`organizations`、`org_memberships`；
- `agents`、`agent_versions`、`capability_listings` 以及 system-agent repository 当前声明的关联表；
- `kernel_user_org_ids(text)` 和当前 repository 使用的其它函数；
- runtime role 对实际将执行的 SELECT/INSERT/UPDATE 权限，以及相关 sequence 权限；
- `credentials_email_uniq`、personal-local 唯一约束、Agent stable-name/version/listing 唯一约束存在。

关系清单必须由 side-effect-free compatibility 入口与真实 repository 共享，不能在发布 shell 中复制第二份静态 SQL 清单。preflight 只调用 PostgreSQL catalog 权限函数，不试写再回滚；`INSERT` 即使回滚也会触发 sequence、trigger 和外部副作用，不属于“无生产写入”。

### D. 存量状态分类

只允许两个可继续状态：

- `empty`：`auth_bootstrap_state` 无 singleton 且 `credentials` 为零；真实 bootstrap 将原子创建首位管理员。
- `matching-existing`：bootstrap gate 已消费；目标 email 对应一个已验证 credential，给定密码的 bcrypt 校验通过；其 membership 中恰有一个 `org_role=admin` 的 organization，名称与配置一致、kind 为 `organization`。三个 system Agent 的既有 stable identity 与发布模板兼容，缺失项可由幂等 seed 补齐。

以下均为阻塞：marker 与 credentials 相互矛盾、email 不存在或重复、密码不匹配、邮箱未验证、零个或多个匹配管理员组织、organization 名称/kind 不符、Agent stable identity 冲突。输出只给分类 code、计数和布尔值，不输出 email、hash、组织名或数据库错误文本。

### E. Agent seed 兼容性

对 default、deep-research、image-gen 三个模板分别只读检查：stable name 的匹配数量为 0 或 1；若为 1，其 org、provider、发布版本指针和 capability listing identity 与当前模板允许的幂等路径兼容；必要表、约束和权限齐全。不得调用 `ensureDefaultAgent`、`ensureDeepResearchAgent` 或 `ensureImageGenAgent`，因为这些函数会写库。

## 稳定、脱敏 failure code

最外层 canonical report 保留 `stage=preflight` 或 `stage=bootstrap`，并增加一个稳定 `failureCode`。不得把异常 message、SQL、DSN、email、provider body 或 stderr 原文写入 report。

| failureCode | 含义 | 可公开 evidence |
|---|---|---|
| `BOOTSTRAP_IMAGE_INCOMPATIBLE` | 目标镜像缺入口/模块或 revision 不一致 | image digest、缺失组件的固定 ID |
| `BOOTSTRAP_INPUT_INVALID` | bootstrap 环境未通过契约 | 失败字段 ID 列表 |
| `BOOTSTRAP_DB_SCHEMA_INCOMPATIBLE` | 表、列、函数或约束不兼容 | 缺失对象的维护型 ID，不含 SQL |
| `BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE` | runtime role 缺必要权限 | role 固定名、权限 ID |
| `BOOTSTRAP_STATE_CONFLICT` | marker/credentials/组织基数不满足两种状态 | `stateClass=conflict`、脱敏计数 |
| `BOOTSTRAP_EXISTING_ADMIN_MISMATCH` | 已有安装与配置管理员身份不匹配 | 各项 match 布尔值、email SHA-256 |
| `BOOTSTRAP_AGENT_SEED_INCOMPATIBLE` | 三个系统 Agent 无法安全幂等 seed | template ID、冲突类型 |
| `BOOTSTRAP_READ_ONLY_GUARD_FAILED` | 未能证明事务只读或检测到写语句 | 固定 guard ID |
| `BOOTSTRAP_MACHINE_OUTPUT_INVALID` | stdout 不是唯一前缀 JSON | record count，不保存原文 |
| `BOOTSTRAP_PROBE_TIMEOUT` | probe 超出预算 | durationMs、budgetMs |
| `BOOTSTRAP_PROBE_CLEANUP_UNPROVEN` | 临时容器/env 清理无法证明 | container logical ID、文件 logical ID |
| `BOOTSTRAP_COMPATIBILITY_UNKNOWN` | 未分类异常 | correlation ID；私有受控日志另存 |

映射优先级从 cleanup/read-only guard 开始，再到 timeout、output、image、input、schema、permission、state/admin、Agent seed，最后 unknown。一个 attempt 可返回多个兼容性 blocker，但每个 probe 只选择最具体 code。未知错误永远阻塞。

## 机器结果

```json
{
  "schemaVersion": 1,
  "sourceSha": "40-hex",
  "phase": "preactivate",
  "imageDigest": "sha256:64-hex",
  "ready": true,
  "readOnlyTransaction": true,
  "productionWriteStatements": 0,
  "stateClass": "empty",
  "checks": {
    "imageEntrypoint": true,
    "inputContract": true,
    "schemaContract": true,
    "permissionContract": true,
    "agentSeedContract": true
  },
  "blockers": []
}
```

prebuild 机器结果的 `phase` 改为 `prebuild`，删除 `imageDigest`，并以 `sourceEntrypoint` 取代 `imageEntrypoint`。两次结果分别经脱敏后计算 SHA-256，分别作为聚合预检 `bootstrap.compatibility.evidenceSha256`。`ready=true` 还必须满足 stdout 恰好一个机器记录。prebuild 失败时 `buildStarted=false`；preactivate 失败时不得激活，且旧服务必须保持可用。

## 反证验证

实现该 probe 的 PR 至少注入以下反证，每项必须在 migration/activate 前红退且数据库写计数仍为零：

1. 从测试镜像移除 `scripts/provision-admin.ts`；
2. 传入不满足密码策略的替身输入；
3. 隐藏一个必要 column/constraint；
4. 撤销 runtime role 的一项必要权限；
5. 构造 consumed marker + 不匹配管理员；
6. 构造重复 system Agent stable identity；
7. 在 probe SQL 中注入 `INSERT`，由 read-only transaction 拒绝；
8. 在 stdout 前加一行 pnpm 噪声，机器协议门必须拒绝。

生产只运行无写版本；上述破坏性反证全部在隔离测试数据库和测试镜像中执行。
