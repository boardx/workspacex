# 云部署文件链路与验收边界

本轮 CP-04 修复由 issue #3427 跟踪。Starter 和 production 使用同一业务入口，字节存储由既有 `ObjectStore` provider 选择 OSS；本文件不重复声明 OSS 配置。

## 已实现的业务缺口

- ZIP 导出此前只有不可兑换的 URL。现在 `/export-jobs/:jobId/content` 真正读取私有对象并返回附件，Web 导出按钮执行认证下载。下载时重新校验原请求者、有效期、当前项目权限及每个源文件的当前可见性；源文件撤回后拒绝旧 ZIP。读取来源集合沿用已持久化的导出审计，缺少审计不能下载。
- 接通既有契约的删除影响预览、请求、任务查询及回执路由。请求在一个租户事务中执行六类级联、任务和审计写入。当前部署的 `ontology_edges` 图召回表已有真实适配：核验 artifact/version/组织归属后删除关联 segment 的双向边。任务和回执查询重新判定合规权限及 artifact ACL，不能仅凭 taskId 访问。
- `pnpm --filter @repo/api files:purge --org <org-id>` 执行指定组织的合规物理清理。它只接受 orgId，不接受对象 key；候选任务、宽限期、法律保全和对象引用由该租户数据库读取。使用运行身份，不使用迁移身份。
- 维护进程由租户事务锁串行化；保全写入使用同一锁。对象清理返回值必须精确覆盖请求的全部 key，错误 key、重复或部分失败都不能产生完成回执。数据库回执、任务状态、审计在同一事务提交；已删字节但事务失败时，下一次执行按缺失对象幂等恢复。

## 显式录音文件上传

`POST /recording/sessions/:sessionId/materialize-files` 接受 multipart：`request` 字段为 `recording.materializeRecordingFiles.in` JSON，`audio` 字段为可选 WebM 文件。元数据必须给出真实长度、SHA-256 和 `audio/webm`；服务端复核字节、容器标识和限制。访谈笔记通过 `notesMarkdown` 提交，转写稿仍由已有片段生成。音频先物化，其余文件的 `derivedFrom` 指向原件版本。

必须在同租户、有当前项目权限且会话已结束时提交；幂等重放也重新检查权限。并发同键使用事务锁串行化，防止重复物化。没有原始 objectKey 参数或跨会话文件引用。原 `/materialize` 无音频调用保持兼容；缺少访谈笔记仍拒绝，不伪造笔记。

Web 的 `lib/live-recording-files.ts` 提供显式文件提交客户端。现有 `live-recording.ts` 只向 ASR 发送 PCM 帧；这个改动**没有**将麦克风录音自动保存为 WebM，也不等同于录音界面自动保留原件完成。

## 真实上传验收入口

`apps/api/scripts/cloud-file-roundtrip.ts` 导出 `verifyCloudFileRoundtrip(baseUrl, sessionToken, orgId, signal?)`，调用方必须提供 bootstrap/login 已选入该组织的会话。传入共享 `AbortSignal` 时，全部请求和逻辑清理共用 provision 截止时间；超时不再发起清理，错误保留该次 threadId 供后续处理：

1. 通过 `chat.mutateThread` 创建唯一的私有个人线程。
2. multipart 上传随机文本附件到 `/chat/threads/:threadId/attachments`。
3. 匿名下载被拒绝；认证下载的实际字节与上传内容一致。
4. 只逻辑删除该次创建的线程。附件字节仍遵循留存和保全，不直接调用 purge。

返回结果的 `fileRoundtripVerified` 只证明业务往返。`ossProviderVerified` 固定为 false，因为 HTTP 客户端无法单独证明服务背后的存储提供者。部署验收应结合 OSS provider 预检、真实 bucket 测试以及重启后业务读回证据。

## 文件路径审计

| 路径 | 持久化入口 | 本轮证据/边界 |
|---|---|---|
| 对话附件 | `uploadAttachment` → `ObjectStore.putOnce`；下载经线程可见性门 | 提供真实业务 smoke 函数；完整安装运行由 provision 验收调用 |
| 录音和转录原件 | 受保护 multipart `/materialize-files` → `materializeSessionFiles` → `ObjectStore`，写后读回 | 真实 HTTP/PG 与新存储实例读回验证；仍非真实 OSS/ASR 验收 |
| 用户头像 | `IdentityController.uploadAvatar` → `uploadOwnAvatar` → `ObjectStore.putOnce`；认证读经 `findAnyById` → `ObjectStore.get` | 真实 HTTP + PG 的 self-service-iter2 覆盖；头像允许其他已认证用户展示是既有权限规则，写入仍归本人 |
| 组织头像 | `OrgAdminManagementController` → `PgOrgProfileRepository.storeAvatar/readAvatarBytes` → 同一个 ObjectStore | 真实 HTTP 上传及大小/超时反证通过；组织元数据按租户读取 |
| 组织间导出 | `ObjectStoreExportTransport` → 同一配置存储 | 原有本地网络断言注释已纠正，不声称云环境零网络访问 |
| ZIP 导出 | `createExportJob` → `ObjectStore` → 认证内容路由 | 真实 PostgreSQL + HTTP 下载、源撤回拒绝、跨租户拒绝通过 |
| Agent/Sandbox 产物 | `NativeOutputStagingController` → `PgNativeOutputStaging` → `collectNativeOutputs` → `ObjectStore` | 真实 PG 暂存、变更拒绝、幂等与正式 artifact version 写回通过；不是完整 Agent/Sandbox 云验收 |
| Sandbox 输入 | `PgNativeRunInputs` 从当前消息附件元数据及 ObjectStore 读取 | 当前消息、作者、租户、线程可见性门仍保留；本轮没有宣称 sandbox 重启执行通过 |

## API 临时文件权限

API 持久文件入口以上述 ObjectStore 为准，云配置不能回退到 FS。Native 输入从对象存储读取后经绑定的 Unix socket 进入沙箱 `/inputs`；`/workspace` 产物由绑定 session/token 读回再持久化。API 的 Playwright 浏览器适配使用 `mkdtemp(os.tmpdir())` 存放临时输出。

本地实际镜像 `sha256:62af3a526a9d3e508dca005cb5a3f52655d53e13dc9ef299856dcc8eb3dd2e8c`（源码 `2fd7b465dbaf9a6885807d2c427514229a0d2146`）在 `--read-only --network none --tmpfs /tmp` 下，以 UID 1000 成功完成临时目录创建、文件写入、读回和删除。它证明该镜像的临时文件权限，不代表后续镜像构建、云端 OSS 或完整浏览器运行已通过。

## 尚未通过的验收

- 真实 OSS 业务流及重启后的录音、头像、Agent 产物读回，需要部署环境的实际运行证据。
- 未配置图边适配的独立调用仍使用显式失败 stub；已配置的 HTTP 路径使用真实 PostgreSQL 图边适配。未来独立外部图服务不在本次本库图边验收范围。
- 当前删除/回执权限沿用项目 facilitator 矩阵，无项目的 artifact 不会绕过角色门；组织级删除角色尚无单独授权路径。
- 部分撤回范围映射（契约 T-8）未裁定。非空 `scope` 返回 `DEPENDENCY_UNAVAILABLE`，不会把“仅撤回 AI 分析”执行成全量删除。
- 维护入口是按明确组织运行的命令，没有引入跨租户扫描或后台调度授权；部署方应按已初始化组织调用。
- ZIP 仍在创建请求内同步生成，尚未实现异步队列。此处不把导出内容路由修复等同于完整异步导出交付。

## 本轮入口复核结果

- 录音 HTTP 生命周期及新增 multipart 并发/权限/派生链验证，加文件校验测试：16 条通过。
- 用户头像所属的 self-service-iter2：7 条真实 HTTP/PG 测试通过；组织头像 HTTP 上传、流超时及大小限制验证通过。
- Native 暂存/写回 1 条与源撤回后拒绝缓存读取 2 条真实 PG 测试通过。
- 显式录音客户端 3 条测试通过，包括真实 FormData 文件字段和 SHA-256；它们不是录音页面交互验收。
- API/Contracts/Web 类型检查和 API 架构/安全 lint 通过。数据库测试使用本 agent 独立端口与数据库，结束后 PostgreSQL/Redis 容器释放。

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
