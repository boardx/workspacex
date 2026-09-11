# 云部署文件链路与验收边界

本轮 CP-04 修复由 issue #3427 跟踪。Starter 和 production 使用同一业务入口，字节存储由既有 `ObjectStore` provider 选择 OSS；本文件不重复声明 OSS 配置。

## 已实现的业务缺口

- ZIP 导出此前只有不可兑换的 URL。现在 `/export-jobs/:jobId/content` 真正读取私有对象并返回附件，Web 导出按钮执行认证下载。下载时重新校验原请求者、有效期、当前项目权限及每个源文件的当前可见性；源文件撤回后拒绝旧 ZIP。读取来源集合沿用已持久化的导出审计，缺少审计不能下载。
- 接通既有契约的删除影响预览、请求、任务查询及回执路由。请求在一个租户事务中执行本地级联、任务和审计写入。任务和回执查询重新判定合规权限及 artifact ACL，不能仅凭 taskId 访问。
- `pnpm --filter @repo/api files:purge --org <org-id>` 执行指定组织的合规物理清理。它只接受 orgId，不接受对象 key；候选任务、宽限期、法律保全和对象引用由该租户数据库读取。使用运行身份，不使用迁移身份。
- 维护进程由租户事务锁串行化；保全写入使用同一锁。对象清理返回值必须精确覆盖请求的全部 key，错误 key、重复或部分失败都不能产生完成回执。数据库回执、任务状态、审计在同一事务提交；已删字节但事务失败时，下一次执行按缺失对象幂等恢复。

## 真实上传验收入口

`apps/api/scripts/cloud-file-roundtrip.ts` 导出 `verifyCloudFileRoundtrip(baseUrl, sessionToken, orgId)`，调用方必须提供 bootstrap/login 已选入该组织的会话：

1. 通过 `chat.mutateThread` 创建唯一的私有个人线程。
2. multipart 上传随机文本附件到 `/chat/threads/:threadId/attachments`。
3. 匿名下载被拒绝；认证下载的实际字节与上传内容一致。
4. 只逻辑删除该次创建的线程。附件字节仍遵循留存和保全，不直接调用 purge。

返回结果的 `fileRoundtripVerified` 只证明业务往返。`ossProviderVerified` 固定为 false，因为 HTTP 客户端无法单独证明服务背后的存储提供者。部署验收应结合 OSS provider 预检、真实 bucket 测试以及重启后业务读回证据。

## 文件路径审计

| 路径 | 持久化入口 | 本轮证据/边界 |
|---|---|---|
| 对话附件 | `uploadAttachment` → `ObjectStore.putOnce`；下载经线程可见性门 | 提供真实业务 smoke 函数；完整安装运行由 provision 验收调用 |
| 录音和转录原件 | `materializeSessionFiles` → `ObjectStore`，写后读回 | 代码路径核实；本轮没有新增真实 ASR/录音云验收 |
| 用户头像 | `uploadOwnAvatar` → `ObjectStore`；认证头像字节路由 | 代码路径核实；尚未完成本轮云环境头像验收 |
| 组织间导出 | `ObjectStoreExportTransport` → 同一配置存储 | 原有本地网络断言注释已纠正，不声称云环境零网络访问 |
| ZIP 导出 | `createExportJob` → `ObjectStore` → 认证内容路由 | 真实 PostgreSQL + HTTP 下载、源撤回拒绝、跨租户拒绝通过 |
| Agent/Sandbox 产物 | `collectNativeOutputs` → `ObjectStore`；`PgNativeOutputStaging` 保存引用 | 15 项产物字节/路径/预算测试通过；不是完整真实 Agent/Sandbox 云验收 |
| Sandbox 输入 | `PgNativeRunInputs` 从当前消息附件元数据及 ObjectStore 读取 | 当前消息、作者、租户、线程可见性门仍保留；本轮没有宣称 sandbox 重启执行通过 |

## 尚未通过的验收

- 真实 OSS 业务流及重启后的录音、头像、Agent 产物读回，需要部署环境的实际运行证据。
- `ontology-edges` 级联仍使用既有失败 stub。因此有版本的普通删除请求如实停在 `partial-failure`，不会物理清理或伪造回执。需要实际知识图谱级联实现，不能将“不支持”当成功。
- 部分撤回范围映射（契约 T-8）未裁定。非空 `scope` 返回 `DEPENDENCY_UNAVAILABLE`，不会把“仅撤回 AI 分析”执行成全量删除。
- 维护入口是按明确组织运行的命令，没有引入跨租户扫描或后台调度授权；部署方应按已初始化组织调用。
- ZIP 仍在创建请求内同步生成，尚未实现异步队列。此处不把导出内容路由修复等同于完整异步导出交付。

## 验证命令

```sh
pnpm --filter @repo/api test:file-cloud
PGPORT=<isolated-port> COMPOSE_PROJECT_NAME=<owned-stack> WORKSPACEX_DB=<isolated-db> \
  pnpm --filter @repo/api exec vitest run --config vitest.file-cloud-db.config.ts
pnpm --filter web exec vitest run tests/ui/files-export-download.test.tsx tests/ui/files-browser.test.tsx
pnpm --filter @repo/api typecheck
pnpm --filter @repo/api lint
pnpm --filter web typecheck
```

数据库测试以真实 PostgreSQL 和真实 HTTP socket 执行，并用文件系统后端隔离字节验证；不是 OSS 云验收替代品。未执行的环境测试不得标为“验收通过”。
