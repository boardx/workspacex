# WX-E005 受限 MCP 凭据执行 broker

复用现有 AES-256-GCM 封存格式及唯一 MODEL_CREDENTIAL_KEY 配置。明文只在有界 outbound Worker 的私有函数中恢复并送往已批准 HTTPS endpoint，不新增凭据查询 HTTP 接口。公开 runtime view 没有 endpoint、密文、key 或 credential revision；基础设施固定快照记录的 revision 是不可变批准证据。

## 部署

1. 用现有 migration 身份执行迁移，包括 20260909070000。它创建 NOLOGIN/NOSUPERUSER/NOBYPASSRLS/NOINHERIT 的 mcp_executor 角色；已有角色若带危险权限或角色成员关系则失败。
2. 显式设置 MCP_EXECUTOR_DB_PASSWORD（24–256 字符，无换行/NUL），用 migration 身份运行 `pnpm --filter @repo/api exec tsx scripts/setup-mcp-executor.ts`。该独立运维入口只启用固定角色登录，不由运行服务自动提权。没有默认密码。
3. API 设置 MCP_EXECUTOR_DB_USER=mcp_executor、相同 MCP_EXECUTOR_DB_PASSWORD，复用已有 MODEL_CREDENTIAL_KEY 及 PGHOST/PGPORT/PGDATABASE。API 单独保管 broker Pool，Nest 生命周期释放连接。未配置 broker 时 credential 工具保持不可用，anonymous 工具不受影响。

app_rw 仍不能 SELECT ciphertext，也不能执行取密函数。mcp_executor 没有 secret 表的 SELECT；它只能经本增量专用函数领取一个已有 pending 回执，其 org/run/call/attempt/epoch、tool name、参数摘要、固定 review/revision/endpoint 必须一致。broker_started_at 的同事务领取防止重复调用取密后重新执行。

写入、更新、删除凭据会撤销当前评审；新凭据 revision 要重新评审，旧 run snapshot 不自动升级。后台取消使用现有 server 范围治理，父 run 授权仍由共享 ToolExecutionAuthority 负责，不新增主 run 控制源。

## 期限与失败

一次 invoke 只计算一个绝对 deadline。broker 等待与 Worker 使用同一期限，取密晚到时直接丢弃，绝不启动新的远端执行；执行失败和超时保持 unconfirmed、不自动重放。真实数据库回执落盘/清理可能额外等待，因此不声称整个 HTTP 响应有 30 秒硬上界。

框架管理的错误、日志、snapshot、receipt 和持久化结果不得包含原始明文凭据；凭据原始字节直接出现在远端返回 JSON 时，Worker 在发送结果之前拒绝。这里的“不泄漏”仅是原始明文与直接字面回显承诺，不是通用 DLP：Base64 等编码、拆分、加密或派生表示不在该检查的可识别范围内。服务器本来就是批准的凭据接收方；批准 endpoint/account 仍是必要治理边界。Worker stdout/stderr 被隔离消费，失败只返回固定错误码。

## 验证状态

- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/mcp/mcp-credential-broker-real-db.test.ts tests/mcp/mcp-execution-snapshot-real-db.test.ts tests/mcp/mcp-isolation-real-db.test.ts tests/capability/model/credential-never-echoed.test.ts`：45/45，退出码 0，wrapper 清理完成。原始输出 api.txt。新增凭据 8 项使用真实 PG 专用登录、现有 AES seal、官方 MCP SDK、有界 Worker、受控 HTTPS 服务器；错 org/attempt/参数、单次 claim、轮换撤权、直接回显拒绝、GCM 篡改拒绝、真实行锁下绝对期限与迁移重放都有反证。
- `node --test apps/api/scripts/tests/mcp-credential-boundary.test.mjs apps/api/scripts/tests/mcp-execution-boundary.test.mjs`：44/44，退出码 0，原始输出 ast.txt。未增加裸权限 ALLOWLIST。
- `node --import tsx packages/contracts/scripts/generate-mcp-execution-schema.ts --check`：退出码 0。
- 最终 `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/mcp/mcp-credential-broker-real-db.test.ts`：12/12，退出码 0，wrapper 清理完成，见 api-final.txt。增加真实 production Kernel DI 同一 broker 实例及 app.close 生命周期、metadata 直接反射拒绝、JSON 转义 token 匹配、有界 metadata 拒绝。
- 最终 wrapper 运行期间仅将等价 Sealed schema 移至 contracts 内部模块，不能据此断言该进程加载了新的 import；随后独立 `node --import tsx --input-type=module` 导入实际 broker 和共享 schema，确认空 envelope 拒绝及 app_rw 不能构造 broker，退出码 0，见 import.txt。schema 不进入模型/HTTP response/generated runtime artifact。
- 全量 contract-source/permission lint 的最后运行中 MCP 无违规，其他并行 scheduler 类型迁移仍有失败，由 root 修复；不把全仓门控描述成已绿。未声明生产服务已部署。

受控 HTTPS fixture 是真实协议测试，不代表外部生产服务或付费模型验收。
