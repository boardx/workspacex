# 同名 MCP 工具双凭据真实并发证据

## 范围与固定基线

- 审查基线：`boardx/workspacex` 的 `codex/standard-capabilities`，实际 SHA `414aca176dcd19d63c68b711a8436e05fe78ee74`。
- 测试文件：`apps/api/tests/mcp/mcp-credential-concurrency-real-db.test.ts`。
- 仅增加测试与证据/承诺口径修正；没有改生产源码。

## 可证伪场景

测试在真实隔离 PostgreSQL catalog 中建立两个 tenant、两个 run、两个独立 HTTPS MCP server。两个 server 都发布 `wait`，因此两个冻结视图暴露完全相同的 runtime 工具名 `mcp__secure__wait`，但各自在本 tenant 的 sealed secret 中保存不同 bearer。

两个 `service.invoke` 同时进入同一个 `McpCredentialExecutionBroker`。测试必须先同时观察到两个远端 handler 已开始，再释放任一响应；此时还断言两者均未完成。每个 HTTPS server 在进入 MCP handler 前严格校验自己的 bearer，串用凭据会返回 401，导致测试失败。释放后还分别验证返回标签、两个 `broker_started_at` 和 `succeeded` 回执，并检查公开 view、结果及持久化回执不含两个原始 token。

这验证的是实际 Worker + 官方 MCP Streamable HTTP transport + HTTPS handler + 专用数据库 claim 的并发隔离，不是 mock transport 或仅比较内存参数。

## 本环境验证状态

当前云端执行环境有 Bash、Node v24.19.0、Git 和 Corepack/pnpm 9.15.0，但没有 Docker、PostgreSQL server 或 `psql`，无法安全建立该测试要求的隔离真实数据库。因此本 lane **未在云端执行，不记为通过**；测试已保留为可在仓库标准 PostgreSQL harness 中运行的真实 lane：

```bash
corepack pnpm@9.15.0 exec tsx .harness/scripts/with-test-isolation.ts -- corepack pnpm@9.15.0 --filter @repo/api exec vitest run tests/mcp/mcp-credential-concurrency-real-db.test.ts
```

通过条件是单项测试退出码 0，且两个 endpoint 都达到“started 但未 finished”的屏障后才释放。若环境不能启动隔离 PostgreSQL，本测试的结果必须继续报告为未验，不能用 mock 或静态检查替代。

本环境可执行的检查结果：API TypeScript `tsc --noEmit` 退出码 0；新增测试的独立 TypeScript 语法转译检查退出码 0。两项都不是上述真实数据库 lane 的替代品。

## 凭据不泄漏承诺边界

现有实现检查原始明文凭据是否直接出现在返回 JSON 中；框架管理的错误、日志、snapshot、receipt 和持久化结果也不得包含该原始明文。它没有通用内容防泄漏能力，不能可靠识别批准 server 返回的 Base64、拆分、加密或派生表示。文档已据此收窄承诺；批准 endpoint/account 仍是 server 已经接收凭据后的治理边界。

对当前 `reflectsMcpCredential` 的直接运行探针得到 `literal=true base64=false`（退出码 0）：原始字面回显会命中，而同一 credential 的 Base64 不命中。这是对实际实现边界的确认，不把 Base64 结果误记为安全拦截能力。
