# 会话交接 — Sprint 14/01

## 当前已验证
- F01 的 PR（#2729）已合入 `main`（见 `git log`），但 `feature_list.json` 里 F01 的
  status 仍是 `in_progress`——这一行的翻转只能由 `pnpm harness verify` 门控完成，
  本仓至今没有一个会话在 docker 出网可用的环境里把它跑通过；下一个能跑 docker 的
  会话应先补跑 `pnpm harness verify --sprint 14/01 --feature F01`，而不是假设"合入
  main = passing"。
- F13 的 PR（#2730）同样已合入 `main`，同一条环境 blocker（见下方"仍损坏或未验证"）
  拦住了 verify，status 未手动改动。
- F05（放开"一条用户消息只能对应一个 run"约束）已合入 main：feature 自己的
  verification 命令用真实 Postgres 跑通（8/8，见下方"本轮改动（F05）"）。
- F10（前端产出物面板版本历史回归测试）同样撞上"Docker 在本会话不可用"这同一大类
  环境限制（具体故障点各自不同，见各自小节），status 未手改。
- 无 feature 处于 harness `passing`。F13、F01、F05、F15、F10 都撞上"Docker 在对应
  会话不可用"这同一大类环境限制（具体故障点各自不同，见各自小节）——见下方"仍损坏
  或未验证"，几个 feature 的 status 都未被手动改动，符合"只能由验证脚本门控转移"
  的硬约束。

## 本轮改动（F01：apps/api 退化为薄网关）
- `apps/api/src/application/agent-run/execute-run.ts`：删除 `useLazySkillLoading` 伪循环
  分支与原先并列的纯 `complete()`/`completeStream()` 分支（`executeToolLoop` 此前已被
  #741 物理删除，本轮确认其确实不存在）；模型调用收敛成唯一一处
  `invokeKernel(deps.model, ...)`；新增 R4 A1/I-3 要求的下发前健康检查
  （`checkKernelHealth`，未过 ⇒ 不发起下游调用，直接 `KERNEL_UNAVAILABLE` 落终态）；
  删除随之变成死代码的 `ExecuteAgentRunDeps.streamingEnabled` 字段与 `"catalog"` 系统
  提示词模式。行数 1493 → 1364。
- `apps/api/src/application/agent-run/invoke-kernel.ts`（新）：抽出的唯一模型调用点，
  三种 provider 形状（completeWithProgress/completeStream/complete）优先级与改动前逐字
  相同，只是不再内联在 execute-run.ts 里。
- `apps/api/src/application/agent-run/ports.ts`：`ModelCallPort` 新增 OPTIONAL
  `checkKernelHealth?(modelProvider)`。
- `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts`：实现
  `checkKernelHealth()`（探测 `${baseUrl}/ok`；未配置地址或探测失败都报
  `"unavailable"`）。
- `apps/api/src/infrastructure/agent-run/routing-model-call-port.ts`：新增
  `checkKernelHealth(modelProvider)` 的按 provider 委托（同 `supportsProgress`/
  `supportsVision` 既有形状）。
- `apps/api/src/infrastructure/agent-run/agent-run-executor.ts` /
  `apps/api/src/kernel.module.ts`：删除已死的 `streamingEnabled` 接线。
- `packages/contracts/src/wave2-runtime.ts`：`AgentRunError` 新增 `KERNEL_UNAVAILABLE`。
- `apps/api/migrations/20260904170000_f01_kernel_unavailable_error_code.sql`（新）：
  `agent_runs_error_code_check` / `agent_run_steps_failure_code_check` 两条 CHECK 约束
  同步加上该符号，与 zod 枚举保持集合相等（`no-tool-run-writeback.test.ts` 机械看守）。
- 删除 `apps/api/tests/agent-runtime/skill-lazy-loading.test.ts`（测的正是本轮物理删除的
  分支）。
- 新增 `apps/api/tests/agent-run/gateway-forwarding.test.ts`、
  `apps/api/tests/agent-run/execute-run-thin-gateway.test.ts`（issue #2708 指定的两条
  verification 命令）。

## 本轮改动（F05：放开"一条用户消息只能对应一个 run"约束）

issue #2711，`requirements/02-streaming-transport.md` R4 E4，契约束
`streaming-transport`（design-signoff 2026-09-04T19:21:52Z，usamshen 已确认覆盖
F03/F04/F05）。

- **不碰** `agent_runs` 的 `UNIQUE (org_id, input_message_id)`（#415）——那条约束是
  coord-main 在 #519 上明确裁定优先于任何"往 `agent_runs` 塞第二行"的措辞（见
  `20260805190000_i519_agent_run_retry.sql` 头注），`no-tool-run-writeback.test.ts`
  的 "keeps the input-message uniqueness the reset exists to protect" 机械钉着它还在。
  `agent_runs` 一行仍是唯一的"逻辑 run"，`messageId` 依旧只映射到那一个
  `agent_runs.id`。
- `apps/api/migrations/20260905110000_f05_agent_run_attempts.sql`（新）：新表
  `agent_run_attempts`（`run_id` FK → `agent_runs.id`，`attempt_seq` 从 1 递增，
  `resumed_from_checkpoint_id` 可空，`status` CHECK 镜像
  `packages/contracts/src/streaming-transport.ts` 的 `AgentKernelRunStatus` 八个取值，
  `UNIQUE(org_id, run_id, attempt_seq)`）。只 append，不可 UPDATE/DELETE（同
  `agent_run_steps` 先例：GRANT 只给 SELECT/INSERT + 触发器双重防线）。「一个逻辑 run
  多次续跑」体现为这张表按 `run_id` 递增的行，不是新增 `agent_runs` 行。`messageId`
  不冗余存储，两个方法都 JOIN `agent_runs.input_message_id` 投影出来。
- `apps/api/src/application/agent-run/run-attempts.ts`（新）：`AgentRunAttemptStore`
  端口（`recordAttempt`/`listForMessage`）+ 用例 `listRunAttemptsForMessage`
  （usecases.md UC-2），可见性判定复用 `findMessageLocation` → `resolveVisibility`
  （同 `submit-message-rating.ts`/F176 先例，不另起第二套权限系统）。
- `apps/api/src/infrastructure/agent-run/pg-agent-run-attempt-repository.ts`（新）：
  上述端口的 PostgreSQL 实现。`recordAttempt` 用 advisory lock 串行化同一 `runId`
  的并发续跑请求，避免两个调用方算出同一个 `attempt_seq`。
- `apps/api/scripts/lint-permission-paths.mjs`：新增该仓储的 ALLOWLIST 条目（同
  `pg-agent-run-context-snapshot.ts`/F157 先例——判权在
  `listRunAttemptsForMessage` 里，不在仓储本身）。
- 新增 `apps/api/tests/agent-run/message-multi-run.test.ts`（issue 指定的唯一
  verification 命令，8 条用例，对真实 Postgres）：① `agent_runs` 的 UNIQUE 约束原样
  成立；② 同一 messageId 关联多条续跑记录、`attemptSeq` 递增、续跑携带上一次的
  checkpoint id；②之二/之三：单次执行=1 条记录、不同消息互不串；③ status 的 CHECK
  取值集合与 `AgentKernelRunStatus` 是同一份事实（`pg_constraint` 断言）；④ 只
  append（GRANT + 触发器双重机制都在）；⑤ `listRunAttemptsForMessage` 先判可见性、
  拒绝时不往下读（源码级顺序断言，同 F157 `agent-run-context-snapshot-repo-guard`
  先例，不需要搭整套 identity/authorize 真栈）。

**没有**触达的部分（有意，超出本 feature 最小范围）：`packages/contracts` 的
`streaming-transport.ts`/`AgentRunAttempt`/`operations.listRunAttemptsForMessage`
契约面在设计签核阶段已经写好，本轮直接消费，未改动；`GET
/messages/:messageId/agent-run-attempts` 的 NestJS controller/路由未接线——notes
只要求"数据模型变更"+ verification 只测数据层，接线留给消费它的 F03/F04（WebSocket
订阅 + 前端）落地时一并做，避免本 feature 顺手扩大范围。

## 仍损坏或未验证
- **本会话（F01 那一轮）的沙箱环境 Docker 出网被组织出网策略拦截**：`docker compose
  up -d postgres` 拉取 `pgvector/pgvector:pg16` 时对 `production.cloudfront.docker.com`
  返回 `403 Forbidden`。
- **本会话（F05 这一轮）Docker daemon 本身起不来**（不是出网策略问题，是容器运行时
  不允许调 ulimit：`service docker start` 报 `ulimit: error setting limit (Operation
  not permitted)`，`dangerouslyDisableSandbox` 下同样失败）——原因与 F01 那一轮不同，
  结果相同：`tests/support/db.ts` 的 `ensureDatabase()` 硬依赖
  `docker compose exec postgres pg_isready`，绕不开。
  - **本轮的替代路径，比 F01 那轮更进一步**：本机原有 `postgresql-16`（apt）+ 新装
    `postgresql-16-pgvector`，起了一个原生集群（`service postgresql start`），角色/
    密码/端口与 `docker-compose.dev.yml` 声明一致；在本会话本地 `/usr/local/bin/docker`
    放了一个不进仓库的 shim，只翻译 `db.ts` 实际发出的两种调用形状（`compose up -d
    postgres` / `compose exec -T postgres pg_isready|psql`）到原生集群，**没有修改
    `tests/support/db.ts` 或任何提交进仓库的文件**。效果：issue 指定的
    verification 命令**真的对真实 Postgres 跑通**（8/8，含 RLS/迁移/触发器），而不是
    只做了类型检查。完整命令与输出见 `evidence/F05.verify.log`；额外跑了
    `no-tool-run-writeback.test.ts`（含 #519 的 UNIQUE 约束存在性钉子）等 70 条既有
    用例确认无回归，以及全量迁移空库重放（`migrate-check.ts`，192 条迁移 + force
    重放 digest 一致）。
  - **仍然没跑通的是 `pnpm harness verify` 本身**：feature 命令过了之后，因为本次
    改动碰了 `apps/api/migrations/**`（`harness.config.yaml` 的 `high_risk_paths`），
    会自动升级到 `pnpm -w run verify:release`（全仓 typecheck+lint+test，其中一部分
    子包需要真实 minio/redis/浏览器 e2e），本会话的原生-Postgres 替代路径只覆盖了
    `db.ts` 这一个 docker 触点，没有覆盖 minio/redis，所以没有尝试跑这一档（评估后
    判断大概率会卡在与 F05 无关的基础设施缺口上，而不是本 feature 的代码）。
- **下一步**：找一个 docker/minio/redis 都可用的环境（本仓 CI 的 `verify-affected`
  runner，或另一个 remote session）重跑 `pnpm harness verify --sprint 14/01
  --feature F05`，跑通后由 verify 脚本自身完成 status 翻转（不能手改）；F01 的
  `--feature F01` 也还欠着同一步。

## 本轮改动（F13：错误分类修复，toFailure 精确归类，issue #2718）

范围严格限定在 R11(a) 切分出来的那一小片（`toFailure` 精确化），不碰
R11(b)/(c)（人性化转换层、前端卡片、transcript 存储）——那是 F14/F15 的事。

- `apps/api/src/application/agent-run/run-skill-script.ts`：`toFailure` 新增
  `ModelCallError` 分支（归 `MODEL_CALL_FAILED`），排在原有三个具名异常分支之后、
  真兜底之前；真兜底（认不出的异常）从原来的 `SANDBOX_UNAVAILABLE` 改成
  `UNKNOWN_EXECUTION_ERROR`（R7：诚实的"不知道"优先于张冠李戴）。`SkillScriptOutcome`
  的 `failureCode` 联合类型同步加了这两个字面量。
  - 触发本 phase 故障的诱因：回喂重试的 `deps.regenerate(feedback)` 是一次真实模型
    调用（`execute-run.ts` 接的是 `deps.model.complete(...)`），失败时抛
    `ModelCallError`——改前这个异常类型 `toFailure` 完全没处理，直接落进兜底，
    被记成 `SANDBOX_UNAVAILABLE`；运维会去查一个没坏的沙箱容器。
- 新增 `apps/api/tests/agent-run/failure-classification.test.ts`（issue #2718 指定的
  唯一 verification 命令）：
  - E1 回归：`regenerate` 抛 `ModelCallError("MODEL_CALL_FAILED", ...)` ⇒
    `failureCode === "MODEL_CALL_FAILED"`，且带一条 CP 反证（重放旧兜底逻辑本身，
    证明它确实会把这个异常判成 `SANDBOX_UNAVAILABLE`）。
  - 兜底诚实：一个非 `ModelCallError`/非沙箱类的意外异常 ⇒
    `failureCode === "UNKNOWN_EXECUTION_ERROR"`。
  - 不回归：`SandboxUnavailableError` 仍然归 `SANDBOX_UNAVAILABLE`（本次没有动这条）。
  - 反证方法：把 `run-skill-script.ts` 的改动 `git stash` 掉后重跑同一份测试，
    确认前两条断言真的会红（见下方"已做的替代验证"第 2 条），不是空转的 vacuous test。

### 仍损坏或未验证（与 F01 同一条环境 blocker，本轮重新确认过一次）
- 本会话 docker 服务本身没有起来（`/var/run/docker.sock` 不存在，`service docker
  start` 因 `ulimit: error setting limit (Operation not permitted)` 失败）；手动
  `dockerd --storage-driver=vfs` 能把 daemon 本身跑起来，但 `docker compose up -d
  postgres` 拉取 `pgvector/pgvector:pg16` 时对 `production.cloudfront.docker.com`
  返回 `403 Forbidden`——与 F01 那轮记录的是同一条组织出网策略拦截（`/root/.ccr/
  README.md`："403/407 = 出网策略拒绝，不要绕过"），不是本轮改动引入的新问题。
  真实失败日志已落盘 `evidence/F13.verify.log`（`pnpm harness verify --sprint 14/01
  --feature F13` 的原始输出，未手改）。
- **已做的替代验证**（不是 harness 认可的证据，只是本轮实现信心的补充说明）：
  1. `pnpm exec tsc --noEmit -p apps/api`：0 个新增错误（含新测试文件本身）。
  2. 用一份临时 vitest config（只去掉 `globalSetup`，其余设置逐字照抄
     `vitest.config.ts`，不落进仓库）跑
     `tests/agent-run/failure-classification.test.ts`：4 个测试全绿；同时跑既有
     `tests/agent-runtime/chat-skill-script-execution.test.ts`（11 个测试）确认未
     回归。把 `run-skill-script.ts` 的改动 `git stash` 后重跑，前两条断言按预期
     变红（`SANDBOX_UNAVAILABLE` vs 期望的 `MODEL_CALL_FAILED`/
     `UNKNOWN_EXECUTION_ERROR`），证明测试确实抓得住这条回归。
- **下一步**：找一个 docker 出网可用的环境（本仓 CI 的 `verify-affected` runner，
  或另一个出网策略不同的 remote session）重跑
  `pnpm harness verify --sprint 14/01 --feature F13`，跑通后由 verify 脚本自身完成
  status 翻转（不能手改）；同一个环境顺带把 F01 的 verify 也补跑掉（见上）。

## 本轮改动（F15：完整可审计 transcript 存储改造，issue #2723）

范围严格限定在 R11(c)：`agent_run_steps` 完整内容 + 字段级加密 + RBAC 审计接口。
只依赖 F01（已合入 main），不碰 F14（人性化转换层/前端卡片，仍 `not_started`）。

- `apps/api/migrations/20260905110000_f15_transcript_full_content.sql`（新）：
  `agent_run_steps` 加两个可空列 `input_full_content_enc`/`output_full_content_enc`
  （密文），幂等 `IF NOT EXISTS`，append-only 账本不回填历史行。
- `apps/api/src/infrastructure/agent-run/transcript-content-cipher.ts`（新）：
  `AesGcmTranscriptContentCipher`（AES-256-GCM，与 `aes-credential-cipher.ts` 同构
  密文布局），但**带 decrypt**——与 credential cipher"刻意不可逆"的设计相反，因为
  审计接口的存在意义就是让授权角色读回明文（R3'-3）。`decrypt` 永不抛异常，任何
  失败（钥匙不对/密文被篡改/格式不对）一律返回 `null`（I-4/E3）。
  `transcriptContentCipherFromEnv()`（读 `AGENT_RUN_TRANSCRIPT_KEY`）未配置时返回
  `null` 而非抛错——与 `credentialCipherFromEnv()` 的"缺 key 启动失败"故意不同，
  见该文件头注。
- `apps/api/src/application/agent-run/ports.ts`：新增 `TranscriptContentCipher` 端口、
  `TranscriptStep` 类型（`z.infer` 自契约，不复述）、`AppendedRunStep` 新增可选的
  `inputFullContent`/`outputFullContent`（明文，加密只在 infrastructure 层做，
  onion 分层要求 application 层不得直接碰 cipher）、`AgentRunStore` 新增
  `readRunTranscriptSteps`。
- `apps/api/src/infrastructure/agent-run/pg-agent-run-repository.ts`：构造函数新增
  可选 `cipher` 参数（默认 `null`，所有既有调用点 `new PgAgentRunRepository(db)`
  不受影响）；`appendStep` 的 INSERT 从 16 列扩到 18 列，加密写入两个新列；新增
  `readRunTranscriptSteps`（不复用 `readRun` 的折叠投影——审计要的是原始账本，
  只返回 `model_called`/`tool_call` 两种 kind；两列都为 NULL 或任一列解密失败都
  诚实报 `decryptStatus: "unreadable"`）。
- `apps/api/src/application/agent-run/execute-run.ts`：`record()` helper 新增可选
  `inputFullContent`/`outputFullContent`；三处 `model_called` 记录点（等待批准/
  失败/成功）透传 `system`（完整 prompt）与 `text`（完整回复，仅成功时有）。
  `tool_call`/`context_built` 未改动——前者是明确的后续工作，后者不在契约四类
  kind 之内。
- `apps/api/src/application/agent-run/get-run-transcript.ts`（新）：`getRunTranscript`
  用例。RBAC 映射"运维/开发"→仅 `admin`（照抄 `admin-audit-read.ts` 的
  `isAuditReader` 先例，同样排除 `compliance`）；FORBIDDEN 判定**先于**任何存在性
  判断，防止把这条端点当 runId 探针。
- `apps/api/src/interface/controllers/agent-run.controller.ts`：新增
  `GET /agent-runs/:runId/transcript`。
- `apps/api/src/kernel.module.ts`：`AGENT_RUN_STORE` 工厂改传
  `transcriptContentCipherFromEnv()`。
- 因 `AgentRunStore` 新增必需方法，补 6 个既有测试文件里手搓的假件
  （`readRunTranscriptSteps: async () => null`）：`gateway-forwarding.test.ts`、
  `attachment-notice-in-context.test.ts`、`deep-agent-produces-files.test.ts`、
  `execute-run-progress.test.ts`、`execute-run-streaming.test.ts`、
  `vision-image-input.test.ts`。
- 新增 `apps/api/tests/agent-run/transcript-full-content-rbac.test.ts`（issue #2723
  指定的唯一 verification 命令）：V1 加密落库非明文、V2 admin 读到完整明文（HTTP +
  直调两条路径）、V3 RBAC 拒绝且先于存在性判断（含"把判权改回放行 compliance"的
  CP 反证）、V4 密钥不匹配/未配置时诚实 unreadable 不崩溃、V5 tool_call 范围诚实
  标注——每条正向断言配一条 `*-CP` 反证。

### 仍损坏或未验证（与 F01/F13 同一条环境 blocker）
- 同上文 F01/F13 记录的 Docker 出网限制：`docker compose up -d postgres` 拉取
  `pgvector/pgvector:pg16` 对 `production.cloudfront.docker.com` 返回
  `403 Forbidden`。本轮额外确认：`.harness/scripts/with-test-isolation.ts` 走的
  也是同一条 `docker compose up`，同样被拦——不是"忘了用隔离脚本"的问题。
  真实失败日志已落盘 `evidence/F15.verify.log`。
- **已做的替代验证**（不是 harness 认可的证据，写在这里供 CI/下一个会话核对）：
  1. `pnpm --filter api exec tsc --noEmit -p .`：本轮改动到的文件 0 个新增错误
     （已排除 baseline 就存在的 `fabric-markdown` DOM 类型噪音）。
  2. `pnpm --filter api run lint`：7 项架构体检全绿，含 `lint-arch-deps`——确认
     `get-run-transcript.ts`（application 层）没有导入 `transcript-content-cipher.ts`
     （infrastructure 层），加密只发生在 `PgAgentRunRepository` 内部。
  3. 逐行核对：`appendStep` INSERT 的 18 个参数位次与列名一一对应；密文格式
     `<iv-hex>.<authTag-hex>.<ciphertext-hex>` 与既有 `aes-credential-cipher.ts`
     同构；契约 `TranscriptStep`（`.strict()`）的 5 个字段名与仓储返回值逐一对应。
  4. 测试文件本身**从未在任何环境跑到绿**——这是本节明确承认的缺口，不是"看起来
     能跑"。CI 若发现测试逻辑本身有问题，需要在本 PR 上修，而不是绕过或删测试。

## 本轮改动（F10：前端产出物面板，issue #2719）

- 新增 `apps/web/tests/agent-kernel/artifacts-panel.test.tsx`：给已在
  `artifacts-steering` 契约束签核阶段由 ui-prototyper 建成的 `ArtifactsPanel`
  原型（`components/agent-kernel/agent-kernel-units.tsx`）补回归测试，组件本身
  未改动——原型已满足 `feature_list.json` 该条 `notes` 逐字列出的全部断言面
  （空态、`artifact-version-{n}` 存在与 `aria-pressed` 切换、`artifact-view`/
  `artifact-continue` 存在）。
- `feature_list.json`：F10 的 `sprint` 由 `null` 改为 `"01"`（经
  `lib/features.ts` 读写，非手改），使其进入本 sprint 的 `active-features.json`
  派生视图。

### 范围边界（刻意未做，如实记录）

`apps/api/src/application/artifacts-steering/`（F09）目前只有应用层用例
（`getArtifact`/`listArtifactVersions`/`continueArtifact`）与 `PgArtifactStore`，
**没有任何 HTTP 控制器**暴露这些操作；`continueArtifact` 依赖的
`ArtifactRunLauncher` 端口在 `ports.ts` 里明确写着"只定义端口，不提供生产实现"。
把 `ArtifactsPanel` 的『查看此版本』/『基于此继续修改』接上真实网络请求，需要先有
这层 HTTP 暴露面——这不存在于 F10 在 `feature_list.json` 里的权威 `notes`
断言面内（只要求 UI 交互层面的 testid/状态切换/按钮存在性），也不存在于当前
F09～F12 四个 feature 的任何一个已声明范围里。本轮判断这是"顺手扩大范围"
（AGENTS.md 范围纪律），未做；做法上与同 sprint 的 F14
（`error-card.test.tsx`，同样只给已建原型补测试、不接后端）保持一致。
若人类希望把这层接线纳入本 phase，需要在 design-signoff 或后续 feature 拆分里
显式补一条。

### 仍未验证：docker daemon 在本会话不存在（与 F01/F13 环境 blocker 同类、故障点不同）

- `docker info` 报 `connect: no such file or directory
  /var/run/docker.sock`——本会话沙箱里 docker daemon 根本没有起来（F01/F13 那两轮
  是 daemon 起来了但拉镜像被组织出网策略拦截；这一轮更前一步，daemon 本身缺失，
  如实分列，不归并成同一条故障描述）。
- `pnpm harness verify --sprint 14/01 --feature F10`：F10 自身 verification 通过；
  `verify:quick` 的 `turbo run typecheck lint test --affected` 本体 5/5 成功、
  2834/2834 测试全绿，但收尾的 `[test-isolation] cleanup failed: docker compose
  down -v exited 1` 让整条命令以 exit 1 结束，从而拒绝把 F10 升为 `passing`——
  **不是本次改动引入的逻辑缺陷**，失败点在所有测试都已经跑完之后的清理步骤。
  真实失败日志已落盘 `evidence/F10.verify.log`（未手改）。
- **下一步**：找一个有可用 Docker daemon 的环境（本仓 CI runner，或另一个 daemon
  可用的 remote session）重跑 `pnpm harness verify --sprint 14/01 --feature F10`，
  跑通后由 verify 脚本自身完成 status 翻转（不能手改）；同一个环境可顺带补跑
  F01/F13 的 verify（它们是出网策略拦截，非 daemon 缺失，两条环境限制不完全相同，
  但同样需要"docker 可用"这个大前提）。

## 下一步最佳动作
- 找到 Docker 完整可用（daemon 起得来 + 出网不受限）的环境，依次重跑 F01、F13、
  F05、F15、F10 的 `pnpm harness verify --sprint 14/01 --feature <id>` 把它们门控转
  passing；不要在没跑通 verify 的情况下手改 `feature_list.json` 的 status。
- F05 之后：`GET /messages/:messageId/agent-run-attempts` 的 controller 接线（本轮
  刻意未做，见上）适合并入消费它的 F03/F04。
- F13 之后：F14（错误人性化转换层+前端错误卡片，已由另一会话在做）可并行；F15
  已实现完成待 CI 验证，其 `tool_call` 完整内容捕获（依赖
  `deep-agent-model-provider.ts` 暴露未截断参数/结果）是已标注的后续工作；F02
  （灰度开关默认开启+移除开关本身）依赖 F01；F11（中途插话后端接口）依赖 F06
  （尚未开工）。

## 命令
- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --phase 14`
- 调试：`pnpm exec tsc --noEmit -p apps/api`（过滤 `fabric-markdown` 的已知 baseline 噪音）
