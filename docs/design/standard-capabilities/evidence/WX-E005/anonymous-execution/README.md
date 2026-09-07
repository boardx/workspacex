# WX-E005：匿名 HTTPS MCP 已审核工具执行增量

本增量提供已审核 MCP 工具的运行时快照和执行桥。不是 E005/W10 全量交付，不包含凭据 broker、浏览器会话或生产部署验收。

## 复用与权限事实

- 协议与输入/输出 JSON Schema 校验复用已安装官方 `@modelcontextprotocol/sdk` 1.30.0 的 `Client`、`StreamableHTTPClientTransport` 和 `AjvJsonSchemaValidator`；不实现第二套 MCP/JSON Schema 引擎。Python 使用既有官方 LangChain `StructuredTool`，通过实际 `ToolRuntime` 注入调用身份；远端 endpoint 和秘密不进入模型配置。
- 复用已有 `reviewMcpServer`、`evaluateMcpAuthScope`、`whitelistEntryGrants`、MCP 完整 schema fingerprint 及 guarded-fetch 的字面量/DNS/redirect 防护。新增 immutable 审核快照明确绑定 endpoint、工具完整 schema/fingerprint 和审核记录；发现结果不会自动成为批准。
- `agent_versions.tool_policy=[]` 不产生授权。capture 校验 run 的真实固定 agent version 与 agent 关系，并在事务内冻结实际受信 `agents.tool_whitelist` 中已允许的条目。`agent_observed_updated_at` 只是来源时间元数据，不替代 immutable agent_version_id。空配置或本地组织得到零工具；不可见/过期/错误 attempt 保持错误。
- 模型名称 `mcp__<server>__<tool>` 映射冻结 canonical fullName，限制长度/数量并拒绝碰撞。未知 schema、保留参数 runtime/config、无效 schema 编译会阻止放行。
- 新 `POST /mcp-servers/:serverId/review` 经过真实组织 lead/admin 与已有非自审规则。内部 invoke 只接受服务 key 和当前 run/attempt/epoch/tool_call_id；调用者不能选择 snapshot 或 endpoint。current requester 必须是该 run 同 thread 的真实 human 输入消息作者。
- 实际执行权限复用 `ToolExecutionAuthority`。首次检查、持久 pending 前以及结果返回前均复核当前 lease/cancel/visibility/批准/端点/指纹/授权 scope；一次批准在同 attempt 下由既有 reader 幂等复用。远端执行期间发生取消或撤权，不返回/存储晚到内容，receipt 变 unconfirmed；这不宣称远端副作用已停止或已撤销。
- 每个 run/tool_call_id 有持久 receipt；同参数成功结果可重读，不同参数或 pending/unconfirmed 不能重新发送。未知远端结果没有自动重试。这里不是对第三方远端操作的 exactly-once 保证。
- app_rw 只能查询 mcp_server_secrets 的标识列来判断 configured；ciphertext SELECT 在真实 PG 中仍被拒绝，没有新增秘密读取 GRANT。已配置凭据、客户数据、未支持团队 scope 当前均拒绝。

## 有界运行

官方 SDK 的 schema 编译、网络和结果校验都在 Worker 中执行：最多 2 个并发 Worker、128 MiB V8 堆、30 秒总期限；终止完成后才释放槽。review 用同一 Worker 批量编译 schema，无网络。冻结描述/累计响应各最多 1 MiB，args 最多 256 KiB，每 run 最多 128 个 receipt；所有数字来自共享契约。资源值是进程内 Worker 堆及协议边界，不是操作系统容器隔离声明。

测试中的公开域名通过显式构造器 DNS seam 解析到本地 TLS fixture，且额外信任 fixture CA。生产构造没有此 seam；另有真实 production DNS checker 拒绝 loopback 且零新连接的反证。没有修改全局 TLS 或 DNS 设置。

## 已执行证据

工作目录 `/private/tmp/workspacex-standard-capabilities`。

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/mcp/mcp-execution-worker-real-protocol.test.ts tests/mcp/mcp-execution-snapshot-real-db.test.ts
apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_mcp_snapshot_tools.py -q
node --test apps/api/scripts/tests/mcp-execution-boundary.test.mjs
pnpm --filter @repo/api exec tsc --noEmit
pnpm --filter @repo/api run lint
node --import tsx packages/contracts/scripts/generate-mcp-execution-schema.ts --check
```

- `api.txt`：15/15 通过。10 项真实 PG/API 包含 production createApp 审核 route 与内部 key/跨 org/注入拒绝、固定快照、权限撤销、未知结果不重放、晚到取消/撤权不泄漏、真实一次批准、secret 列级拒绝、本地组织空快照。另一个完整调用把真实 internal controller → PG snapshot/grant → Worker → 官方 HTTPS MCP server → PG receipt 串在一起，返回 `queried full-chain`。该调用使用最小 Nest module 配置真实服务实例，只为传入本地 TLS/DNS fixture；production createApp 的实际 DI 有单独测试。
- 5 项真实 HTTPS Worker 测试覆盖工具结果/structuredContent、参数与指纹变化拒绝、生产 DNS gate、并发槽、总期限终止及灾难性 regex CPU 不阻塞主线程。
- `python.txt`：8/8 通过；包含真正编译的 LangGraph + ToolNode，模型伪造 runtime 无法替换 callback org/callId，schema 显式声明保留字段会拒绝。Python HTTP 使用 MockTransport，仅说明 LangChain 投影/传输边界，不宣称 Python nativegraph 至远端 MCP 的全链已由此测试证明。
- `permission-boundary.txt`：22/22 AST 边界及删改反证通过；没有新增 ALLOWLIST。
- `lint.txt`：完整 API lint 退出 0。`typecheck.txt`：以执行退出码为准，成功时无输出。
- `before.txt` 记录开发中 fixture 的初始失败（重复 membership 插入等），不是生产行为反证或通过证据。
- 所有本组隔离 wrapper 都已自动清理。迁移已在真实全量 migration 初始化中执行；本组未独立重复 replay 此迁移，仍由仓库 migration gate 检查。

## 尚未覆盖

凭据托管/解密、OAuth、browser provider、团队 scope、客户数据出网、所有终端用户的部署及真实付费模型未在此增量交付。现有 reIsolateMcpServer 只有契约、尚缺生产治理恢复入口；已审核 server 改 schema 后会安全拒绝，不能据此声称重新隔离/重新审核生命周期完整。

root 负责的 native owner/resolve/factory 接线及其额外测试单独记录；本目录不把存在源码当作那些路径已经验收。`file-manifest.txt` 是本 agent 文件范围；root 的 kernel/native/schema 集成及共享 lint 入口需要按本次差量一并审查。
